import type { PlanningWaypointView } from "./planningTypes";
import { previewBoomerangMotion } from "./planningBoomerangPreview";
import {
  DEFAULT_BOOMERANG_PREVIEW_CONFIGURATION,
  type BoomerangPreviewConfiguration,
} from "./planningBoomerangConfiguration";

export const DEFAULT_BOOMERANG_LEAD = 0.6;

export interface SegmentPoint {
  readonly x: number;
  readonly y: number;
}

interface SegmentSample extends SegmentPoint {
  readonly t: number;
  readonly distance: number;
  readonly theta: number;
}

export function normalizePlanningLead(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value)) : DEFAULT_BOOMERANG_LEAD;
}

export function isBoomerangWaypoint(point: PlanningWaypointView): boolean {
  return (typeof point.lead === "number" && Number.isFinite(point.lead)) ||
    !!point.motions?.some((motion) => motion.type === "boomerang");
}

export function waypointLead(point: PlanningWaypointView): number {
  return isBoomerangWaypoint(point) ? normalizePlanningLead(point.lead) : 0;
}

/** Planning headings are clockwise from +Y, matching the exported poses. */
function headingVector(theta: number): SegmentPoint {
  const angle = theta * Math.PI / 180;
  return { x: Math.sin(angle), y: Math.cos(angle) };
}

function geometryInputs(start: PlanningWaypointView, end: PlanningWaypointView): readonly number[] {
  return [start.x, start.y, start.theta ?? 0, start.speed ?? 127,
    waypointLead(start), Number(isBoomerangWaypoint(start)), Number(isSegmentForwards(start, end)),
    end.x, end.y, end.theta ?? 0];
}

export function isSegmentForwards(start: PlanningWaypointView, end?: PlanningWaypointView): boolean {
  if (typeof start.forwards === "boolean") return start.forwards;
  if (!end || (start.x === end.x && start.y === end.y)) return true;
  const pathTheta = Math.atan2(end.x - start.x, end.y - start.y) * 180 / Math.PI;
  const delta = ((pathTheta - (Number(start.theta) || 0) + 540) % 360) - 180;
  return Math.abs(delta) <= 90;
}

/** Moving-carrot preview shared by drawing, hit testing, nodes, and playback. */
export class PlanningSegment {
  readonly curved: boolean;
  readonly forwards: boolean;
  readonly lead: number;
  readonly chordLength: number;
  /** Editing anchor; unlike the live carrot it stays at the initial-distance scale. */
  readonly leadHandleAnchor: SegmentPoint;
  readonly previewConverged: boolean;
  readonly previewTargetError: number;
  /** The single lead handle travels away from the target along this unit axis. */
  readonly leadAxis: SegmentPoint;
  readonly samples: readonly SegmentSample[];
  readonly length: number;
  readonly #inputs: readonly number[];

  constructor(
    readonly start: PlanningWaypointView,
    readonly end: PlanningWaypointView,
    private readonly configuration: BoomerangPreviewConfiguration = DEFAULT_BOOMERANG_PREVIEW_CONFIGURATION,
  ) {
    this.#inputs = geometryInputs(start, end);
    this.curved = isBoomerangWaypoint(start);
    this.forwards = isSegmentForwards(start, end);
    this.lead = waypointLead(start);
    this.chordLength = Math.hypot(end.x - start.x, end.y - start.y);
    const direction = this.forwards ? 1 : -1;
    const endHeading = headingVector(Number(end.theta) || 0);
    const offset = this.chordLength * this.lead;
    this.leadAxis = { x: -endHeading.x * direction, y: -endHeading.y * direction };
    this.leadHandleAnchor = {
      x: end.x + this.leadAxis.x * offset,
      y: end.y + this.leadAxis.y * offset,
    };
    const startPose = { x: start.x, y: start.y, theta: (Number(start.theta) || 0) * Math.PI / 180 };
    const endPose = { x: end.x, y: end.y, theta: (Number(end.theta) || 0) * Math.PI / 180 };
    const preview = this.curved && this.chordLength > 0
      ? previewBoomerangMotion(startPose, endPose, this.lead, this.forwards, start.speed ?? 127, configuration)
      : { poses: [startPose, endPose], converged: true };
    this.previewConverged = preview.converged;
    const last = preview.poses.at(-1)!;
    this.previewTargetError = Math.hypot(end.x - last.x, end.y - last.y);
    let distance = 0;
    const samples = preview.poses.map((point, index): SegmentSample => {
      const previous = preview.poses[index - 1] ?? point;
      distance += Math.hypot(point.x - previous.x, point.y - previous.y);
      return { ...point, t: index / (preview.poses.length - 1), distance };
    });
    this.samples = samples;
    this.length = samples.at(-1)!.distance;
  }

  matches(start: PlanningWaypointView, end: PlanningWaypointView, configuration: BoomerangPreviewConfiguration): boolean {
    return this.start === start && this.end === end && this.configuration === configuration &&
      geometryInputs(start, end).every((value, index) => value === this.#inputs[index]);
  }

  pointAt(t: number): SegmentPoint {
    const { before, after, amount } = this.surroundingSamples(t);
    return {
      x: before.x + (after.x - before.x) * amount,
      y: before.y + (after.y - before.y) * amount,
    };
  }

  headingAt(t: number): number {
    const { before, after, amount } = this.surroundingSamples(t);
    const delta = Math.atan2(Math.sin(after.theta - before.theta), Math.cos(after.theta - before.theta));
    return (before.theta + delta * amount) * 180 / Math.PI;
  }

  tangentAt(t: number): SegmentPoint {
    const { before, after } = this.surroundingSamples(t);
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    if (length > 1e-10) return { x: dx / length, y: dy / length };
    const chord = this.chordLength || 1;
    return { x: (this.end.x - this.start.x) / chord, y: (this.end.y - this.start.y) / chord };
  }

  private surroundingSamples(t: number) {
    const offset = Math.max(0, Math.min(1, t)) * (this.samples.length - 1);
    const index = Math.min(this.samples.length - 2, Math.floor(offset));
    return { before: this.samples[index]!, after: this.samples[index + 1]!, amount: offset - index };
  }

  /** Arc-length lookup keeps playback and field nodes on the visible curve. */
  progressAtDistance(distance: number): number {
    const along = Math.max(0, Math.min(this.length, distance));
    if (along >= this.length) return 1;
    for (let index = 1; index < this.samples.length; index += 1) {
      const sample = this.samples[index]!;
      if (sample.distance < along) continue;
      const previous = this.samples[index - 1]!;
      const amount = (along - previous.distance) / (sample.distance - previous.distance || 1);
      return previous.t + (sample.t - previous.t) * amount;
    }
    return 1;
  }

  leadAfterDrag(originalLead: number, dx: number, dy: number): number {
    if (this.chordLength <= 1e-10) return originalLead;
    return normalizePlanningLead(originalLead + (dx * this.leadAxis.x + dy * this.leadAxis.y) / this.chordLength);
  }
}

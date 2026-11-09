import type { PlanningWaypointView } from "./planningTypes";
import {
  DEFAULT_PLANNING_SIMULATION_CONFIGURATION,
  type PlanningSimulationConfiguration,
} from "./planningSimulationConfiguration";
import { simulatePlanningRoute } from "./planningSimulation";
import { supportsPlanningMotion } from "./planningTemplateCapabilities";
import type { PlanningTemplateLibrary } from "./planningTemplatePresets";
import type {
  SimulatedSection,
  SimulationCompletionOffset,
  SimulationOutcome,
} from "./planningSimulationTypes";
import {
  isBoomerangWaypoint,
  isSegmentForwards,
  waypointLead,
  normalizePlanningLead,
} from "./planningMotionContext";
export {
  DEFAULT_BOOMERANG_LEAD,
  isBoomerangWaypoint,
  isSegmentForwards,
  waypointLead,
  normalizePlanningLead,
} from "./planningMotionContext";
export interface SegmentPoint {
  readonly x: number;
  readonly y: number;
}
interface SegmentSample extends SegmentPoint {
  readonly t: number;
  readonly distance: number;
  readonly theta: number;
}
const inputs = (start: PlanningWaypointView, end: PlanningWaypointView) =>
  JSON.stringify([
    start.x,
    start.y,
    start.theta,
    start.speed,
    start.minSpeed,
    start.forwards,
    waypointLead(start),
    start.motions?.map((m) => [m.id, m.type, m.lockedDriveSide]),
    end.x,
    end.y,
    end.theta,
  ]);
/** Geometry is a view of the shared route simulation, never a separate prediction. */
export class PlanningSegment {
  readonly curved: boolean;
  readonly forwards: boolean;
  readonly lead: number;
  readonly chordLength: number;
  readonly leadHandleAnchor: SegmentPoint;
  readonly leadAxis: SegmentPoint;
  readonly previewConverged: boolean;
  readonly previewTargetError: number;
  readonly previewAngularError: number;
  readonly translates: boolean;
  readonly outcome: SimulationOutcome;
  readonly completionOffset: SimulationCompletionOffset | undefined;
  readonly samples: readonly SegmentSample[];
  readonly length: number;
  readonly duration: number;
  readonly #inputs: string;
  constructor(
    readonly start: PlanningWaypointView,
    readonly end: PlanningWaypointView,
    private readonly configuration = DEFAULT_PLANNING_SIMULATION_CONFIGURATION,
    readonly section?: SimulatedSection | null,
    private readonly templateLibrary: PlanningTemplateLibrary = "custom",
  ) {
    this.#inputs = inputs(start, end);
    this.curved = configuration.previewModel !== "vexcode" && supportsPlanningMotion(templateLibrary, "boomerang") && isBoomerangWaypoint(start);
    this.forwards = isSegmentForwards(start, end);
    this.lead = this.curved ? waypointLead(start) : 0;
    this.chordLength = Math.hypot(end.x - start.x, end.y - start.y);
    const angle = ((end.theta ?? 0) * Math.PI) / 180,
      direction = configuration.previewModel === "jar-template" ? 1 : this.forwards ? 1 : -1;
    this.leadAxis = {
      x: -Math.sin(angle) * direction,
      y: -Math.cos(angle) * direction,
    };
    this.leadHandleAnchor = {
      x: end.x + this.leadAxis.x * this.chordLength * this.lead,
      y: end.y + this.leadAxis.y * this.chordLength * this.lead,
    };
    const preview =
      section === undefined
        ? simulatePlanningRoute({ waypoints: [start, end], configuration, templateLibrary })
            .sections[0]
        : section;
    const first = preview?.samples[0];
    const last = preview?.samples.at(-1);
    this.duration = first && last ? last.time - first.time : 0;
    this.outcome = preview?.outcome ?? "incomplete";
    this.completionOffset = preview?.completionOffset;
    this.previewConverged = this.outcome === "reached" || this.outcome === "completed";
    this.translates = !!preview?.motions.some(
      (m) => m.type === "forward" || m.type === "boomerang",
    );
    this.previewAngularError = last
      ? (Math.abs(
          Math.atan2(
            Math.sin(angle - last.theta),
            Math.cos(angle - last.theta),
          ),
        ) *
          180) /
        Math.PI
      : 0;
    this.previewTargetError =
      last && this.translates ? Math.hypot(end.x - last.x, end.y - last.y) : 0;
    const raw = preview?.samples.length
      ? preview.samples
      : [
          {
            x: start.x,
            y: start.y,
            theta: ((start.theta ?? 0) * Math.PI) / 180,
            time: 0,
            distance: 0,
          },
          {
            x: start.x,
            y: start.y,
            theta: ((start.theta ?? 0) * Math.PI) / 180,
            time: 0,
            distance: 0,
          },
        ];
    this.samples = raw.map((point, index) => ({
      x: point.x,
      y: point.y,
      theta: point.theta,
      t:
        this.duration > 0
          ? (point.time - raw[0]!.time) / this.duration
          : index / Math.max(1, raw.length - 1),
      distance: point.distance - raw[0]!.distance,
    }));
    this.length = this.samples.at(-1)!.distance;
  }
  matches(
    start: PlanningWaypointView,
    end: PlanningWaypointView,
    config: PlanningSimulationConfiguration,
    templateLibrary = this.templateLibrary,
  ): boolean {
    return this.configuration === config && this.templateLibrary === templateLibrary && this.#inputs === inputs(start, end);
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
    return (
      ((before.theta + (after.theta - before.theta) * amount) * 180) / Math.PI
    );
  }
  tangentAt(t: number): SegmentPoint {
    const { before, after } = this.surroundingSamples(t);
    const dx = after.x - before.x,
      dy = after.y - before.y,
      length = Math.hypot(dx, dy);
    return length > 1e-10
      ? { x: dx / length, y: dy / length }
      : { x: Math.sin(after.theta), y: Math.cos(after.theta) };
  }
  private surroundingSamples(t: number) {
    const clamped = Math.max(0, Math.min(1, t));
    let low = 0,
      high = this.samples.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (this.samples[mid]!.t < clamped) low = mid;
      else high = mid;
    }
    const before = this.samples[low]!,
      after = this.samples[high]!;
    return {
      before,
      after,
      amount: (clamped - before.t) / (after.t - before.t || 1),
    };
  }
  progressAtDistance(distance: number): number {
    const along = Math.max(0, Math.min(this.length, distance));
    for (let i = 1; i < this.samples.length; i++) {
      const after = this.samples[i]!,
        before = this.samples[i - 1]!;
      if (after.distance < along) continue;
      return (
        before.t +
        ((after.t - before.t) * (along - before.distance)) /
          (after.distance - before.distance || 1)
      );
    }
    return 1;
  }
  leadAfterDrag(originalLead: number, dx: number, dy: number): number {
    return this.chordLength > 1e-10
      ? normalizePlanningLead(
          originalLead +
            (dx * this.leadAxis.x + dy * this.leadAxis.y) / this.chordLength,
        )
      : originalLead;
  }
}

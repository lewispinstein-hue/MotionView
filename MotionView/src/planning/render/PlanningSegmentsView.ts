import type { FieldRenderer } from "../../render/field";
import type { PlanningFeature } from "../PlanningFeature";
import type { PlanningSegment, SegmentPoint } from "../planningSegments";
import { formatDistanceFromInches, getCurrentUnits } from "../../shared/units";

export interface PathSegmentHit extends SegmentPoint {
  readonly index: number;
}

/** Drawing and hit testing share the same cached geometry as route playback. */
export class PlanningSegmentsView {
  constructor(private readonly planning: PlanningFeature, private readonly field: FieldRenderer) {}

  draw(editing: boolean): void {
    const context = this.field.ctx;
    context.save();
    context.lineCap = "round";
    this.planning.projection.segments.forEach((segment, index) => {
      const selected = this.planning.selection.isWaypointSelected(index);
      context.lineWidth = this.field.sizes.screen({ width: selected ? 4 : 2, height: 2 }).width;
      context.strokeStyle = selected ? "rgba(190,225,255,0.98)" : "rgb(120,180,255)";
      const start = this.screen(segment.start);
      context.beginPath();
      context.moveTo(start.x, start.y);
      for (const sample of segment.samples.slice(1)) {
        const screen = this.screen(sample);
        context.lineTo(screen.x, screen.y);
      }
      context.stroke();
      if (!segment.previewConverged || segment.previewTargetError > 0.25) {
        // Editing guide only: never feed this invented connection to playback.
        const end = this.screen(segment.end);
        context.lineWidth = this.field.sizes.screen({ width: 1, height: 1 }).width;
        context.strokeStyle = "rgba(235,190,115,0.6)";
        context.beginPath();
        const last = this.screen(segment.samples.at(-1)!);
        context.moveTo(last.x, last.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      }
      if (editing && selected && segment.curved && segment.chordLength > 0) this.drawLeadHandle(segment);
    });
    context.restore();
  }

  hitSegment(x: number, y: number, threshold: number): PathSegmentHit | null {
    let best: PathSegmentHit | null = null;
    let bestDistance = threshold ** 2;
    this.planning.projection.segments.forEach((segment, index) => {
      let previous = this.screen(segment.samples[0]!);
      const samples = segment.previewConverged && segment.previewTargetError <= 0.25
        ? segment.samples.slice(1) : [...segment.samples.slice(1), segment.end];
      for (const sample of samples) {
        const current = this.screen(sample);
        const dx = current.x - previous.x;
        const dy = current.y - previous.y;
        const lengthSquared = dx ** 2 + dy ** 2;
        if (lengthSquared > 0) {
          const progress = Math.max(0, Math.min(1, ((x - previous.x) * dx + (y - previous.y) * dy) / lengthSquared));
          const closestX = previous.x + dx * progress;
          const closestY = previous.y + dy * progress;
          const distance = (x - closestX) ** 2 + (y - closestY) ** 2;
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = { index, x: closestX, y: closestY };
          }
        }
        previous = current;
      }
    });
    return best;
  }

  hitLeadHandle(x: number, y: number): number {
    for (const index of this.planning.selection.waypointIndices) {
      const segment = this.planning.projection.segments[index];
      if (!segment?.curved || segment.chordLength <= 0) continue;
      const handle = this.leadHandle(segment);
      if (Math.hypot(x - handle.x, y - handle.y) <= handle.radius + 4) return index;
    }
    return -1;
  }

  private screen(point: SegmentPoint): SegmentPoint {
    return this.field.worldToScreen(point.x, point.y);
  }

  private leadHandle(segment: PlanningSegment): SegmentPoint & { readonly radius: number } {
    const control = this.screen(segment.leadHandleAnchor);
    const end = this.screen(segment.end);
    const axis = this.screen({ x: segment.end.x + segment.leadAxis.x, y: segment.end.y + segment.leadAxis.y });
    const length = Math.hypot(axis.x - end.x, axis.y - end.y) || 1;
    // Like a theta handle, keep a small screen-space standoff so lead=0 is
    // still draggable without covering the destination waypoint.
    const offset = this.field.sizes.screen({ width: 18, height: 18 }).width;
    return {
      x: control.x + (axis.x - end.x) / length * offset,
      y: control.y + (axis.y - end.y) / length * offset,
      radius: this.field.sizes.screen({ width: 8, height: 8 }).width / 2,
    };
  }

  private drawLeadHandle(segment: PlanningSegment): void {
    const context = this.field.ctx;
    const handle = this.leadHandle(segment);
    const start = this.screen(segment.start);
    const end = this.screen(segment.end);
    context.lineWidth = this.field.sizes.screen({ width: 1, height: 1 }).width;
    context.strokeStyle = "rgba(160,195,235,0.65)";
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(handle.x, handle.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.beginPath();
    context.arc(handle.x, handle.y, handle.radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(90,160,255,1)";
    context.fill();
    context.strokeStyle = "rgba(15,25,35,0.8)";
    context.stroke();
    context.font = "11px system-ui, sans-serif";
    context.fillStyle = "rgba(210,230,255,0.95)";
    const label = `Lead ${Number(segment.lead.toFixed(3))} · ${segment.previewConverged ? "Approx. preview" : "Preview incomplete"}`;
    context.fillText(label, handle.x + handle.radius + 6, handle.y - 6);
    if (segment.previewConverged && segment.previewTargetError > 0.25)
      context.fillText(`Predicted end offset: ${formatDistanceFromInches(segment.previewTargetError, 2)} ${getCurrentUnits()}`, handle.x + handle.radius + 6, handle.y + 8);
  }
}

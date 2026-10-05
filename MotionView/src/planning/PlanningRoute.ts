import type { PlanWaypointIndicatorIcon } from "../state/models";
import { normalizeWaypointIndicatorIcons } from "./planningIndicators";
import type { PlanningSession } from "./planningSession";
import type { PlanningWaypoint, PlanningWaypointView } from "./planningTypes";

function cloneWaypoint(waypoint: Readonly<PlanningWaypoint>): PlanningWaypoint {
  const cloned: PlanningWaypoint = { ...waypoint };
  const indicatorIcons = normalizeWaypointIndicatorIcons(waypoint.indicatorIcons);
  if (indicatorIcons.length || Object.prototype.hasOwnProperty.call(waypoint, "indicatorIcons")) {
    cloned.indicatorIcons = indicatorIcons;
  }
  if (Object.prototype.hasOwnProperty.call(waypoint, "overrideCode")) {
    cloned.overrideCode = String(waypoint.overrideCode ?? "");
  }
  return cloned;
}

export class PlanningRoute {
  constructor(private readonly session: PlanningSession) {}
  get waypoints(): readonly PlanningWaypointView[] { return this.session.waypoints; }
  get length(): number { return this.session.waypoints.length; }
  get revision(): number { return this.session.routeRevision; }
  get hasData(): boolean { return this.session.waypoints.length > 0; }

  add(waypoint: PlanningWaypoint, index = this.session.waypoints.length): number {
    const insertionIndex = Math.max(0, Math.min(this.session.waypoints.length, Math.trunc(index)));
    this.session.mutate("route", () => this.session.waypoints.splice(insertionIndex, 0, cloneWaypoint(waypoint)));
    return insertionIndex;
  }

  replace(waypoints: readonly PlanningWaypoint[]): void {
    this.session.mutate("route", () => {
      this.session.waypoints.length = 0;
      this.session.waypoints.push(...waypoints.map(cloneWaypoint));
    });
  }

  update(index: number, values: Partial<PlanningWaypoint>): void {
    const waypoint = this.session.waypoints[index];
    if (!waypoint) return;
    this.session.mutate("route", () => Object.assign(waypoint, values));
  }

  updateContent(index: number, code: string, indicatorIcons: readonly PlanWaypointIndicatorIcon[]): void {
    const waypoint = this.session.waypoints[index];
    if (!waypoint) return;
    this.session.mutate("route", () => {
      const normalizedIcons = normalizeWaypointIndicatorIcons(indicatorIcons);
      if (normalizedIcons.length) waypoint.indicatorIcons = normalizedIcons;
      else delete waypoint.indicatorIcons;
      if (code === this.session.exportTemplate) delete waypoint.overrideCode;
      else waypoint.overrideCode = code;
    });
  }

  updateField(index: number, field: "x" | "y" | "theta" | "speed", value: number): void {
    const waypoint = this.session.waypoints[index];
    if (!waypoint) return;
    this.session.mutate("route", () => { waypoint[field] = value; });
  }

  updateMany(updates: Iterable<readonly [index: number, values: Partial<PlanningWaypoint>]>): void {
    this.session.mutate("route", () => {
      for (const [index, values] of updates) {
        const waypoint = this.session.waypoints[index];
        if (waypoint) Object.assign(waypoint, values);
      }
    });
  }

  move(indices: Iterable<number>, dx: number, dy: number, clamp?: (point: Readonly<PlanningWaypoint>) => PlanningWaypoint): void {
    this.session.mutate("route", () => {
      for (const index of indices) {
        const waypoint = this.session.waypoints[index];
        if (!waypoint) continue;
        const next = clamp?.({ ...waypoint, x: waypoint.x + dx, y: waypoint.y + dy })
          ?? { ...waypoint, x: waypoint.x + dx, y: waypoint.y + dy };
        waypoint.x = next.x;
        waypoint.y = next.y;
      }
    });
  }

  remove(indices: Iterable<number>): void {
    const deleted = [...new Set(indices)]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < this.session.waypoints.length)
      .sort((a, b) => a - b);
    if (!deleted.length) return;
    this.session.mutate("route", () => {
      const bucketCounts = new Map<number, number>();
      const orderedNodes = [...this.session.nodes]
        .sort((a, b) => a.beforeWaypoint - b.beforeWaypoint || a.index - b.index || a.id.localeCompare(b.id));
      let deletedCursor = 0;
      for (const node of orderedNodes) {
        while (deletedCursor < deleted.length && deleted[deletedCursor]! < node.beforeWaypoint) deletedCursor += 1;
        node.beforeWaypoint -= deletedCursor;
        node.index = bucketCounts.get(node.beforeWaypoint) ?? 0;
        bucketCounts.set(node.beforeWaypoint, node.index + 1);
      }
      for (let offset = deleted.length - 1; offset >= 0; offset -= 1) {
        this.session.waypoints.splice(deleted[offset]!, 1);
      }
      this.session.selectedWaypoints.clear();
      this.session.selectedWaypoint = -1;
    });
    this.session.events.selectionChanged.emit({ kind: "waypoint" });
  }
}

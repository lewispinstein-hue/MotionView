import type { PlanningSession } from "./planningSession";
import type { PlanningWaypoint, PlanningWaypointView } from "./planningTypes";

export class PlanningRoute {
  constructor(private readonly session: PlanningSession) {}
  get waypoints(): readonly PlanningWaypointView[] { return this.session.waypoints; }
  get length(): number { return this.session.waypoints.length; }
  get revision(): number { return this.session.routeRevision; }
  get hasData(): boolean { return this.session.waypoints.length > 0; }

  add(waypoint: PlanningWaypoint, index = this.session.waypoints.length): number {
    const insertionIndex = Math.max(0, Math.min(this.session.waypoints.length, Math.trunc(index)));
    this.session.mutate("route", () => this.session.waypoints.splice(insertionIndex, 0, { ...waypoint }));
    return insertionIndex;
  }

  replace(waypoints: readonly PlanningWaypoint[]): void {
    this.session.mutate("route", () => {
      this.session.waypoints.length = 0;
      this.session.waypoints.push(...waypoints.map((point) => ({ ...point })));
    });
  }

  update(index: number, values: Partial<PlanningWaypoint>): void {
    const waypoint = this.session.waypoints[index];
    if (!waypoint) return;
    this.session.mutate("route", () => Object.assign(waypoint, values));
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
    const sorted = [...indices].filter(Number.isInteger).sort((a, b) => b - a);
    if (!sorted.length) return;
    this.session.mutate("route", () => {
      for (const index of sorted) {
        if (index >= 0 && index < this.session.waypoints.length) this.session.waypoints.splice(index, 1);
      }
      this.session.selectedWaypoints.clear();
      this.session.selectedWaypoint = -1;
    });
    this.session.events.selectionChanged.emit({ kind: "waypoint" });
  }
}

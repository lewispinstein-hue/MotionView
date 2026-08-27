import type { PlanningEvents } from "./planningEvents";
import type { PlanningSession } from "./planningSession";
import type { PlanningNode, PlanningWaypoint } from "./planningTypes";

export class PlanningSelection {
  constructor(private readonly session: PlanningSession, private readonly events: PlanningEvents) {}

  get waypointIndices(): ReadonlySet<number> { return this.session.selectedWaypoints; }
  get primaryWaypointIndex(): number { return this.session.selectedWaypoint; }
  get selectedWaypoint(): Readonly<PlanningWaypoint> | null { return this.session.waypoints[this.session.selectedWaypoint] ?? null; }
  get selectedNodeId(): string | null { return this.session.selectedNodeId; }
  get selectedNode(): Readonly<PlanningNode> | null { return this.session.nodes.find((node) => node.id === this.session.selectedNodeId) ?? null; }

  isWaypointSelected(index: number): boolean { return this.session.selectedWaypoints.has(index); }

  selectWaypoint(index: number): void {
    this.session.selectedWaypoints.clear();
    if (index >= 0 && index < this.session.waypoints.length) this.session.selectedWaypoints.add(index);
    this.session.selectedWaypoint = this.session.selectedWaypoints.has(index) ? index : -1;
    if (this.session.selectedWaypoint >= 0) this.session.selectedNodeId = null;
    this.events.selectionChanged.emit({ kind: "waypoint" });
  }

  setWaypoints(indices: readonly number[]): void {
    this.session.selectedWaypoints.clear();
    for (const index of [...indices].sort((a, b) => a - b)) {
      if (index >= 0 && index < this.session.waypoints.length) this.session.selectedWaypoints.add(index);
    }
    this.session.selectedWaypoint = this.session.selectedWaypoints.values().next().value ?? -1;
    if (this.session.selectedWaypoint >= 0) this.session.selectedNodeId = null;
    this.events.selectionChanged.emit({ kind: "waypoint" });
  }

  toggleWaypoint(index: number): void {
    if (index < 0 || index >= this.session.waypoints.length) return;
    if (this.session.selectedWaypoints.has(index)) this.session.selectedWaypoints.delete(index);
    else this.session.selectedWaypoints.add(index);
    this.session.selectedWaypoint = this.session.selectedWaypoints.has(index)
      ? index : (this.session.selectedWaypoints.values().next().value ?? -1);
    if (this.session.selectedWaypoint >= 0) this.session.selectedNodeId = null;
    this.events.selectionChanged.emit({ kind: "waypoint" });
  }

  selectNode(id: string | null): void {
    this.session.selectedNodeId = id && this.session.nodes.some((node) => node.id === id) ? id : null;
    if (this.session.selectedNodeId) {
      this.session.selectedWaypoints.clear();
      this.session.selectedWaypoint = -1;
    }
    this.events.selectionChanged.emit({ kind: "node" });
  }

  clear(): void {
    this.session.selectedWaypoints.clear();
    this.session.selectedWaypoint = -1;
    this.session.selectedNodeId = null;
    this.events.selectionChanged.emit({ kind: "cleared" });
  }
}

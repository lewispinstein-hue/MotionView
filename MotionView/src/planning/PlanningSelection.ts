import type { PlanningEvents } from "./planningEvents";
import type { PlanningMethodSelection, PlanningSession } from "./planningSession";
import type { PlanningNode, PlanningWaypoint } from "./planningTypes";

export class PlanningSelection {
  constructor(private readonly session: PlanningSession, private readonly events: PlanningEvents) {}

  get waypointIndices(): ReadonlySet<number> { return this.session.selectedWaypoints; }
  get primaryWaypointIndex(): number { return this.session.selectedWaypoint; }
  get selectedWaypoint(): Readonly<PlanningWaypoint> | null { return this.session.waypoints[this.session.selectedWaypoint] ?? null; }
  get selectedNodeId(): string | null { return this.session.selectedNodeId; }
  get selectedNode(): Readonly<PlanningNode> | null { return this.session.nodes.find((node) => node.id === this.session.selectedNodeId) ?? null; }
  get selectedMethod(): Readonly<PlanningMethodSelection> | null { return this.session.selectedMethod; }

  isWaypointSelected(index: number): boolean { return this.session.selectedWaypoints.has(index); }
  isMethodSelected(objectId: string, methodId: string): boolean {
    return this.session.selectedMethod?.objectId === objectId && this.session.selectedMethod.methodId === methodId;
  }
  isNodeHighlighted(node: Readonly<PlanningNode>): boolean {
    return node.id === this.session.selectedNodeId || this.isMethodSelected(node.objectId, node.methodId);
  }

  selectWaypoint(index: number): void {
    this.session.selectedWaypoints.clear();
    if (index >= 0 && index < this.session.waypoints.length) this.session.selectedWaypoints.add(index);
    this.session.selectedWaypoint = this.session.selectedWaypoints.has(index) ? index : -1;
    if (this.session.selectedWaypoint >= 0) {
      this.session.selectedNodeId = null;
      this.session.selectedMethod = null;
    }
    this.events.selectionChanged.emit({ kind: "waypoint" });
  }

  setWaypoints(indices: readonly number[]): void {
    this.session.selectedWaypoints.clear();
    for (const index of [...indices].sort((a, b) => a - b)) {
      if (index >= 0 && index < this.session.waypoints.length) this.session.selectedWaypoints.add(index);
    }
    this.session.selectedWaypoint = this.session.selectedWaypoints.values().next().value ?? -1;
    if (this.session.selectedWaypoint >= 0) {
      this.session.selectedNodeId = null;
      this.session.selectedMethod = null;
    }
    this.events.selectionChanged.emit({ kind: "waypoint" });
  }

  toggleWaypoint(index: number): void {
    if (index < 0 || index >= this.session.waypoints.length) return;
    if (this.session.selectedWaypoints.has(index)) this.session.selectedWaypoints.delete(index);
    else this.session.selectedWaypoints.add(index);
    this.session.selectedWaypoint = this.session.selectedWaypoints.has(index)
      ? index : (this.session.selectedWaypoints.values().next().value ?? -1);
    if (this.session.selectedWaypoint >= 0) {
      this.session.selectedNodeId = null;
      this.session.selectedMethod = null;
    }
    this.events.selectionChanged.emit({ kind: "waypoint" });
  }

  selectNode(id: string | null): void {
    this.session.selectedNodeId = id && this.session.nodes.some((node) => node.id === id) ? id : null;
    this.session.selectedMethod = null;
    if (this.session.selectedNodeId) {
      this.session.selectedWaypoints.clear();
      this.session.selectedWaypoint = -1;
    }
    this.events.selectionChanged.emit({ kind: "node" });
  }

  selectMethod(objectId: string | null, methodId: string | null): void {
    const object = objectId ? this.session.objects.find((candidate) => candidate.id === objectId) : null;
    const valid = !!object && !!methodId && object.methods.some((method) => method.id === methodId);
    this.session.selectedMethod = valid ? { objectId: objectId!, methodId: methodId! } : null;
    this.session.selectedNodeId = null;
    if (this.session.selectedMethod) {
      this.session.selectedWaypoints.clear();
      this.session.selectedWaypoint = -1;
    }
    this.events.selectionChanged.emit({ kind: this.session.selectedMethod ? "method" : "cleared" });
  }

  clear(): void {
    this.session.selectedWaypoints.clear();
    this.session.selectedWaypoint = -1;
    this.session.selectedNodeId = null;
    this.session.selectedMethod = null;
    this.events.selectionChanged.emit({ kind: "cleared" });
  }
}

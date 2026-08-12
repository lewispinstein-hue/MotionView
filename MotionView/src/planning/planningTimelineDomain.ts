import { hasPlanNodeMethodOverride } from "./planningObjects";
import type { PlanningSession } from "./planningSession";
import { createPlanNodeId } from "./planningState";
import type { PlanningNode, PlanningNodeView } from "./planningTypes";

export class PlanningTimeline {
  constructor(private readonly session: PlanningSession) {}

  get nodes(): readonly PlanningNodeView[] { return this.session.nodes; }
  get length(): number { return this.session.nodes.length; }
  get(id: string): PlanningNodeView | null { return this.session.nodes.find((node) => node.id === id) ?? null; }

  add(values: Omit<PlanningNode, "id"> & { id?: string }): string {
    const id = values.id || createPlanNodeId();
    this.session.mutate("node", () => this.session.nodes.push({ ...values, id }));
    return id;
  }

  insert(objectId: string, methodId: string, beforeWaypoint: number, index: number): PlanningNodeView | null {
    const object = this.session.objects.find((entry) => entry.id === objectId);
    if (!object?.methods.some((method) => method.id === methodId) || this.session.waypoints.length < 2) return null;
    const bucket = Math.max(0, Math.min(this.session.waypoints.length, Math.round(beforeWaypoint || 0)));
    const insertionIndex = Math.max(0, Math.round(index || 0));
    const id = createPlanNodeId();
    this.session.mutate("node", () => {
      for (const node of this.session.nodes) {
        if (node.beforeWaypoint === bucket && node.index >= insertionIndex) node.index += 1;
      }
      this.session.nodes.push({ id, objectId, methodId, beforeWaypoint: bucket, index: insertionIndex });
    });
    return this.get(id);
  }

  move(id: string, beforeWaypoint: number, index: number): PlanningNodeView | null {
    const node = this.session.nodes.find((entry) => entry.id === id);
    if (!node) return null;
    const bucket = Math.max(0, Math.min(this.session.waypoints.length, Math.round(beforeWaypoint || 0)));
    const insertionIndex = Math.max(0, Math.round(index || 0));
    this.session.mutate("node", () => {
      this.session.nodes.splice(this.session.nodes.indexOf(node), 1);
      const bucketNodes = this.session.nodes
        .filter((entry) => entry.beforeWaypoint === bucket)
        .sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
      node.beforeWaypoint = bucket;
      bucketNodes.splice(Math.min(insertionIndex, bucketNodes.length), 0, node);
      bucketNodes.forEach((entry, nextIndex) => { entry.index = nextIndex; });
      this.session.nodes.push(node);
    });
    return this.get(id);
  }

  update(id: string, values: Partial<Omit<PlanningNode, "id">>): void {
    const node = this.session.nodes.find((entry) => entry.id === id);
    if (node) this.session.mutate("node", () => Object.assign(node, values));
  }

  setCodeOverride(id: string, codeValue: unknown): { changed: boolean; hadOverride: boolean; hasOverride: boolean } {
    const node = this.session.nodes.find((entry) => entry.id === id);
    const method = node
      ? this.session.objects.find((entry) => entry.id === node.objectId)?.methods.find((entry) => entry.id === node.methodId)
      : null;
    if (!node || !method) return { changed: false, hadOverride: false, hasOverride: false };
    const nextCode = String(codeValue || "");
    const hadOverride = hasPlanNodeMethodOverride(node);
    const currentCode = Object.prototype.hasOwnProperty.call(node, "code") ? String(node.code || "") : method.code;
    const matchesHost = nextCode === String(method.code || "");
    if (currentCode === nextCode && !(matchesHost && hadOverride)) {
      return { changed: false, hadOverride, hasOverride: hadOverride };
    }
    this.session.mutate("node", () => {
      if (matchesHost) delete node.code;
      else node.code = nextCode;
    });
    return { changed: true, hadOverride, hasOverride: hasPlanNodeMethodOverride(node) };
  }

  remove(id: string): void {
    const index = this.session.nodes.findIndex((node) => node.id === id);
    if (index < 0) return;
    const removedSelection = this.session.selectedNodeId === id;
    this.session.mutate("node", () => this.session.nodes.splice(index, 1));
    if (removedSelection) this.session.events.selectionChanged.emit({ kind: "node" });
  }
}

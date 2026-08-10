import { createPlanMethodId, createPlanObjectId, getDefaultPlanObjectColor, getDefaultPlanObjectName } from "./planningState";
import type { PlanningSession } from "./planningSession";
import type { PlanningMethod, PlanningNode, PlanningNodeView, PlanningObject, PlanningObjectView } from "./planningTypes";

export class PlanningObjects {
  constructor(private readonly session: PlanningSession) {}
  get items(): readonly PlanningObjectView[] { return this.session.objects; }
  get length(): number { return this.session.objects.length; }
  get methodCount(): number { return this.session.objects.reduce((sum, object) => sum + object.methods.length, 0); }

  get(id: string): PlanningObjectView | null { return this.session.objects.find((object) => object.id === id) ?? null; }
  private getMutable(id: string): PlanningObject | null { return this.session.objects.find((object) => object.id === id) ?? null; }
  method(objectId: string, methodId: string): Readonly<PlanningMethod> | null {
    return this.getMutable(objectId)?.methods.find((method) => method.id === methodId) ?? null;
  }

  add(values: Partial<PlanningObject> = {}): string {
    const id = values.id || createPlanObjectId();
    this.session.mutate("object", () => this.session.objects.push({
      id,
      name: values.name ?? getDefaultPlanObjectName(this.session.objects.length),
      color: values.color || getDefaultPlanObjectColor(this.session.objects.length),
      latestMethod: values.latestMethod ?? "",
      methods: values.methods?.map((method) => ({ ...method, code: method.code ?? "" })) ?? [],
    }));
    return id;
  }

  remove(id: string): void {
    const index = this.session.objects.findIndex((object) => object.id === id);
    if (index < 0) return;
    const selectedNodeId = this.session.selectedNodeId;
    this.session.mutate("object", () => {
      this.session.objects.splice(index, 1);
      for (let nodeIndex = this.session.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
        if (this.session.nodes[nodeIndex]?.objectId === id) this.session.nodes.splice(nodeIndex, 1);
      }
    });
    if (selectedNodeId && this.session.selectedNodeId !== selectedNodeId) {
      this.session.events.selectionChanged.emit({ kind: "node" });
    }
  }

  rename(id: string, name: string): void { this.update(id, { name }); }
  setColor(id: string, color: string): void { this.update(id, { color }); }
  setLatestMethod(id: string, latestMethod: string): void { this.update(id, { latestMethod }); }

  update(id: string, values: Partial<Omit<PlanningObject, "id" | "methods">>): void {
    const object = this.getMutable(id);
    if (!object) return;
    this.session.mutate("object", () => Object.assign(object, values));
  }

  addMethod(objectId: string, values: Partial<PlanningMethod> = {}): string | null {
    const object = this.getMutable(objectId);
    if (!object) return null;
    const id = values.id || createPlanMethodId();
    this.session.mutate("method", () => object.methods.push({ id, name: values.name ?? "", code: values.code ?? "" }));
    return id;
  }

  updateMethod(objectId: string, methodId: string, values: Partial<Omit<PlanningMethod, "id">>): void {
    const method = this.getMutable(objectId)?.methods.find((entry) => entry.id === methodId);
    if (!method) return;
    this.session.mutate("method", () => Object.assign(method, values));
  }

  removeMethod(objectId: string, methodId: string): void {
    const object = this.getMutable(objectId);
    const index = object?.methods.findIndex((method) => method.id === methodId) ?? -1;
    if (!object || index < 0) return;
    const selectedNodeId = this.session.selectedNodeId;
    this.session.mutate("method", () => {
      object.methods.splice(index, 1);
      for (let nodeIndex = this.session.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
        const node = this.session.nodes[nodeIndex];
        if (node?.objectId === objectId && node.methodId === methodId) this.session.nodes.splice(nodeIndex, 1);
      }
    });
    if (selectedNodeId && this.session.selectedNodeId !== selectedNodeId) {
      this.session.events.selectionChanged.emit({ kind: "node" });
    }
  }
}

export interface EffectivePlanningMethod {
  name: string;
  code: string;
  hostName: string;
  hostCode: string;
  hasOverride: boolean;
}

export function getPlanObjectById(objects: readonly PlanningObjectView[], objectId: string): PlanningObjectView | null {
  return objects.find((entry) => entry.id === objectId) ?? null;
}

export function getPlanMethodById(objects: readonly PlanningObjectView[], objectId: string, methodId: string): Readonly<PlanningMethod> | null {
  return getPlanObjectById(objects, objectId)?.methods?.find((entry) => entry.id === methodId) ?? null;
}

export function hasPlanNodeMethodOverride(node: PlanningNode | null | undefined): boolean {
  return !!node && (Object.prototype.hasOwnProperty.call(node, "name") || Object.prototype.hasOwnProperty.call(node, "code"));
}

export function getPlanNodeEffectiveMethod(
  objects: readonly PlanningObjectView[],
  node: PlanningNodeView | null | undefined,
): EffectivePlanningMethod | null {
  if (!node) return null;
  const method = getPlanMethodById(objects, node.objectId, node.methodId);
  if (!method) return null;
  return {
    name: Object.prototype.hasOwnProperty.call(node, "name") ? String(node.name || "") : method.name,
    code: Object.prototype.hasOwnProperty.call(node, "code") ? String(node.code || "") : method.code,
    hostName: method.name,
    hostCode: method.code,
    hasOverride: hasPlanNodeMethodOverride(node),
  };
}

export function setPlanNodeCodeOverride(
  objects: readonly PlanningObject[],
  node: PlanningNode | null | undefined,
  codeValue: unknown,
): boolean {
  if (!node) return false;
  const method = getPlanMethodById(objects, node.objectId, node.methodId);
  if (!method) return false;
  const nextCode = String(codeValue || "");
  const hadNameOverride = Object.prototype.hasOwnProperty.call(node, "name");
  const hadCodeOverride = Object.prototype.hasOwnProperty.call(node, "code");
  const currentCode = hadCodeOverride ? node.code : method.code;
  const matchesHost = nextCode === String(method.code || "");
  const changed = hadNameOverride || nextCode !== String(currentCode || "") || (hadCodeOverride && matchesHost);
  if (!changed) return false;
  delete node.name;
  if (matchesHost) delete node.code;
  else node.code = nextCode;
  return true;
}

export function serializePlanNode(node: PlanningNode): PlanningNode {
  const serialized: PlanningNode = {
    id: node.id, objectId: node.objectId, methodId: node.methodId,
    beforeWaypoint: node.beforeWaypoint, index: node.index,
  };
  if (Object.prototype.hasOwnProperty.call(node, "name")) serialized.name = node.name;
  if (Object.prototype.hasOwnProperty.call(node, "code")) serialized.code = node.code;
  return serialized;
}

export function getPlanMethodNumber(objects: readonly PlanningObjectView[], objectId: string, methodId: string): number | null {
  const index = getPlanObjectById(objects, objectId)?.methods.findIndex((entry) => entry.id === methodId) ?? -1;
  return index >= 0 ? index + 1 : null;
}

export function getPlanMethodTooltipName(name: unknown): string {
  const value = String(name || "").trim();
  if (!value) return "Method";
  return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}

import type { PlanningMethod, PlanningNode, PlanningObject } from "./planningTypes";

export interface EffectivePlanningMethod {
  name: string;
  code: string;
  hostName: string;
  hostCode: string;
  hasOverride: boolean;
}

export function getPlanObjectById(objects: PlanningObject[], objectId: string): PlanningObject | null {
  return objects.find((entry) => entry.id === objectId) || null;
}

export function getPlanMethodById(objects: PlanningObject[], objectId: string, methodId: string): PlanningMethod | null {
  return getPlanObjectById(objects, objectId)?.methods?.find((entry) => entry.id === methodId) || null;
}

export function hasPlanNodeMethodOverride(node: PlanningNode | null | undefined) {
  return !!node && (
    Object.prototype.hasOwnProperty.call(node, "name") ||
    Object.prototype.hasOwnProperty.call(node, "code")
  );
}

export function getPlanNodeEffectiveMethod(
  objects: PlanningObject[],
  node: PlanningNode | null | undefined,
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
  objects: PlanningObject[],
  node: PlanningNode | null | undefined,
  codeValue: unknown,
) {
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
    id: node.id,
    objectId: node.objectId,
    methodId: node.methodId,
    beforeWaypoint: node.beforeWaypoint,
    index: node.index,
  };
  if (Object.prototype.hasOwnProperty.call(node, "name")) serialized.name = node.name;
  if (Object.prototype.hasOwnProperty.call(node, "code")) serialized.code = node.code;
  return serialized;
}

export function getPlanMethodNumber(objects: PlanningObject[], objectId: string, methodId: string) {
  const methods = getPlanObjectById(objects, objectId)?.methods || [];
  const index = methods.findIndex((entry) => entry.id === methodId);
  return index >= 0 ? index + 1 : null;
}

export function getPlanMethodTooltipName(name: unknown) {
  const value = String(name || "").trim();
  if (!value) return "Method";
  return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}

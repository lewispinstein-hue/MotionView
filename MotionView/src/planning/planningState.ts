import type { PlanningNode, PlanningObject } from "./planningTypes";

export const DEFAULT_PLAN_OBJECT_COLORS = [
  "#6d8fb3",
  "#8b7ab8",
  "#739d87",
  "#b38a6d",
  "#a06f87",
] as const;

export function createPlanObjectId() {
  return `plan-object-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPlanMethodId() {
  return `plan-method-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPlanNodeId() {
  return `plan-node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDefaultPlanObjectColor(index = 0) {
  return DEFAULT_PLAN_OBJECT_COLORS[index % DEFAULT_PLAN_OBJECT_COLORS.length];
}

export function getDefaultPlanObjectName(index = 0) {
  return `Object ${index + 1}`;
}

export function getContrastTextColor(hexcolor: unknown) {
  const normalized = String(hexcolor || "").replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

export function normalizePlanObjects(value: unknown): PlanningObject[] {
  if (!Array.isArray(value)) return [];
  return value.map((rawObj: unknown, index: number) => {
    const obj = rawObj as Record<string, any> | null | undefined;
    const rawMethods = Array.isArray(obj?.methods) ? obj.methods : [];
    return {
      id: (typeof obj?.id === "string" && obj.id.trim()) ? obj.id.trim() : createPlanObjectId(),
      name: typeof obj?.name === "string" ? obj.name : "",
      color: (typeof obj?.color === "string" && obj.color.trim()) ? obj.color.trim() : getDefaultPlanObjectColor(index),
      latestMethod: typeof obj?.latestMethod === "string" ? obj.latestMethod : "",
      methods: rawMethods.map((method: any, methodIndex: number) => ({
        id: (typeof method?.id === "string" && method.id.trim()) ? method.id.trim() : `plan-method-${index + 1}-${methodIndex + 1}`,
        name: typeof method?.name === "string" ? method.name : "",
        code: typeof method?.code === "string" ? method.code : "",
      })),
    };
  });
}

export function normalizePlanNodes(value: unknown): PlanningNode[] {
  if (!Array.isArray(value)) return [];
  return value.map((rawNode: unknown) => {
    const node = rawNode as Record<string, any> | null | undefined;
    const normalized: PlanningNode = {
      id: (typeof node?.id === "string" && node.id.trim()) ? node.id.trim() : createPlanNodeId(),
      objectId: typeof node?.objectId === "string" ? node.objectId : "",
      methodId: typeof node?.methodId === "string" ? node.methodId : "",
      beforeWaypoint: Math.max(0, Number(node?.beforeWaypoint) || 0),
      index: Math.max(0, Number(node?.index) || 0),
    };
    if (Object.prototype.hasOwnProperty.call(node || {}, "name")) normalized.name = typeof node?.name === "string" ? node.name : "";
    if (Object.prototype.hasOwnProperty.call(node || {}, "code")) normalized.code = typeof node?.code === "string" ? node.code : "";
    return normalized;
  });
}

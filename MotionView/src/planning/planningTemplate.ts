import type { PlanningNode, PlanningObject, PlanningTelemetrySnapshot, PlanningWaypoint } from "./planningTypes";
import { getPlanNodeEffectiveMethod } from "./planningObjects";

export interface BuildPlanExportCodeOptions {
  template: string;
  waypoints: PlanningWaypoint[];
  nodes: PlanningNode[];
  objects: PlanningObject[];
  readPlanSpeed(value: unknown, fallback?: number): number;
  formatTemplateNumber(value: unknown, decimals?: number): string;
  planThetaDegAt(index: number): number;
  getSortedPlanNodes(): PlanningNode[];
}

export function getUtf8ByteLength(value: unknown) {
  const text = String(value ?? "");
  if (typeof TextEncoder === "function") return new TextEncoder().encode(text).length;
  return text.length;
}

export function getPlanningTelemetryProperties(
  waypoints: PlanningWaypoint[],
  objects: PlanningObject[],
  nodes: PlanningNode[],
  template: string,
  extra: Record<string, unknown> = {},
): PlanningTelemetrySnapshot {
  const methodCount = objects.reduce((sum, obj) => sum + (Array.isArray(obj.methods) ? obj.methods.length : 0), 0);
  return {
    plan_waypoints: waypoints.length,
    plan_objects: objects.length,
    plan_methods: methodCount,
    plan_nodes: nodes.length,
    template_chars: String(template || "").length,
    ...extra,
  };
}

export function buildPlanExportCode(options: BuildPlanExportCodeOptions) {
  const rawTemplate = String(options.template ?? "");
  if (!rawTemplate.trim()) return "";

  const renderWaypointBlock = (point: PlanningWaypoint, index: number) => {
    const prev = options.waypoints[index - 1];
    const distance = prev ? Math.hypot(point.x - prev.x, point.y - prev.y) : 0;
    const replacements: Record<string, string> = {
      x: options.formatTemplateNumber(point.x),
      y: options.formatTemplateNumber(point.y),
      theta: options.formatTemplateNumber(options.planThetaDegAt(index)),
      distance: options.formatTemplateNumber(distance),
      iteration: String(index),
      speed: options.formatTemplateNumber(options.readPlanSpeed(point.speed, 127), 0),
    };
    return rawTemplate.replace(/\$\{(x|y|theta|distance|iteration|speed)\}/g, (_, token) => replacements[token] ?? "");
  };

  const nodesByBucket = new Map<number, PlanningNode[]>();
  for (const node of options.getSortedPlanNodes()) {
    const arr = nodesByBucket.get(node.beforeWaypoint) || [];
    arr.push(node);
    nodesByBucket.set(node.beforeWaypoint, arr);
  }

  const blocks: string[] = [];
  const appendBucketMethods = (beforeWaypoint: number) => {
    const bucketNodes = nodesByBucket.get(beforeWaypoint) || [];
    for (const node of bucketNodes) {
      const method = getPlanNodeEffectiveMethod(options.objects, node);
      if (!method) continue;
      blocks.push(String(method.code || ""));
    }
  };

  appendBucketMethods(0);
  for (let i = 0; i < options.waypoints.length; i += 1) {
    blocks.push(renderWaypointBlock(options.waypoints[i], i));
    appendBucketMethods(i + 1);
  }

  return blocks.join("\n");
}

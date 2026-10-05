import type { PlanningNode, PlanningNodeView, PlanningObject, PlanningObjectView, PlanningTelemetrySnapshot, PlanningWaypoint, PlanningWaypointView } from "./planningTypes";
import { getPlanNodeEffectiveMethod } from "./planningObjects";

export interface BuildPlanExportCodeOptions {
  template: string;
  waypoints: readonly PlanningWaypointView[];
  nodes: readonly PlanningNodeView[];
  objects: readonly PlanningObjectView[];
  readPlanSpeed(value: unknown, fallback?: number): number;
  formatTemplateNumber(value: unknown, decimals?: number): string;
  planThetaDegAt(index: number): number;
  getSortedPlanNodes(): readonly PlanningNodeView[];
}

export function getUtf8ByteLength(value: unknown) {
  const text = String(value ?? "");
  if (typeof TextEncoder === "function") return new TextEncoder().encode(text).length;
  return text.length;
}

export function getPlanningTelemetryProperties(
  waypoints: readonly Readonly<PlanningWaypoint>[],
  objects: readonly Readonly<PlanningObject>[],
  nodes: readonly Readonly<PlanningNode>[],
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

function isWaypointForwards(
  point: Readonly<PlanningWaypoint>,
  next: Readonly<PlanningWaypoint> | undefined,
  theta: number,
): boolean {
  if (!next) return true;
  const dx = next.x - point.x;
  const dy = next.y - point.y;
  if (dx === 0 && dy === 0) return true;
  const pathTheta = Math.atan2(dx, dy) * 180 / Math.PI;
  const delta = ((pathTheta - theta + 540) % 360) - 180;
  return Math.abs(delta) <= 90;
}

export function buildPlanExportCode(options: BuildPlanExportCodeOptions) {
  const rawTemplate = String(options.template ?? "");
  if (!rawTemplate.trim()) return "";

  const renderTemplate = (template: string, point: Readonly<PlanningWaypoint>, index: number) => {
    const prev = options.waypoints[index - 1];
    const distance = prev ? Math.hypot(point.x - prev.x, point.y - prev.y) : 0;
    const theta = options.planThetaDegAt(index);
    const replacements: Record<string, string> = {
      x: options.formatTemplateNumber(point.x),
      y: options.formatTemplateNumber(point.y),
      theta: options.formatTemplateNumber(theta),
      distance: options.formatTemplateNumber(distance),
      iteration: String(index),
      speed: options.formatTemplateNumber(options.readPlanSpeed(point.speed, 127), 0),
      forwards: String(isWaypointForwards(point, options.waypoints[index + 1], theta)),
    };
    return String(template || "").replace(/\$\{(x|y|theta|distance|iteration|speed|forwards)\}/g, (_, token) => replacements[token] ?? "");
  };

  const nodesByBucket = new Map<number, Readonly<PlanningNode>[]>();
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
    blocks.push(renderTemplate(rawTemplate, options.waypoints[i], i));
    appendBucketMethods(i + 1);
  }

  return blocks.join("\n");
}

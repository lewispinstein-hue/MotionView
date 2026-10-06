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
  start: Readonly<PlanningWaypoint>,
  end: Readonly<PlanningWaypoint> | undefined,
  startTheta: number,
): boolean {
  if (!end) return true;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return true;
  const pathTheta = Math.atan2(dx, dy) * 180 / Math.PI;
  const delta = ((pathTheta - startTheta + 540) % 360) - 180;
  return Math.abs(delta) <= 90;
}

export function buildPlanExportCode(options: BuildPlanExportCodeOptions) {
  const rawTemplate = String(options.template ?? "");
  const defaultReplacements: Record<string, string> = {
    x: "0",
    y: "0",
    theta: "0",
    distance: "0",
    iteration: "0",
    speed: "0",
    forwards: "true",
  };

  const replacementsForNodeWaypoint = (point: Readonly<PlanningWaypoint>, index: number) => {
    const prev = options.waypoints[index - 1];
    const distance = prev ? Math.hypot(point.x - prev.x, point.y - prev.y) : 0;
    const theta = options.planThetaDegAt(index);
    return {
      x: options.formatTemplateNumber(point.x),
      y: options.formatTemplateNumber(point.y),
      theta: options.formatTemplateNumber(theta),
      distance: options.formatTemplateNumber(distance),
      iteration: String(index),
      speed: options.formatTemplateNumber(options.readPlanSpeed(point.speed, 127), 0),
      forwards: String(isWaypointForwards(point, options.waypoints[index + 1], theta)),
    };
  };

  const replacementsForSegment = (
    start: Readonly<PlanningWaypoint>,
    end: Readonly<PlanningWaypoint>,
    index: number,
  ) => {
    const theta = options.planThetaDegAt(index + 1);
    return {
      x: options.formatTemplateNumber(end.x),
      y: options.formatTemplateNumber(end.y),
      theta: options.formatTemplateNumber(theta),
      distance: options.formatTemplateNumber(Math.hypot(end.x - start.x, end.y - start.y)),
      iteration: String(index),
      speed: options.formatTemplateNumber(options.readPlanSpeed(start.speed, 127), 0),
      forwards: String(isWaypointForwards(start, end, options.planThetaDegAt(index))),
    };
  };

  const renderTemplate = (template: string, replacements: Readonly<Record<string, string>>) => {
    return String(template || "").replace(/\$\{(x|y|theta|distance|iteration|speed|forwards)\}/g, (_, token) => replacements[token] ?? "");
  };

  const renderSegmentTemplate = (
    template: string,
    start: Readonly<PlanningWaypoint>,
    end: Readonly<PlanningWaypoint>,
    index: number,
  ) => renderTemplate(template, replacementsForSegment(start, end, index));

  const renderNodeTemplate = (template: string, beforeWaypoint: number) => {
    const index = Math.max(0, Math.trunc(beforeWaypoint) - 1);
    const point = options.waypoints[index];
    return renderTemplate(template, point ? replacementsForNodeWaypoint(point, index) : defaultReplacements);
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
      blocks.push(renderNodeTemplate(String(method.code || ""), beforeWaypoint));
    }
  };

  appendBucketMethods(0);
  for (let i = 0; i < options.waypoints.length - 1; i += 1) {
    const start = options.waypoints[i];
    const end = options.waypoints[i + 1];
    if (!start || !end) continue;
    const template = Object.prototype.hasOwnProperty.call(start, "overrideCode")
      ? String(start.overrideCode ?? "")
      : rawTemplate;
    blocks.push(renderSegmentTemplate(template, start, end, i));
    appendBucketMethods(i + 1);
  }

  const code = blocks.join("\n");
  return /\S/.test(code) ? code : "";
}

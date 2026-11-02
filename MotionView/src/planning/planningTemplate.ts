import type {
  PlanningNode,
  PlanningNodeView,
  PlanningObjectView,
  PlanningWaypoint,
  PlanningWaypointView,
} from "./planningTypes";
import { getPlanNodeEffectiveMethod } from "./planningObjects";
import type { PlanMotionTemplates } from "../state/models";
import { createDefaultMotionTemplates, getWaypointCode, normalizeMotionTemplates } from "./planningMotions";
import { isSegmentForwards, waypointLead } from "./planningSegments";

const TEMPLATE_SHORTHAND_TOKENS: Readonly<Record<string, string>> = {
  x: "x",
  y: "y",
  dist: "distance",
  spd: "speed",
  th: "theta",
  iter: "iteration",
  fwd: "forwards",
  ld: "lead",
};

export interface BuildPlanExportCodeOptions {
  template: string;
  motionTemplates?: Readonly<PlanMotionTemplates>;
  waypoints: readonly PlanningWaypointView[];
  nodes: readonly PlanningNodeView[];
  objects: readonly PlanningObjectView[];
  readPlanSpeed(value: unknown, fallback?: number): number;
  formatTemplateNumber(value: unknown, decimals?: number): string;
  planThetaDegAt(index: number): number;
  getSortedPlanNodes(): readonly PlanningNodeView[];
}

export function buildPlanExportCode(options: BuildPlanExportCodeOptions) {
  const rawTemplate = String(options.template ?? "");
  const motionTemplates = normalizeMotionTemplates(options.motionTemplates, createDefaultMotionTemplates(rawTemplate));
  const defaultReplacements: Record<string, string> = {
    x: "0",
    y: "0",
    theta: "0",
    distance: "0",
    iteration: "0",
    speed: "0",
    forwards: "true",
    lead: "0",
  };

  const replacementsForNodeWaypoint = (
    point: Readonly<PlanningWaypoint>,
    index: number,
  ) => {
    const prev = options.waypoints[index - 1];
    const distance = prev ? Math.hypot(point.x - prev.x, point.y - prev.y) : 0;
    const theta = options.planThetaDegAt(index);
    return {
      x: options.formatTemplateNumber(point.x),
      y: options.formatTemplateNumber(point.y),
      theta: options.formatTemplateNumber(theta),
      distance: options.formatTemplateNumber(distance),
      iteration: String(index),
      speed: options.formatTemplateNumber(
        options.readPlanSpeed(point.speed, 127),
        0,
      ),
      forwards: String(
        isSegmentForwards({ ...point, theta }, options.waypoints[index + 1]),
      ),
      lead: options.formatTemplateNumber(waypointLead(point)),
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
      distance: options.formatTemplateNumber(
        Math.hypot(end.x - start.x, end.y - start.y),
      ),
      iteration: String(index),
      speed: options.formatTemplateNumber(
        options.readPlanSpeed(start.speed, 127),
        0,
      ),
      forwards: String(
        isSegmentForwards({ ...start, theta: options.planThetaDegAt(index) }, end),
      ),
      lead: options.formatTemplateNumber(waypointLead(start)),
    };
  };

  const renderTemplate = (
    template: string,
    replacements: Readonly<Record<string, string>>,
  ) => {
    return String(template || "")
      .replace(
        /\$\{(x|y|theta|distance|iteration|speed|forwards|lead)\}/g,
        (_, token) => replacements[token] ?? "",
      )
      .replace(
        /(^|[^A-Za-z0-9_])@(x|y|dist|spd|th|iter|fwd|ld)(?![A-Za-z0-9_])/g,
        (_, prefix: string, token: string) =>
          `${prefix}${replacements[TEMPLATE_SHORTHAND_TOKENS[token]] ?? ""}`,
      );
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
    return renderTemplate(
      template,
      point ? replacementsForNodeWaypoint(point, index) : defaultReplacements,
    );
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
      blocks.push(
        renderNodeTemplate(String(method.code || ""), beforeWaypoint),
      );
    }
  };

  appendBucketMethods(0);
  for (let i = 0; i < options.waypoints.length - 1; i += 1) {
    const start = options.waypoints[i];
    const end = options.waypoints[i + 1];
    if (!start || !end) continue;
    const template = getWaypointCode(start, motionTemplates);
    blocks.push(renderSegmentTemplate(template, start, end, i));
    appendBucketMethods(i + 1);
  }

  const code = blocks.join("\n");
  return /\S/.test(code) ? code : "";
}

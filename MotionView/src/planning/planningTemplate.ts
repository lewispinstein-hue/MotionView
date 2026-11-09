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
import { normalizePlanningMinSpeed, segmentDriveHeading } from "./planningMotionContext";
import type { PlanningSwingDriveSides, PlanningTemplateLanguage, PlanningTemplateLibrary } from "./planningTemplatePresets";

const TEMPLATE_SHORTHAND_TOKENS: Readonly<Record<string, string>> = {
  x: "x",
  y: "y",
  dist: "distance",
  spd: "speed",
  minspd: "minSpeed",
  th: "theta",
  iter: "iteration",
  fwd: "forwards",
  ld: "lead",
  side: "lockedDriveSide",
  bearing: "bearing",
};

export interface BuildPlanExportCodeOptions {
  template: string;
  motionTemplates?: Readonly<PlanMotionTemplates>;
  templateLibrary?: PlanningTemplateLibrary;
  language?: PlanningTemplateLanguage;
  swingDriveSides?: Readonly<PlanningSwingDriveSides>;
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
  const swingDriveSides = options.swingDriveSides ?? { left: "left", right: "right" };
  const booleanCode = (value: boolean) => options.language === "python" ? (value ? "True" : "False") : String(value);
  const lockedDriveSide = (point?: Readonly<PlanningWaypoint>) => {
    const swing = point?.motions?.find(motion => motion.type === "swing");
    return swingDriveSides[swing?.lockedDriveSide === "right" ? "right" : "left"];
  };
  const defaultReplacements: Record<string, string> = {
    x: "0",
    y: "0",
    theta: "0",
    distance: "0",
    iteration: "0",
    speed: "0",
    minSpeed: "0",
    forwards: booleanCode(true),
    lead: "0",
    lockedDriveSide: lockedDriveSide(),
    bearing: "0",
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
      minSpeed: options.formatTemplateNumber(normalizePlanningMinSpeed(point.minSpeed, point.speed), 0),
      forwards: booleanCode(
        isSegmentForwards({ ...point, theta }, options.waypoints[index + 1]),
      ),
      lead: options.formatTemplateNumber(waypointLead(point)),
      lockedDriveSide: lockedDriveSide(point),
      bearing: options.formatTemplateNumber(segmentDriveHeading(
        { ...point, theta }, options.waypoints[index + 1],
      )),
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
      minSpeed: options.formatTemplateNumber(normalizePlanningMinSpeed(start.minSpeed, start.speed), 0),
      forwards: booleanCode(
        isSegmentForwards({ ...start, theta: options.planThetaDegAt(index) }, end),
      ),
      lead: options.formatTemplateNumber(waypointLead(start)),
      lockedDriveSide: lockedDriveSide(start),
      bearing: options.formatTemplateNumber(segmentDriveHeading(
        { ...start, theta: options.planThetaDegAt(index) }, end,
      )),
    };
  };

  const renderTemplate = (
    template: string,
    replacements: Readonly<Record<string, string>>,
  ) => {
    // One pass keeps inserted side values literal, including any @ or ${} text.
    return String(template || "").replace(
      /\$\{(x|y|theta|distance|iteration|speed|minSpeed|forwards|lead|lockedDriveSide|bearing)\}|(^|[^A-Za-z0-9_])@(x|y|dist|spd|minspd|th|iter|fwd|ld|side|bearing)(?![A-Za-z0-9_])/g,
      (_, full: string | undefined, prefix: string, short: string) => full
        ? replacements[full] ?? ""
        : `${prefix}${replacements[TEMPLATE_SHORTHAND_TOKENS[short]] ?? ""}`,
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
    const template = getWaypointCode(start, motionTemplates, options.templateLibrary);
    blocks.push(renderSegmentTemplate(template, start, end, i));
    appendBucketMethods(i + 1);
  }

  const code = blocks.join("\n");
  if (!/\S/.test(code)) return "";
  return options.language === "python"
    ? code.replace(/^(?=[^\r\n]*\S)/gm, "    ")
    : code;
}

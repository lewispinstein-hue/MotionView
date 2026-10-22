import { normalizeWaypointIndicatorIcons } from "./planningIndicators";
import {
  createPlanPathId,
  normalizePlanNodes,
} from "./planningState";
import type {
  PlanningCodeExportSettings,
  PlanningCodeExportTarget,
  PlanningNode,
  PlanningObject,
  PlanningPath,
  PlanningWaypoint,
} from "./planningTypes";

export const DEFAULT_PLANNING_CODE_EXPORT_SETTINGS: PlanningCodeExportSettings = {
  header: "",
  footer: "",
  target: "downloads",
  path: "",
};

export function clonePlanningWaypoint(
  point: Readonly<PlanningWaypoint>,
): PlanningWaypoint {
  const cloned: PlanningWaypoint = {
    x: point.x,
    y: point.y,
    theta: point.theta ?? 0,
    speed: point.speed ?? 127,
  };
  const indicatorIcons = normalizeWaypointIndicatorIcons(point.indicatorIcons);
  if (
    indicatorIcons.length ||
    Object.prototype.hasOwnProperty.call(point, "indicatorIcons")
  ) {
    cloned.indicatorIcons = indicatorIcons;
  }
  if (Object.prototype.hasOwnProperty.call(point, "overrideCode")) {
    cloned.overrideCode = String(point.overrideCode ?? "");
  }
  return cloned;
}

export function clonePlanningObject(
  object: Readonly<PlanningObject>,
): PlanningObject {
  return {
    ...object,
    methods: object.methods.map((method) => ({ ...method })),
  };
}

export function clonePlanningNode(node: Readonly<PlanningNode>): PlanningNode {
  return { ...node };
}

export function clonePlanningCodeExportSettings(
  settings: Readonly<PlanningCodeExportSettings>,
): PlanningCodeExportSettings {
  return {
    header: settings.header,
    footer: settings.footer,
    target: settings.target,
    path: settings.path,
  };
}

export function clonePlanningPath(path: Readonly<PlanningPath>): PlanningPath {
  return {
    id: path.id,
    name: path.name,
    waypoints: path.waypoints.map(clonePlanningWaypoint),
    nodes: path.nodes.map(clonePlanningNode),
    codeExport: clonePlanningCodeExportSettings(path.codeExport),
  };
}

export function normalizePlanningCodeExportSettings(
  value: unknown,
  fallback: Readonly<PlanningCodeExportSettings>,
): PlanningCodeExportSettings {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    header:
      typeof source.header === "string" ? source.header : fallback.header,
    footer:
      typeof source.footer === "string" ? source.footer : fallback.footer,
    target: isCodeExportTarget(source.target) ? source.target : fallback.target,
    path: typeof source.path === "string" ? source.path : fallback.path,
  };
}

export function normalizePlanningPathName(
  value: unknown,
  fallback: string,
): string {
  const name =
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return name || fallback;
}

/** Parses every persisted route while retaining legacy single-route support. */
export function loadPlanningPaths(
  data: Readonly<Record<string, unknown>>,
  legacyCodeExportSettings: Readonly<PlanningCodeExportSettings>,
): PlanningPath[] {
  const importedPaths = Array.isArray(data["planned-paths"])
    ? data["planned-paths"]
    : null;
  const migrateLegacyExport = usesLegacyWaypointExport(data);
  const paths = importedPaths?.length
    ? importedPaths.map((raw, index) =>
        normalizePlanningPath(
          raw,
          `Path ${index + 1}`,
          migrateLegacyExport,
          legacyCodeExportSettings,
        ),
      )
    : [
        normalizePlanningPath(
          {
            id: createPlanPathId(),
            name: legacyPathNameFromDocument(data),
            "planned-path": data["planned-path"],
            "planned-nodes": data["planned-nodes"],
            "planned-code-export": data["planned-code-export"],
          },
          legacyPathNameFromDocument(data),
          migrateLegacyExport,
          legacyCodeExportSettings,
        ),
      ];
  const ids = new Set<string>();
  for (const path of paths) {
    if (ids.has(path.id)) path.id = createPlanPathId();
    ids.add(path.id);
  }
  return paths;
}

function isCodeExportTarget(value: unknown): value is PlanningCodeExportTarget {
  return (
    value === "downloads" ||
    value === "desktop" ||
    value === "documents" ||
    value === "project" ||
    value === "custom"
  );
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function usesLegacyWaypointExport(
  data: Readonly<Record<string, unknown>>,
): boolean {
  if (data["planned-segment-export"] === true) return false;
  const meta =
    data.meta && typeof data.meta === "object"
      ? (data.meta as Record<string, unknown>)
      : null;
  const schemaVersion = Number(meta?.SchemaVersion);
  return !Number.isFinite(schemaVersion) || schemaVersion < 4;
}

/** Moves legacy arrival-based waypoint content onto its departing route segment. */
function migrateLegacyWaypointExport(waypoints: PlanningWaypoint[]): void {
  if (waypoints.length < 2) return;
  const legacyWaypoints = waypoints.map(clonePlanningWaypoint);
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const source = waypoints[index]!;
    const destination = legacyWaypoints[index + 1]!;
    source.speed = destination.speed;
    if (Object.prototype.hasOwnProperty.call(destination, "overrideCode")) {
      source.overrideCode = destination.overrideCode ?? "";
    } else {
      delete source.overrideCode;
    }
    if (Object.prototype.hasOwnProperty.call(destination, "indicatorIcons")) {
      source.indicatorIcons = normalizeWaypointIndicatorIcons(
        destination.indicatorIcons,
      );
    } else {
      delete source.indicatorIcons;
    }
  }
  const finalWaypoint = waypoints.at(-1)!;
  delete finalWaypoint.overrideCode;
  delete finalWaypoint.indicatorIcons;
}

function normalizePlanningPath(
  raw: unknown,
  fallbackName: string,
  migrateLegacyExport: boolean,
  legacyCodeExportSettings: Readonly<PlanningCodeExportSettings>,
): PlanningPath {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const waypoints = normalizeWaypoints(
    source["planned-path"] ?? source.waypoints,
  );
  if (migrateLegacyExport) migrateLegacyWaypointExport(waypoints);
  return {
    id:
      typeof source.id === "string" && source.id.trim()
        ? source.id.trim()
        : createPlanPathId(),
    name: normalizePlanningPathName(source.name, fallbackName),
    waypoints,
    nodes: normalizePlanNodes(source["planned-nodes"] ?? source.nodes),
    codeExport: normalizePlanningCodeExportSettings(
      source["planned-code-export"] ?? source.codeExport,
      legacyCodeExportSettings,
    ),
  };
}

function normalizeWaypoints(value: unknown): PlanningWaypoint[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const point = raw as Record<string, unknown>;
    const waypoint: PlanningWaypoint = {
      x: finiteNumber(point?.x),
      y: finiteNumber(point?.y),
      theta: finiteNumber(point?.theta),
      speed: Number.isFinite(Number(point?.speed))
        ? Math.max(1, Math.min(127, Number(point?.speed)))
        : 127,
    };
    const indicatorIcons = normalizeWaypointIndicatorIcons(
      point?.indicatorIcons,
    );
    if (indicatorIcons.length) waypoint.indicatorIcons = indicatorIcons;
    if (
      Object.prototype.hasOwnProperty.call(point || {}, "overrideCode") &&
      typeof point?.overrideCode === "string"
    ) {
      waypoint.overrideCode = point.overrideCode;
    }
    return waypoint;
  });
}

function legacyPathNameFromDocument(
  data: Readonly<Record<string, unknown>>,
): string {
  const meta =
    data.meta && typeof data.meta === "object"
      ? (data.meta as Record<string, unknown>)
      : null;
  return normalizePlanningPathName(meta?.PathName, "Path 1");
}

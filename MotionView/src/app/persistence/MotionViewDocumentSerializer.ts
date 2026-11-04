import type { MotionViewApp } from "../MotionViewApp";
import {
  normalizeWaypointIndicatorIcons,
  normalizeWaypointMotions,
  serializePlanNode,
} from "../../planning";
import { normalizeWaypointType, waypointEventCount } from "../../viewing";
import type { MotionViewSettings } from "../settings";
import { isBoomerangWaypoint, waypointLead } from "../../planning/planningSegments";
import {
  serializePlanningTemplateConfiguration,
  type PlanningTemplateConfiguration,
} from "../../planning/planningTemplatePresets";
import { supportsPlanningMotion } from "../../planning/planningTemplateCapabilities";
import { normalizePlanningMinSpeed } from "../../planning/planningMotionContext";

export type MotionViewExportType = "viewing" | "planning" | "both";

function level(value: unknown): "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" {
  const normalized = String(value ?? "INFO").toUpperCase();
  return normalized === "DEBUG" ||
    normalized === "WARN" ||
    normalized === "ERROR" ||
    normalized === "FATAL"
    ? normalized
    : "INFO";
}

function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(decimals);
  return decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
}

export class MotionViewDocumentSerializer {
  constructor(private readonly app: MotionViewApp) {}

  savedPaths(): string {
    const planning = this.app.planning.exportData();
    return JSON.stringify({
      ...this.planningSessionDocument(planning),
      "robot-path": this.app.viewing.data.poses.map((pose) => ({
        t: pose.t ?? null,
        x: pose.x,
        y: pose.y,
        theta: pose.theta ?? 0,
        l_vel: pose.l_vel ?? null,
        r_vel: pose.r_vel ?? null,
        speed_raw: pose.speed_raw ?? null,
      })),
      watches: this.app.viewing.data.watches.map((watch) => ({
        t: watch.t ?? null,
        id: Number.isInteger(watch.id) ? watch.id : null,
        visible: watch.visible !== false,
        level: watch.level ?? "INFO",
        label: watch.label ?? "",
        value: watch.value ?? "",
      })),
      logs: this.app.viewing.data.logs.map((entry) => ({
        t: entry.t ?? null,
        level: level(entry.level),
        label: entry.label ?? "",
        value: entry.message ?? entry.value ?? "",
        isSystem: entry.isSystem === true,
      })),
      waypoints: this.app.viewing.data.waypoints.map((waypoint) => ({
        id: waypoint.id,
        name: waypoint.name,
        createdTime: waypoint.createdTime ?? null,
        createdEvent: waypoint.createdEvent ?? null,
        events: waypoint.events ?? [],
      })),
    });
  }

  exportPayload(
    type: MotionViewExportType,
    pathName: string,
    settings: Readonly<MotionViewSettings>,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      meta: this.metadata(pathName, settings),
    };
    if (type !== "viewing")
      Object.assign(
        payload,
        this.planningSessionDocument(this.app.planning.exportData()),
      );
    if (type !== "planning") {
      const viewing = this.app.viewing.exportData();
      payload.poses = viewing.poses.map((pose) => ({
        t: pose.t ?? null,
        x: pose.x,
        y: pose.y,
        theta: pose.theta ?? 0,
        l_vel: pose.l_vel ?? null,
        r_vel: pose.r_vel ?? null,
        speed: pose.speed_raw ?? null,
      }));
      payload.watches = viewing.watches.map((watch) => ({
        t: watch.t ?? null,
        id: Number.isInteger(watch.id) ? watch.id : null,
        visible: watch.visible !== false,
        level: watch.level ?? "INFO",
        label: watch.label ?? "",
        value: watch.value ?? "",
      }));
      payload.logs = viewing.logs.map((entry) => ({
        t: entry.t ?? null,
        level: level(entry.level),
        label: entry.label ?? "",
        value: entry.isSystem
          ? `[MVLIB] ${entry.message ?? entry.value ?? ""}`
          : (entry.message ?? entry.value ?? ""),
      }));
      payload.waypoints = viewing.waypoints.map((waypoint) => ({
        id: waypoint.id,
        name: waypoint.name ?? "",
        events: waypoint.events.map((event) => ({
          t: event.t ?? null,
          type: normalizeWaypointType(event.type),
          id: Number.isInteger(event.id) ? event.id : null,
          name: event.name ?? "",
          params: event.params ? { ...event.params } : {},
        })),
      }));
    }
    return payload;
  }

  private planningDocument(
    planning: ReturnType<MotionViewApp["planning"]["exportData"]>,
  ): Record<string, unknown> {
    return {
      "planned-path": this.serializeWaypoints(planning.waypoints, planning.templateConfiguration),
      "planned-segment-export": true,
      "planned-template-configuration": serializePlanningTemplateConfiguration(planning.templateConfiguration),
      "planned-simulation-configuration": structuredClone(planning.simulationConfiguration),
      "planned-objects": planning.objects.map((object) => ({
        id: object.id,
        name: object.name,
        color: object.color || null,
        latestMethod: object.latestMethod || "",
        methods: object.methods.map((method) => ({
          id: method.id,
          name: method.name,
          code: method.code,
        })),
      })),
      "planned-nodes": planning.nodes.map(serializePlanNode),
      "planned-code-export": {
        ...this.app.planning.paths.codeExportSettings,
      },
    };
  }

  /** Full autosave shape, retaining every Planning path and the active path. */
  private planningSessionDocument(
    planning: ReturnType<MotionViewApp["planning"]["exportData"]>,
  ): Record<string, unknown> {
    return {
      ...this.planningDocument(planning),
      "planned-active-path-id": this.app.planning.paths.activeId,
      "planned-paths": this.app.planning.paths.items.map((path) => ({
        id: path.id,
        name: path.name,
        "planned-path": this.serializeWaypoints(path.waypoints, planning.templateConfiguration),
        "planned-nodes": path.nodes.map(serializePlanNode),
        "planned-code-export": { ...path.codeExport },
      })),
    };
  }

  private serializeWaypoints(
    waypoints: ReturnType<MotionViewApp["planning"]["exportData"]>["waypoints"],
    configuration: Readonly<PlanningTemplateConfiguration>,
  ): Record<string, unknown>[] {
    const templates = configuration.templates[configuration.library];
    return waypoints.map((point) => {
      const indicatorIcons = normalizeWaypointIndicatorIcons(
        point.indicatorIcons,
      );
      const serialized: Record<string, unknown> = {
        x: point.x,
        y: point.y,
        theta: point.theta ?? 0,
        speed: Math.max(1, Math.min(127, Number(point.speed) || 127)),
      };
      const minSpeed = normalizePlanningMinSpeed(point.minSpeed, point.speed);
      if (minSpeed > 0) serialized.minSpeed = minSpeed;
      if (typeof point.forwards === "boolean") serialized.forwards = point.forwards;
      if (indicatorIcons.length) serialized.indicatorIcons = indicatorIcons;
      if (isBoomerangWaypoint(point)) serialized.lead = waypointLead(point);
      if (Array.isArray(point.motions)) {
        serialized.motions = normalizeWaypointMotions(point.motions).map(motion => {
          // Unsupported VEXcode motions retain their original code for switching
          // back to another library; their temporary counterparts ignore it.
          if (supportsPlanningMotion(configuration.library, motion.type) &&
              motion.overrideCode === templates[motion.type])
            delete motion.overrideCode;
          return motion;
        });
      } else if (Object.prototype.hasOwnProperty.call(point, "overrideCode")) {
        const code = point.overrideCode ?? "";
        const type = isBoomerangWaypoint(point) ? "boomerang" : "forward";
        if (!supportsPlanningMotion(configuration.library, type) || code !== templates[type])
          serialized.overrideCode = code;
      }
      return serialized;
    });
  }

  private metadata(
    pathName: string,
    settings: Readonly<MotionViewSettings>,
  ): Record<string, unknown> {
    const poses = this.app.viewing.data.poses;
    const start = poses[0]?.t ?? null;
    const end = poses[poses.length - 1]?.t ?? null;
    return {
      SchemaVersion: 5,
      CreationDate: new Intl.DateTimeFormat("en-GB", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date()),
      AppVersion: this.app.version,
      Creator: "MotionView",
      PathName: pathName,
      Stats: {
        PoseCount: poses.length,
        WatchCount: this.app.viewing.data.watches.length,
        LogCount: this.app.viewing.data.logs.length,
        WaypointCount: this.app.viewing.data.waypoints.length,
        WaypointEvents: waypointEventCount(this.app.viewing.data.waypoints),
        PlannedWaypointCount: this.app.planning.route.length,
        PlannedObjectCount: this.app.planning.objects.length,
        PlannedNodeCount: this.app.planning.timeline.length,
      },
      Times: {
        StartTime: `${formatNumber(Number(start) / 1000)}s`,
        EndTime: `${formatNumber(Number(end) / 1000)}s`,
        DurationTimeMs:
          typeof start === "number" && typeof end === "number"
            ? Math.max(0, end - start)
            : null,
      },
      ViewingSettings: {
        Units: settings.units ?? "in",
        SelectedField: settings.selectedField ?? "",
        PathOffsets: {
          X: Number(settings.offX ?? 0),
          Y: Number(settings.offY ?? 0),
          Theta: Number(settings.offTheta ?? 0),
        },
        RobotDimensions: {
          Width: Number(settings.robotW ?? 12),
          Height: Number(settings.robotH ?? 12),
        },
        SpeedNorm: {
          Minimum: Number(settings.minSpeed ?? 0),
          Maximum: Number(settings.maxSpeed ?? 127),
        },
      },
    };
  }
}

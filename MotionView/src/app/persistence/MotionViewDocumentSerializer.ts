import type { MotionViewApp } from "../MotionViewApp";
import { serializePlanNode } from "../../planning";
import { normalizeWaypointType, waypointEventCount } from "../../viewing";
import type { MotionViewSettings } from "../settings";

export type MotionViewExportType = "viewing" | "planning" | "both";

function level(value: unknown): "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" {
  const normalized = String(value ?? "INFO").toUpperCase();
  return normalized === "DEBUG" || normalized === "WARN" || normalized === "ERROR" || normalized === "FATAL" ? normalized : "INFO";
}

function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

export class MotionViewDocumentSerializer {
  constructor(private readonly app: MotionViewApp) {}

  savedPaths(): string {
    const planning = this.app.planning.exportData();
    return JSON.stringify({
      ...this.planningDocument(planning),
      "robot-path": this.app.viewing.data.poses.map((pose) => ({ t: pose.t ?? null, x: pose.x, y: pose.y, theta: pose.theta ?? 0, l_vel: pose.l_vel ?? null, r_vel: pose.r_vel ?? null, speed_raw: pose.speed_raw ?? 0 })),
      watches: this.app.viewing.data.watches.map((watch) => ({ t: watch.t ?? null, id: Number.isInteger(watch.id) ? watch.id : null, visible: watch.visible !== false, level: watch.level ?? "INFO", label: watch.label ?? "", value: watch.value ?? "" })),
      logs: this.app.viewing.data.logs.map((entry) => ({ t: entry.t ?? null, level: level(entry.level), label: entry.label ?? "", value: entry.message ?? entry.value ?? "", isSystem: entry.isSystem === true })),
      waypoints: this.app.viewing.data.waypoints.map((waypoint) => ({ id: waypoint.id, name: waypoint.name, createdTime: waypoint.createdTime ?? null, createdEvent: waypoint.createdEvent ?? null, events: waypoint.events ?? [] })),
    });
  }

  exportPayload(type: MotionViewExportType, pathName: string, settings: Readonly<MotionViewSettings>): Record<string, unknown> {
    const payload: Record<string, unknown> = { meta: this.metadata(pathName, settings) };
    if (type !== "viewing") Object.assign(payload, this.planningDocument(this.app.planning.exportData()));
    if (type !== "planning") {
      const viewing = this.app.viewing.exportData();
      payload.poses = viewing.poses.map((pose) => ({ t: pose.t ?? null, x: pose.x, y: pose.y, theta: pose.theta ?? 0, l_vel: pose.l_vel ?? null, r_vel: pose.r_vel ?? null, speed: pose.speed_raw ?? 0 }));
      payload.watches = viewing.watches.map((watch) => ({ t: watch.t ?? null, id: Number.isInteger(watch.id) ? watch.id : null, visible: watch.visible !== false, level: watch.level ?? "INFO", label: watch.label ?? "", value: watch.value ?? "" }));
      payload.logs = viewing.logs.map((entry) => ({ t: entry.t ?? null, level: level(entry.level), label: entry.label ?? "", value: entry.isSystem ? `[MVLIB] ${entry.message ?? entry.value ?? ""}` : entry.message ?? entry.value ?? "" }));
      payload.waypoints = viewing.waypoints.map((waypoint) => ({ id: waypoint.id, name: waypoint.name ?? "", events: waypoint.events.map((event) => ({ t: event.t ?? null, type: normalizeWaypointType(event.type), id: Number.isInteger(event.id) ? event.id : null, name: event.name ?? "", params: event.params ? { ...event.params } : {} })) }));
    }
    return payload;
  }

  private planningDocument(planning: ReturnType<MotionViewApp["planning"]["exportData"]>): Record<string, unknown> {
    return {
      "planned-path": planning.waypoints.map((point) => ({ x: point.x, y: point.y, theta: point.theta ?? 0, speed: Math.max(1, Math.min(127, Number(point.speed) || 127)) })),
      "planned-export-template": planning.template,
      "planned-objects": planning.objects.map((object) => ({ id: object.id, name: object.name, color: object.color || null, latestMethod: object.latestMethod || "", methods: object.methods.map((method) => ({ id: method.id, name: method.name, code: method.code })) })),
      "planned-nodes": planning.nodes.map(serializePlanNode),
    };
  }

  private metadata(pathName: string, settings: Readonly<MotionViewSettings>): Record<string, unknown> {
    const poses = this.app.viewing.data.poses; const start = poses[0]?.t ?? null; const end = poses[poses.length - 1]?.t ?? null;
    return {
      SchemaVersion: 3,
      CreationDate: new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()),
      AppVersion: this.app.version, Creator: "MotionView", PathName: pathName,
      Stats: { PoseCount: poses.length, WatchCount: this.app.viewing.data.watches.length, LogCount: this.app.viewing.data.logs.length, WaypointCount: this.app.viewing.data.waypoints.length, WaypointEvents: waypointEventCount(this.app.viewing.data.waypoints), PlannedWaypointCount: this.app.planning.route.length, PlannedObjectCount: this.app.planning.objects.length, PlannedNodeCount: this.app.planning.timeline.length },
      Times: { StartTime: `${formatNumber(Number(start) / 1000)}s`, EndTime: `${formatNumber(Number(end) / 1000)}s`, DurationTimeMs: typeof start === "number" && typeof end === "number" ? Math.max(0, end - start) : null },
      ViewingSettings: { Units: settings.units ?? "in", SelectedField: settings.selectedField ?? "", PathOffsets: { X: Number(settings.offX ?? 0), Y: Number(settings.offY ?? 0), Theta: Number(settings.offTheta ?? 0) }, RobotDimensions: { Width: Number(settings.robotW ?? 12), Height: Number(settings.robotH ?? 12) }, SpeedNorm: { Minimum: Number(settings.minSpeed ?? 0), Maximum: Number(settings.maxSpeed ?? 127) } },
    };
  }
}

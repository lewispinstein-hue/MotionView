import type { LogEntry, Pose, WatchEntry, WaypointEvent } from "../state/models";
import {
  normalizeSystemLogMessage,
  normalizeViewingLogLevel,
  normalizeWaypointType,
  parseViewingNumber,
  parseWaypointParams,
} from "../viewing/routeNormalization";
import type { ParsedLiveViewingBatch, ViewingDataReader } from "../viewing/viewingTypes";
import { emptyLiveCounts, stripToTag, type LiveCounts, type LivePendingBatch } from "./liveCore";

export interface ParsedLiveBatchResult {
  readonly batch: ParsedLiveViewingBatch;
  readonly counts: LiveCounts;
  readonly lastPoseTimestamp: number | null;
}

export interface ParsedWaypointLine {
  readonly ok: boolean;
  readonly malformed: boolean;
  readonly waypointEvent?: WaypointEvent;
}

export class LiveLineParser {
  classify(line: string): string {
    return stripToTag(line);
  }

  parse(
    pending: Readonly<LivePendingBatch>,
    viewing: ViewingDataReader,
    previousPoseTimestamp: number | null,
  ): ParsedLiveBatchResult {
    const poses: Pose[] = [];
    const watches: WatchEntry[] = [];
    const logs: LogEntry[] = [];
    const waypointEvents: WaypointEvent[] = [];
    const counts = emptyLiveCounts();
    const createdWaypointIds = new Set<number>();
    let lastPoseTimestamp = previousPoseTimestamp;

    for (let index = pending.startIndex; index < pending.endIndex; index += 1) {
      const line = stripToTag(pending.lines[index] ?? "");
      if (!line) continue;

      if (line.startsWith("[POSE],")) {
        const parts = line.split(",");
        if (parts.length < 7) continue;
        const t = parseViewingNumber(parts[1]);
        const x = parseViewingNumber(parts[2]);
        const y = parseViewingNumber(parts[3]);
        const theta = parseViewingNumber(parts[4]);
        const leftVelocity = parseViewingNumber(parts[5]);
        const rightVelocity = parseViewingNumber(parts[6]);
        if (t == null || x == null || y == null || (lastPoseTimestamp != null && t <= lastPoseTimestamp)) continue;
        const left = leftVelocity ?? 0;
        const right = rightVelocity ?? 0;
        poses.push({
          t,
          x,
          y,
          theta: theta ?? 0,
          l_vel: leftVelocity,
          r_vel: rightVelocity,
          speed_raw: (Math.abs(left) + Math.abs(right)) / 2,
          speed_norm: 0,
        });
        lastPoseTimestamp = t;
        counts.posesAdded += 1;
        continue;
      }

      if (line.startsWith("[WATCH],")) {
        const parts = line.split(",");
        if (parts.length < 5) continue;
        const t = parseViewingNumber(parts[1]);
        if (t == null) continue;
        let id: number | null = null;
        let label: string;
        let value: string;
        if (parts.length >= 6 && Number.isInteger(Number(parts[3]))) {
          id = Number(parts[3]);
          label = parts[4] ?? "";
          value = parts.slice(5).join(",");
        } else {
          label = parts[3] ?? "";
          value = parts.slice(4).join(",");
        }
        watches.push({ t, id, level: parts[2] ?? "INFO", label: label.replaceAll(":", ""), value });
        counts.watchesAdded += 1;
        continue;
      }

      if (line.startsWith("[LOG],")) {
        const parts = line.split(",");
        if (parts.length < 4) continue;
        const t = parseViewingNumber(parts[1]);
        const parsed = normalizeSystemLogMessage(parts.slice(3).join(","));
        if (t == null || !parsed.message) continue;
        logs.push({
          t,
          level: normalizeViewingLogLevel(parts[2]),
          label: "",
          value: parsed.message,
          message: parsed.message,
          isSystem: parsed.isSystem,
        });
        counts.logsAdded += 1;
        continue;
      }

      if (line.startsWith("[WPOINT],")) {
        const parsed = this.parseWaypointLine(line);
        const event = parsed.waypointEvent;
        if (!parsed.ok || !event) continue;
        if (event.type !== "CREATED" && !viewing.waypointById.has(event.id) && !createdWaypointIds.has(event.id)) continue;
        waypointEvents.push(event);
        if (event.type === "CREATED") createdWaypointIds.add(event.id);
        counts.waypointsAdded += 1;
      }
    }

    return {
      batch: { poses, watches, logs, waypointEvents },
      counts,
      lastPoseTimestamp,
    };
  }

  parseWaypointLine(line: string): ParsedWaypointLine {
    if (!line.startsWith("[WPOINT],")) return { ok: false, malformed: false };
    const commas: number[] = [];
    for (let index = 0; index < line.length; index += 1) if (line[index] === ",") commas.push(index);
    if (commas.length < 4) return { ok: false, malformed: true };

    const fields: string[] = [];
    let start = 0;
    const splitCount = Math.min(commas.length, 5);
    for (let index = 0; index < splitCount; index += 1) {
      fields.push(line.slice(start, commas[index]));
      start = commas[index] + 1;
    }
    if (fields.length < 5) {
      fields.push(line.slice(start));
      while (fields.length < 5) fields.push("");
    } else {
      fields.push(line.slice(start));
    }

    const [, rawTime, rawType, rawId, rawName, rawParams] = fields;
    const t = parseViewingNumber(rawTime);
    const type = normalizeWaypointType(rawType);
    const id = Number(rawId);
    const name = String(rawName || "").trim();
    if (t == null || !type || !Number.isInteger(id) || !name) return { ok: false, malformed: true };
    if (type === "CREATED") {
      const params = parseWaypointParams(type, rawParams);
      return params
        ? { ok: true, malformed: false, waypointEvent: { t, type, id, name, params } }
        : { ok: false, malformed: true };
    }
    if (type === "REACHED") {
      const params = parseWaypointParams(type, rawParams);
      return params
        ? { ok: true, malformed: false, waypointEvent: { t, type, id, name, params } }
        : { ok: false, malformed: true };
    }
    const params = parseWaypointParams(type, rawParams);
    return params
      ? { ok: true, malformed: false, waypointEvent: { t, type, id, name, params } }
      : { ok: false, malformed: true };
  }

  formatWaypointLine(event: WaypointEvent): string {
    const fields: Array<string | number> = ["[WPOINT]", event.t, event.type, event.id, event.name];
    if (event.type === "CREATED") {
      fields.push(
        event.params.tarX,
        event.params.tarY,
        event.params.tarT ?? "NA",
        event.params.timeoutMs ?? "NA",
        event.params.linearTol,
        event.params.thetaTol ?? "NA",
        event.params.retriggerable ? 1 : 0,
      );
    } else if (event.type === "REACHED" && event.params.remainingTime != null) {
      fields.push(event.params.remainingTime);
    }
    return fields.join(",");
  }
}

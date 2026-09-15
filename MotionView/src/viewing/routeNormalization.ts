import type {
  LogEntry,
  Pose,
  WatchEntry,
  Waypoint,
  WaypointCreatedEvent,
  WaypointEvent,
  WaypointEventType,
  WaypointReachedEvent,
  WaypointTimedOutEvent,
} from "../state/models";

type NumberParser = (value: unknown) => number | null;
type LogLevelNormalizer = (value: unknown) => string;

export function parseViewingNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeViewingLogLevel(value: unknown): string {
  const level = String(value || "INFO").trim().toUpperCase();
  return level === "DEBUG" || level === "INFO" || level === "WARN" || level === "ERROR" || level === "FATAL"
    ? level
    : "INFO";
}

export function normalizePoses(value: unknown, toNumber: NumberParser = parseViewingNumber): Pose[] {
  if (!Array.isArray(value)) return [];
  const poses: Pose[] = [];
  for (const rawPose of value) {
    if (!rawPose || typeof rawPose !== "object") continue;
    const pose = rawPose as Record<string, unknown>;
    if (typeof pose.x !== "number" || typeof pose.y !== "number") continue;
    poses.push({
      t: typeof pose.t === "number" ? pose.t : toNumber(pose.t),
      x: pose.x,
      y: pose.y,
      theta: typeof pose.theta === "number" ? pose.theta : (toNumber(pose.theta) ?? 0),
      l_vel: typeof pose.l_vel === "number" ? pose.l_vel : toNumber(pose.l_vel),
      r_vel: typeof pose.r_vel === "number" ? pose.r_vel : toNumber(pose.r_vel),
      speed_raw: typeof pose.speed_raw === "number"
        ? pose.speed_raw
        : (typeof pose.speed === "number" ? pose.speed : (toNumber(pose.speed) ?? 0)),
      speed_norm: 0,
    });
  }
  poses.sort((left, right) => (left.t ?? 0) - (right.t ?? 0));
  return poses;
}

export function normalizeWatches(value: unknown, toNumMaybe: NumberParser = parseViewingNumber): WatchEntry[] {
  const out: WatchEntry[] = [];
  if (!Array.isArray(value)) return out;

  for (const w of value) {
    if (!w || typeof w !== "object") continue;
    const tRaw = (w.t ?? w.timestamp ?? w.time ?? w.ms);
    const t = toNumMaybe(tRaw);
    if (t == null) continue;
    const idRaw = w.id ?? w.watchId;
    const idNum = Number(idRaw);
    const id = Number.isInteger(idNum) ? idNum : null;

    out.push({
      t,
      id,
      visible: w.visible !== false,
      level: String(w.level ?? w.lvl ?? w.severity ?? "INFO"),
      label: String(w.label ?? w.name ?? ""),
      value: w.value ?? w.val ?? w.message ?? "",
    });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function normalizeLogs(
  value: unknown,
  toNumMaybe: NumberParser = parseViewingNumber,
  normalizeLogLevel: LogLevelNormalizer = normalizeViewingLogLevel,
): LogEntry[] {
  const out: LogEntry[] = [];
  if (!Array.isArray(value)) return out;

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const tRaw = entry.t ?? entry.timestamp ?? entry.time ?? entry.ms;
    const t = toNumMaybe(tRaw);
    if (t == null) continue;

    const parsed = normalizeSystemLogMessage(entry.message ?? entry.value ?? entry.val ?? "");
    const isSystem = entry.isSystem === true || parsed.isSystem;
    if (!parsed.message) continue;

    out.push({
      t,
      level: normalizeLogLevel(entry.level ?? entry.lvl ?? entry.severity ?? "INFO"),
      label: String(entry.label ?? ""),
      value: parsed.message,
      message: parsed.message,
      isSystem,
    });
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}

export function normalizeSystemLogMessage(rawMessage: unknown) {
  const text = String(rawMessage ?? "").trim();
  if (!text) return { message: "", isSystem: false };
  const prefix = "[MVLIB] ";
  if (text.startsWith(prefix)) {
    return {
      message: text.slice(prefix.length).trim(),
      isSystem: true,
    };
  }
  return { message: text, isSystem: false };
}

export function normalizeWaypointType(typeRaw: unknown): WaypointEventType | null {
  const type = String(typeRaw || "").trim().toUpperCase();
  if (type === "CREATED" || type === "REACHED" || type === "TIMEDOUT") return type;
  return null;
}

export function parseWaypointNumber(raw: unknown) {
  const text = String(raw ?? "").trim();
  if (!text || text.toUpperCase() === "NA") return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

export function parseWaypointParams(type: "CREATED", paramsText: unknown): WaypointCreatedEvent["params"] | null;
export function parseWaypointParams(type: "REACHED", paramsText: unknown): WaypointReachedEvent["params"] | null;
export function parseWaypointParams(type: "TIMEDOUT", paramsText: unknown): WaypointTimedOutEvent["params"] | null;
export function parseWaypointParams(
  type: WaypointEventType,
  paramsText: unknown,
): WaypointEvent["params"] | null {
  const text = String(paramsText ?? "").trim();
  const parts = text ? text.split(",").map((part) => part.trim()) : [];
  if (type === "CREATED") {
    if (parts.length !== 6 && parts.length !== 7) return null;
    const tarX = parseWaypointNumber(parts[0]);
    const tarY = parseWaypointNumber(parts[1]);
    const tarT = parseWaypointNumber(parts[2]);
    const timeoutMs = parseWaypointNumber(parts[3]);
    const linearTol = parseWaypointNumber(parts[4]);
    const thetaTol = parseWaypointNumber(parts[5]);
    let retriggerable = false;
    if (parts.length === 7) {
      if (parts[6] !== "0" && parts[6] !== "1") return null;
      retriggerable = parts[6] === "1";
    }
    if (tarX == null || tarY == null || linearTol == null) return null;
    return { tarX, tarY, tarT, timeoutMs, linearTol, thetaTol, retriggerable };
  }

  if (type === "REACHED") {
    if (!parts.length) return {};
    if (parts.length === 1) {
      const remainingTime = parseWaypointNumber(parts[0]);
      return remainingTime == null ? null : { remainingTime };
    }
    if (parts.length === 4) {
      const remainingTime = parseWaypointNumber(parts[3]);
      return remainingTime == null ? {} : { remainingTime };
    }
    return null;
  }

  if (type === "TIMEDOUT") {
    if (!parts.length) return {};
    if (parts.length === 4) return {};
    return null;
  }

  return null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function waypointBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function normalizeWaypointEvent(
  value: unknown,
  fallbackId: number,
  fallbackName: string,
): WaypointEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  const type = normalizeWaypointType(event.type);
  const t = finiteNumber(event.t);
  const idValue = Number(event.id);
  const id = Number.isInteger(idValue) ? idValue : fallbackId;
  const name = String(event.name ?? fallbackName).trim();
  const params = event.params && typeof event.params === "object"
    ? event.params as Record<string, unknown>
    : {};
  if (!type || t == null) return null;

  if (type === "CREATED") {
    const tarX = finiteNumber(params.tarX);
    const tarY = finiteNumber(params.tarY);
    const linearTol = finiteNumber(params.linearTol) ?? 0;
    if (tarX == null || tarY == null) return null;
    const timeoutMs = params.timeoutMs == null ? null : finiteNumber(params.timeoutMs);
    return {
      t,
      type,
      id,
      name,
      params: {
        tarX,
        tarY,
        tarT: params.tarT == null ? null : finiteNumber(params.tarT),
        timeoutMs,
        linearTol,
        thetaTol: params.thetaTol == null ? null : finiteNumber(params.thetaTol),
        retriggerable: waypointBoolean(params.retriggerable),
      },
    };
  }

  if (type === "REACHED") {
    const remainingTime = params.remainingTime == null ? null : finiteNumber(params.remainingTime);
    return {
      t,
      type,
      id,
      name,
      params: remainingTime == null ? {} : { remainingTime },
    };
  }

  return { t, type, id, name, params: {} };
}

export function buildWaypointState(value: unknown): { waypoints: Waypoint[]; waypointsById: Map<number, Waypoint> } {
  const waypointsById = new Map<number, Waypoint>();
  const source = Array.isArray(value) ? value : [];

  for (const rawEntry of source) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as Record<string, unknown>;
    const id = Number(entry.id);
    if (!Number.isInteger(id)) continue;
    const rawCreatedEvent = entry.createdEvent;
    const createdEventRecord = rawCreatedEvent && typeof rawCreatedEvent === "object"
      ? rawCreatedEvent as Record<string, unknown>
      : null;
    const fallbackName = String(entry.name ?? createdEventRecord?.name ?? "");
    const rawEvents = Array.isArray(entry.events) ? [...entry.events] : [];
    const events = rawEvents
      .map((event) => normalizeWaypointEvent(event, id, fallbackName))
      .filter((event): event is WaypointEvent => event != null)
      .sort((left, right) => left.t - right.t);
    const storedCreatedEvent = normalizeWaypointEvent(rawCreatedEvent, id, fallbackName);
    if (storedCreatedEvent?.type === "CREATED" && !events.some((event) => event.type === "CREATED")) {
      events.push(storedCreatedEvent);
      events.sort((left, right) => left.t - right.t);
    }

    // `createdEvent` is retained for backwards compatibility alongside `events`.
    // JSON parsing breaks object identity, so keep the canonical creation only once.
    const creationIndex = events.findIndex((event) => event.type === "CREATED");
    if (creationIndex !== -1) {
      for (let index = events.length - 1; index > creationIndex; index -= 1) {
        if (events[index].type === "CREATED") events.splice(index, 1);
      }
    }
    const createdEvent = events.find((event): event is WaypointCreatedEvent => event.type === "CREATED");
    if (!createdEvent) continue;

    const isRetriggerable = !!createdEvent?.params?.retriggerable;
    let terminalEvent: WaypointEvent | null = null;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.type === "TIMEDOUT" || (!isRetriggerable && event.type === "REACHED")) {
        terminalEvent = event;
        break;
      }
    }
    const latestEvent = events[events.length - 1];
    let latestActiveEvent = latestEvent;
    if (terminalEvent) {
      latestActiveEvent = createdEvent;
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event.t <= terminalEvent.t) {
          latestActiveEvent = event;
          break;
        }
      }
    }

    waypointsById.set(id, {
      id,
      name: String(entry.name ?? createdEvent.name ?? ""),
      createdTime: createdEvent.t,
      createdEvent,
      target: { x: createdEvent.params.tarX, y: createdEvent.params.tarY, theta: createdEvent.params.tarT },
      retriggerable: isRetriggerable,
      events,
      active: !terminalEvent,
      terminalEvent,
      latestEvent: latestEvent || createdEvent,
      latestActiveEvent: latestActiveEvent || createdEvent,
    });
  }

  return {
    waypoints: Array.from(waypointsById.values()).sort((a, b) => (a.createdTime ?? 0) - (b.createdTime ?? 0)),
    waypointsById,
  };
}

export function waypointEventCount(value: unknown) {
  if (!Array.isArray(value)) return 0;
  let total = 0;
  for (const waypoint of value) {
    if (Array.isArray(waypoint?.events)) total += waypoint.events.length;
  }
  return total;
}

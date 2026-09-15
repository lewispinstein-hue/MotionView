import type { QueuedTelemetryEvent } from "./telemetryTypes";

const DEFAULT_STORAGE_KEY = "motionview.telemetry.queue";
const DEFAULT_MAX_EVENTS = 200;

export class TelemetryQueue {
  constructor(
    private readonly storageKey = DEFAULT_STORAGE_KEY,
    private readonly maxEvents = DEFAULT_MAX_EVENTS,
  ) {}

  read(): QueuedTelemetryEvent[] {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isQueuedTelemetryEvent) : [];
    } catch {
      return [];
    }
  }

  write(events: QueuedTelemetryEvent[]) {
    try {
      const capped = events.slice(-this.maxEvents);
      localStorage.setItem(this.storageKey, JSON.stringify(capped));
    } catch {
      // Telemetry storage must never break app behavior.
    }
  }

  enqueue(event: QueuedTelemetryEvent) {
    const events = this.read();
    events.push(event);
    this.write(events);
  }

  clear() {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // Ignore storage failures.
    }
  }
}

function isQueuedTelemetryEvent(value: unknown): value is QueuedTelemetryEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<QueuedTelemetryEvent>;
  return typeof candidate.event === "string"
    && typeof candidate.createdAt === "string"
    && !!candidate.properties
    && typeof candidate.properties === "object";
}

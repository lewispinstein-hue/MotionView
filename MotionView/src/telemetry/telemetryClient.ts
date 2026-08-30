import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../tauri/commands";
import { TelemetryQueue } from "./telemetryQueue";
import type { QueuedTelemetryEvent, SystemInfo, TelemetryCaptureOptions, TelemetryEventName, TelemetryProperties } from "./telemetryTypes";

interface PosthogRequest {
  event?: string;
  distinctId?: string;
  alias?: string;
  properties?: TelemetryProperties;
}

export class TelemetryClient {
  private appVersion = "unknown";
  private systemInfo: SystemInfo = {};
  private distinctId: string | null = null;
  private initialized = false;
  private debounceUntilByKey = new Map<string, number>();
  private readonly queue = new TelemetryQueue();

  enabled() {
    return isTauriRuntime();
  }

  getAppVersion() {
    return this.appVersion;
  }

  async init() {
    if (this.initialized) return this.appVersion;
    if (!this.enabled()) {
      this.initialized = true;
      return this.appVersion;
    }

    try {
      this.appVersion = await getVersion();
    } catch (err) {
      console.warn("Failed to load app version for telemetry:", err);
    }

    try {
      this.distinctId = await invoke<string>("get_posthog_distinct_id");
    } catch (err) {
      console.warn("Failed to load native PostHog distinct ID:", err);
    }

    try {
      this.systemInfo = await invoke<SystemInfo>("get_system_info");
    } catch (err) {
      console.warn("Failed to load system info from backend:", err);
    }

    if (this.distinctId) {
      try {
        await this.withRetry(() => this.identify(this.distinctId as string));
      } catch (err) {
        console.warn("PostHog identify failed:", err);
      }
    }

    this.initialized = true;
    await this.flush();
    return this.appVersion;
  }

  async capture(event: TelemetryEventName, properties: TelemetryProperties = {}, opts: TelemetryCaptureOptions = {}) {
    if (!this.enabled()) return false;

    const debounceMs = Number(opts.debounceMs || 0);
    const debounceKey = opts.debounceKey || event;
    if (debounceMs > 0) {
      const now = Date.now();
      const until = this.debounceUntilByKey.get(debounceKey) || 0;
      if (now < until) return false;
      this.debounceUntilByKey.set(debounceKey, now + debounceMs);
    }

    const queuedEvent: QueuedTelemetryEvent = {
      event,
      properties: { ...properties },
      createdAt: new Date().toISOString(),
    };

    try {
      await this.withRetry(() => this.sendQueuedEvent(queuedEvent));
      await this.flush();
      return true;
    } catch (err) {
      console.warn(`Telemetry capture failed for ${event}:`, err);
      this.queue.enqueue(queuedEvent);
      return false;
    }
  }

  async identify(distinctId: string, properties?: TelemetryProperties) {
    const request = this.buildRequest({ distinctId }, properties);
    return this.safeInvoke("plugin:posthog|identify", { request });
  }

  async alias(aliasValue: string, distinctId?: string) {
    const request: PosthogRequest = { alias: aliasValue };
    if (distinctId) request.distinctId = distinctId;
    return this.safeInvoke("plugin:posthog|alias", { request });
  }

  async flush() {
    const events = this.queue.read();
    if (!events.length) return;

    const remaining: QueuedTelemetryEvent[] = [];
    for (const event of events) {
      try {
        await this.withRetry(() => this.sendQueuedEvent(event, true));
      } catch {
        remaining.push(event);
      }
    }
    this.queue.write(remaining);
  }

  private async sendQueuedEvent(event: QueuedTelemetryEvent, wasQueued = false) {
    const sentAt = new Date();
    const createdAtMs = Date.parse(event.createdAt);
    const queuedMs = wasQueued && Number.isFinite(createdAtMs) ? Math.max(0, sentAt.getTime() - createdAtMs) : 0;
    const properties = {
      ...this.globalProperties(),
      ...event.properties,
      event_created_at: event.createdAt,
      event_sent_at: sentAt.toISOString(),
      queued_ms: queuedMs,
    };
    const request = this.buildRequest({ event: event.event }, properties);
    console.log("PostHog capture:", request);
    return this.safeInvoke("plugin:posthog|capture", { request });
  }

  private globalProperties(): TelemetryProperties {
    return {
      version: this.appVersion,
      os: this.systemInfo?.os ?? "unknown",
      arch: this.systemInfo?.arch ?? "unknown",
      browser: navigator.userAgent,
    };
  }

  private buildRequest(base: PosthogRequest, properties?: TelemetryProperties) {
    const request: PosthogRequest = { ...base };
    if (properties && Object.keys(properties).length > 0) {
      request.properties = properties;
    }
    return request;
  }

  private async safeInvoke(command: string, payload = {}) {
    try {
      await invoke(command, payload);
    } catch (err) {
      console.warn("PostHog telemetry failed:", err);
      throw err;
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 300) {
    let lastErr: unknown = null;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (i === attempts - 1) break;
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** i)));
      }
    }
    throw lastErr;
  }
}

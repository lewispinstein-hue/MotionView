import type { LiveEvents } from "./LiveEvents";
import type { LiveSession } from "./LiveSession";

export class LivePreferences {
  constructor(
    private readonly session: LiveSession,
    private readonly events: LiveEvents,
  ) {}

  get refreshIntervalMs(): number { return this.session.refreshIntervalMs; }
  get debugEnabled(): boolean { return this.session.debugEnabled; }

  setRefreshInterval(milliseconds: number): void {
    const parsed = Number(milliseconds);
    const next = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
    if (next === this.session.refreshIntervalMs) return;
    this.session.refreshIntervalMs = next;
    this.emit();
  }

  setDebugEnabled(enabled: boolean): void {
    const next = !!enabled;
    if (next === this.session.debugEnabled) return;
    this.session.debugEnabled = next;
    this.emit();
  }

  private emit(): void {
    this.events.preferencesChanged.emit({
      refreshIntervalMs: this.refreshIntervalMs,
      debugEnabled: this.debugEnabled,
    });
  }
}


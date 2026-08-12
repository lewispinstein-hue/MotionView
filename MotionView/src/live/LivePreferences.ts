import type { LiveEvents } from "./LiveEvents";
import type { LiveSession } from "./LiveSession";

export class LivePreferences {
  constructor(
    private readonly session: LiveSession,
    private readonly events: LiveEvents,
  ) {}

  get refreshIntervalMs(): number { return this.session.refreshIntervalMs; }

  setRefreshInterval(milliseconds: number): void {
    const parsed = Number(milliseconds);
    const next = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
    if (next === this.session.refreshIntervalMs) return;
    this.session.refreshIntervalMs = next;
    this.emit();
  }

  private emit(): void {
    this.events.preferencesChanged.emit({
      refreshIntervalMs: this.refreshIntervalMs,
    });
  }
}

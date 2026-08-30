import type { LiveFeature } from "../../../live/LiveFeature";
import type { SettingsFeature } from "../SettingsFeature";

export class LiveSettingsBinding {
  #bound = false;
  constructor(private readonly settings: SettingsFeature, private readonly live: LiveFeature) {}
  bind(): void {
    if (this.#bound) return; this.#bound = true;
    this.settings.changed.subscribe(({ settings, keys }) => {
      if (keys.includes("prosDir") && settings.prosDir) this.live.project.restore(settings.prosDir);
      if (keys.includes("refreshIntervalMs")) this.live.preferences.setRefreshInterval(Number(settings.refreshIntervalMs ?? 500));
    });
    this.live.events.projectChanged.subscribe(() => this.settings.update({ prosDir: this.live.project.path }, "system"));
    this.live.events.preferencesChanged.subscribe(() => this.settings.update({ refreshIntervalMs: String(this.live.preferences.refreshIntervalMs) }, "system"));
  }
  applyAll(): void {
    const settings = this.settings.current;
    if (settings.prosDir) this.live.project.restore(settings.prosDir);
    this.live.preferences.setRefreshInterval(Number(settings.refreshIntervalMs ?? 500));
  }
}

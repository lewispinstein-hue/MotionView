import type { TelemetryClient } from "../../../telemetry/telemetryClient";
import type { SettingsDom } from "../SettingsDom";
import type { SettingsFeature } from "../SettingsFeature";
import type { MotionViewSettings } from "../settingsTypes";

/** Connects the persisted, user-controlled analytics preference to the telemetry client. */
export class TelemetrySettingsBinding {
  #bound = false;

  constructor(
    private readonly settings: SettingsFeature,
    private readonly telemetry: TelemetryClient,
    private readonly dom: SettingsDom,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.settings.changed.subscribe(({ settings, keys }) => this.apply(settings, keys));
    this.dom.telemetryEnabled.addEventListener("change", () => {
      this.settings.update({ telemetryEnabled: this.dom.telemetryEnabled.checked });
    });
  }

  applyAll(): void {
    this.apply(this.settings.current, ["telemetryEnabled"]);
  }

  private apply(values: Readonly<MotionViewSettings>, keys: readonly (keyof MotionViewSettings)[]): void {
    if (!keys.includes("telemetryEnabled")) return;
    const enabled = values.telemetryEnabled === true;
    this.dom.telemetryEnabled.checked = enabled;
    this.telemetry.setEnabled(enabled);
  }
}

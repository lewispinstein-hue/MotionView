import type { TelemetryClient } from "../../../telemetry/TelemetryClient";
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
    this.settings.changed.subscribe(({ settings, keys, source }) =>
      this.apply(settings, keys, source),
    );
    this.dom.telemetryEnabled.addEventListener("change", () => {
      this.settings.update({
        telemetryEnabled: this.dom.telemetryEnabled.checked,
      });
    });
  }

  applyAll(): void {
    this.apply(this.settings.current, ["telemetryEnabled"], "load");
  }

  private apply(
    values: Readonly<MotionViewSettings>,
    keys: readonly (keyof MotionViewSettings)[],
    source: "load" | "user" | "system",
  ): void {
    if (!keys.includes("telemetryEnabled")) return;
    const enabled = values.telemetryEnabled === true;
    this.dom.telemetryEnabled.checked = enabled;

    // Explicit setting changes are retained even if sending fails, while the
    // disabled state still immediately stops all automatic telemetry.
    if (source === "user") {
      void this.telemetry.capture(
        "telemetry_preference_changed",
        { telemetry_enabled: enabled },
        { explicitUserAction: true },
      );
    }
    this.telemetry.setEnabled(enabled);
  }
}

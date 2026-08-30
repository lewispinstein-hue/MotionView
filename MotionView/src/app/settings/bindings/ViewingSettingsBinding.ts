import type { ViewingFeature } from "../../../viewing/ViewingFeature";
import { getUnitsToInchesFactor, setCurrentUnits } from "../../../shared/units";
import type { SettingsDom } from "../SettingsDom";
import type { SettingsFeature } from "../SettingsFeature";
import type { MotionViewSettings } from "../settingsTypes";

export class ViewingSettingsBinding {
  #bound = false;
  constructor(private readonly settings: SettingsFeature, private readonly viewing: ViewingFeature, private readonly dom: SettingsDom) {}
  bind(): void {
    if (this.#bound) return; this.#bound = true;
    this.settings.changed.subscribe(({ settings, keys }) => this.apply(settings, keys));
    const bind = (input: HTMLInputElement | HTMLSelectElement | null, key: keyof MotionViewSettings) => input?.addEventListener("input", () => this.settings.update({ [key]: input.value }));
    bind(this.dom.units, "units"); bind(this.dom.sidebarUnits, "units");
    bind(this.dom.offsetX, "offX"); bind(this.dom.offsetY, "offY"); bind(this.dom.offsetTheta, "offTheta");
    bind(this.dom.minimumSpeed, "minSpeed"); bind(this.dom.maximumSpeed, "maxSpeed");
  }
  applyAll(): void { this.apply(this.settings.current, Object.keys(this.settings.current) as (keyof MotionViewSettings)[]); }
  private apply(values: Readonly<MotionViewSettings>, keys: readonly (keyof MotionViewSettings)[]): void {
    const changed = (...wanted: (keyof MotionViewSettings)[]) => wanted.some((key) => keys.includes(key));
    if (changed("units")) {
      const units = String(values.units ?? "in"); this.dom.units.value = units; if (this.dom.sidebarUnits) this.dom.sidebarUnits.value = units; setCurrentUnits(units);
    }
    if (changed("offX", "offY", "offTheta", "units")) {
      this.dom.offsetX.value = String(values.offX ?? 0); this.dom.offsetY.value = String(values.offY ?? 0); this.dom.offsetTheta.value = String(values.offTheta ?? 0);
      const factor = getUnitsToInchesFactor();
      this.viewing.projection.setTransform({ unitsToInches: factor, offsetXInches: Number(values.offX ?? 0) * factor, offsetYInches: Number(values.offY ?? 0) * factor, offsetThetaDegrees: Number(values.offTheta ?? 0) || 0 });
    }
    if (changed("minSpeed", "maxSpeed")) {
      this.dom.minimumSpeed.value = String(values.minSpeed ?? 0); this.dom.maximumSpeed.value = String(values.maxSpeed ?? 127);
      this.viewing.setSpeedRange(Number(values.minSpeed ?? 0), Number(values.maxSpeed ?? 127));
    }
  }
}

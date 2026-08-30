import type { FieldRenderer } from "../../../render/field";
import type { PlanningFeature } from "../../../planning/PlanningFeature";
import type { PlanningCodeExportDialog } from "../../../planning/PlanningCodeExportDialog";
import { currentUnitsToInches, getCurrentUnits } from "../../../shared/units";
import type { SettingsDom } from "../SettingsDom";
import type { SettingsFeature } from "../SettingsFeature";
import type { MotionViewSettings } from "../settingsTypes";

export class PlanningSettingsBinding {
  #bound = false;
  constructor(private readonly settings: SettingsFeature, private readonly planning: PlanningFeature, private readonly field: FieldRenderer, private readonly codeExport: PlanningCodeExportDialog, private readonly dom: SettingsDom) {}
  bind(): void {
    if (this.#bound) return; this.#bound = true;
    this.settings.changed.subscribe(({ settings, keys }) => this.apply(settings, keys));
    const bind = (input: HTMLInputElement | HTMLSelectElement, key: keyof MotionViewSettings, event = "input") => input.addEventListener(event, () => this.settings.update({ [key]: input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value }));
    bind(this.dom.planMoveStep, "planMoveStep"); bind(this.dom.planSnapStep, "planSnapStep", "change"); bind(this.dom.planThetaSnapStep, "planThetaSnapStep", "change"); bind(this.dom.planLimitBounds, "planLimitBounds", "change");
    this.codeExport.changed.subscribe((planningCodeExport) => this.settings.update({ planningCodeExport }));
    this.planning.events.documentChanged.subscribe(({ kind }) => { if (kind === "template") this.settings.update({ planExportTemplate: this.planning.exportTemplate }, "system"); });
    this.field.events.fieldImageLoaded.subscribe(() => this.configureProjection());
  }
  applyAll(): void { this.apply(this.settings.current, Object.keys(this.settings.current) as (keyof MotionViewSettings)[]); }
  moveStepInches(): number { return currentUnitsToInches(Number(this.settings.current.planMoveStep ?? 0.5)); }
  private apply(values: Readonly<MotionViewSettings>, keys: readonly (keyof MotionViewSettings)[]): void {
    const changed = (...wanted: (keyof MotionViewSettings)[]) => wanted.some((key) => keys.includes(key));
    if (changed("planMoveStep", "planSnapStep", "planThetaSnapStep", "planLimitBounds", "units")) {
      this.dom.planMoveStep.value = String(values.planMoveStep ?? 0.5); this.dom.planSnapStep.value = String(values.planSnapStep ?? 0); this.dom.planThetaSnapStep.value = String(values.planThetaSnapStep ?? 0); this.dom.planLimitBounds.checked = values.planLimitBounds !== false;
      const unit = getCurrentUnits(); if (this.dom.planMoveStepLabel) this.dom.planMoveStepLabel.textContent = `Arrow move step (${unit})`; if (this.dom.planSnapStepLabel) this.dom.planSnapStepLabel.textContent = `Position snap (${unit}, 0 = off)`;
      this.configureProjection();
    }
    if (changed("planExportTemplate") && values.planExportTemplate !== undefined) this.planning.setExportTemplate(values.planExportTemplate);
    if (changed("planningCodeExport")) this.codeExport.applySettings(values.planningCodeExport);
  }
  private configureProjection(): void {
    const values = this.settings.current; const bounds = this.field.getBounds();
    this.planning.projection.configure({ minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY, limitBounds: values.planLimitBounds !== false, positionSnap: currentUnitsToInches(Number(values.planSnapStep ?? 0)), thetaSnap: Number(values.planThetaSnapStep ?? 0) || 0 });
  }
}

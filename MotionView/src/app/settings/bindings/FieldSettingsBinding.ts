import type { TopBarView } from "../../topBar";
import type { FieldRenderer } from "../../../render/field";
import { DEFAULT_FIELD_KEY, getValidFieldKey, getVisibleFieldImages, normalizeFieldCompetition } from "../../../render/field/fieldImages";
import { requestDrawAll } from "../../../render/renderScheduler";
import type { SettingsDom } from "../SettingsDom";
import type { SettingsFeature } from "../SettingsFeature";
import type { MotionViewSettings } from "../settingsTypes";
import { viewingTelemetry } from "../../../telemetry/createTelemetry";

function number(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class FieldSettingsBinding {
  #bound = false;
  constructor(
    private readonly settings: SettingsFeature,
    private readonly field: FieldRenderer,
    private readonly topBar: TopBarView,
    private readonly dom: SettingsDom,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.settings.changed.subscribe(({ settings, keys }) => void this.apply(settings, keys));
    this.topBar.events.settingsChanged.subscribe((event) => {
      if (event.kind === "field") this.settings.update({ selectedField: event.fieldKey });
      else if (event.kind === "playback-speed") this.settings.update({ playbackSpeed: String(event.speed) });
    });
    this.field.events.robotImageAvailabilityChanged.subscribe(() => this.refreshImageControls());
    this.field.events.fieldImageLoaded.subscribe(({ fieldKey }) => void viewingTelemetry.fieldImageLoaded({ field: fieldKey }));
    this.dom.fieldCompetition.addEventListener("change", () => this.settings.update({ fieldCompetition: normalizeFieldCompetition(this.dom.fieldCompetition.value) }));
    this.dom.showPreviousYears.addEventListener("change", () => this.settings.update({ showPreviousYearFields: this.dom.showPreviousYears.checked }));
    this.dom.fieldRotation.addEventListener("change", () => this.settings.update({ fieldRotation: this.dom.fieldRotation.value }));
    this.dom.robotWidth.addEventListener("input", () => this.settings.update({ robotW: this.dom.robotWidth.value }));
    this.dom.robotHeight.addEventListener("input", () => this.settings.update({ robotH: this.dom.robotHeight.value }));
    this.dom.robotImageToggle.addEventListener("change", () => this.settings.update({ robotImageEnabled: this.dom.robotImageToggle.checked }));
    for (const [input, key] of [
      [this.dom.robotImageScale, "robotImgScale"], [this.dom.robotImageOffsetX, "robotImgOffX"],
      [this.dom.robotImageOffsetY, "robotImgOffY"], [this.dom.robotImageRotation, "robotImgRot"],
      [this.dom.robotImageAlpha, "robotImgAlpha"], [this.dom.sidebarRobotImageScale, "robotImgScale"],
      [this.dom.sidebarRobotImageOffsetX, "robotImgOffX"], [this.dom.sidebarRobotImageOffsetY, "robotImgOffY"],
      [this.dom.sidebarRobotImageRotation, "robotImgRot"], [this.dom.sidebarRobotImageAlpha, "robotImgAlpha"],
    ] as const) input?.addEventListener("input", () => this.settings.update({ [key]: input.value }));
  }

  async applyAll(): Promise<void> { await this.apply(this.settings.current, Object.keys(this.settings.current) as (keyof MotionViewSettings)[]); }

  async handleRobotImageFile(file: File | null, input?: HTMLInputElement | null): Promise<void> {
    if (!file) return;
    try {
      await this.field.loadRobotImageFromFile(file);
      this.captureRobotImage();
    } catch (error) {
      console.error("Error loading robot image:", error);
    } finally {
      if (input) input.value = "";
    }
  }

  captureRobotImage(): void {
    this.settings.update({
      robotImage: {
        path: this.field.getRobotImagePath(),
        dataUrl: this.field.getRobotImagePath() ? null : this.field.getRobotImageDataUrl(),
      },
    }, "system");
  }

  private async apply(values: Readonly<MotionViewSettings>, keys: readonly (keyof MotionViewSettings)[]): Promise<void> {
    const changed = (...wanted: (keyof MotionViewSettings)[]) => wanted.some((key) => keys.includes(key));
    if (changed("fieldCompetition", "showPreviousYearFields", "selectedField")) {
      const previous = this.topBar.selectedField;
      const competition = normalizeFieldCompetition(values.fieldCompetition);
      const showPreviousYearFields = values.showPreviousYearFields !== false;
      const fields = getVisibleFieldImages({ competition, showPreviousYearFields });
      const selected = getValidFieldKey(values.selectedField ?? DEFAULT_FIELD_KEY, { competition, showPreviousYearFields });
      this.dom.fieldCompetition.value = competition;
      this.dom.showPreviousYears.checked = showPreviousYearFields;
      this.topBar.setFieldOptions(fields, selected);
      if (selected && (selected !== previous || !this.field.hasFieldImage())) await this.field.loadFieldImage(selected);
      if (values.selectedField !== selected) this.settings.update({ selectedField: selected }, "system");
    }
    if (changed("playbackSpeed")) this.topBar.setPlaybackSpeed(number(values.playbackSpeed, 1));
    if (changed("fieldRotation")) {
      this.dom.fieldRotation.value = String(values.fieldRotation ?? 0);
      this.field.setFieldRotationDeg(number(values.fieldRotation, 0));
    }
    if (changed("robotW", "robotH")) {
      this.dom.robotWidth.value = String(values.robotW ?? 12);
      this.dom.robotHeight.value = String(values.robotH ?? 12);
      this.field.setRobotDimensions({ w: Math.max(1, number(values.robotW, 12)), h: Math.max(1, number(values.robotH, 12)) });
    }
    if (changed("robotImageEnabled")) this.field.setRobotImageEnabled(values.robotImageEnabled !== false);
    if (changed("robotImgScale", "robotImgOffX", "robotImgOffY", "robotImgRot", "robotImgAlpha")) {
      const transform = {
        scale: Math.max(0.05, Math.min(20, number(values.robotImgScale, 1))),
        offXIn: number(values.robotImgOffX, 0), offYIn: number(values.robotImgOffY, 0),
        rotDeg: number(values.robotImgRot, 0), alpha: Math.max(0, Math.min(1, number(values.robotImgAlpha, 100) / 100)),
      };
      this.field.setRobotImageTransform(transform);
      this.syncImageInputs(transform);
    }
    if (changed("robotImage") && values.robotImage) {
      this.field.setRobotImagePath(values.robotImage.path ?? null);
      this.field.setRobotImageDataUrl(values.robotImage.dataUrl ?? null);
      if (this.field.isRobotImageEnabled()) {
        if (values.robotImage.dataUrl) this.field.loadRobotImageFromDataUrl(values.robotImage.dataUrl);
        else if (values.robotImage.path) await this.field.loadRobotImageFromPath(values.robotImage.path);
      }
    }
    this.refreshImageControls();
    requestDrawAll();
  }

  private syncImageInputs(transform: Readonly<{ scale: number; offXIn: number; offYIn: number; rotDeg: number; alpha: number }>): void {
    const values = [String(transform.scale), String(transform.offXIn), String(transform.offYIn), String(transform.rotDeg), String(Math.round(transform.alpha * 100))];
    const groups = [[this.dom.robotImageScale, this.dom.sidebarRobotImageScale], [this.dom.robotImageOffsetX, this.dom.sidebarRobotImageOffsetX], [this.dom.robotImageOffsetY, this.dom.sidebarRobotImageOffsetY], [this.dom.robotImageRotation, this.dom.sidebarRobotImageRotation], [this.dom.robotImageAlpha, this.dom.sidebarRobotImageAlpha]];
    groups.forEach((inputs, index) => inputs.forEach((input) => { if (input) input.value = values[index]!; }));
  }
  private refreshImageControls(): void {
    this.dom.robotImageToggle.checked = this.field.isRobotImageEnabled();
    this.dom.robotImageControls.hidden = !(this.field.isRobotImageEnabled() && this.field.isRobotImageReady());
    if (this.dom.sidebarRobotImageControls) this.dom.sidebarRobotImageControls.hidden = !this.field.isRobotImageReady();
  }
}

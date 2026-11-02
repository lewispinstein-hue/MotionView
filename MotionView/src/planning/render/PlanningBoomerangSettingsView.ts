import { bindModalBackdropDismissal } from "../../app/dialogs/modalDismissal";
import { getCurrentUnits, type MotionViewUnit } from "../../shared/units";
import type { PlanningDom } from "../PlanningDom";
import {
  applyBoomerangLibraryPreset,
  BOOMERANG_MOTOR_WATTS,
  normalizeBoomerangMotorWatts,
  normalizeBoomerangPreviewConfiguration,
  type BoomerangLibrary,
  type BoomerangPreviewConfiguration,
  type BoomerangPreviewModel,
} from "../planningBoomerangConfiguration";
import { boomerangInputNumber, boomerangInputUnit, type BoomerangInputDimension } from "./planningBoomerangInputUnits";

type NumericKey = { [K in keyof BoomerangPreviewConfiguration]: BoomerangPreviewConfiguration[K] extends number ? K : never }[keyof BoomerangPreviewConfiguration];
interface NumberField {
  readonly key: NumericKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly dimension?: BoomerangInputDimension;
  readonly model?: BoomerangPreviewModel;
}

const ROBOT_FIELDS: readonly NumberField[] = [
  { key: "motorWatts", label: "Drivetrain power (W)", ...BOOMERANG_MOTOR_WATTS },
  { key: "maxSpeedInchesPerSecond", label: "Theoretical speed", min: 1, max: 300, dimension: "speed" },
  { key: "robotWeightPounds", label: "Approx. weight", min: 0.1, max: 200, dimension: "weight" },
  { key: "trackWidth", label: "Effective track width", min: 0.1, max: 100, dimension: "distance" },
];
const LIBRARY_FIELDS: readonly NumberField[] = [
  { key: "horizontalDrift", label: "Horizontal drift", min: 0, max: 100, model: "lemlib" },
  { key: "lateralSlew", label: "Lateral slew (power/tick)", min: 0, max: 127 },
  { key: "settlingDistance", label: "Settling distance", min: 0, max: 1000, dimension: "distance" },
  { key: "settlingMinSpeed", label: "Settling power floor", min: 0, max: 127, model: "lemlib" },
  { key: "maxCarrotDistance", label: "Maximum carrot distance", min: 0, max: 1000, dimension: "distance", model: "ez-template" },
  { key: "lookAheadDistance", label: "Lookahead distance", min: 0.1, max: 1000, dimension: "distance", model: "ez-template" },
  { key: "turnBias", label: "Turn bias", min: 0.1, max: 10, model: "ez-template" },
];

/** Owns an isolated settings draft; only the explicit Save button commits it. */
export class PlanningBoomerangSettingsView {
  #draft = normalizeBoomerangPreviewConfiguration(undefined);
  #resolve: ((result: BoomerangPreviewConfiguration | null) => void) | null = null;
  readonly #inputs = new Map<string, HTMLInputElement>();
  readonly #conversions = new Map<string, { factor: number; display: string; original: number }>();
  #units: MotionViewUnit = "in";

  constructor(private readonly dom: PlanningDom) {}

  bind(): void {
    this.dom.boomerangSettingsClose.addEventListener("click", () => this.cancel());
    this.dom.boomerangSettingsCancel.addEventListener("click", () => this.cancel());
    this.dom.boomerangSettingsSave.addEventListener("click", () => {
      if (this.#resolve && this.dom.boomerangSettingsForm.reportValidity()) this.close(this.read());
    });
    bindModalBackdropDismissal(this.dom.boomerangSettingsModal, () => this.cancel());
    this.dom.boomerangSettingsForm.addEventListener("submit", (event) => {
      event.preventDefault();
    });
    this.dom.boomerangSettingsForm.addEventListener("keydown", (event) => {
      // Enter commits a numeric edit, never the whole settings modal. Keep
      // native keyboard activation on Save/Cancel and selection in dropdowns.
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }

  open(configuration: BoomerangPreviewConfiguration): Promise<BoomerangPreviewConfiguration | null> {
    this.cancel();
    this.#draft = normalizeBoomerangPreviewConfiguration(configuration);
    this.#units = getCurrentUnits();
    this.render();
    this.dom.templateModal.inert = true;
    this.dom.boomerangSettingsModal.hidden = false;
    this.dom.boomerangSettingsModal.style.display = "flex";
    requestAnimationFrame(() => this.#inputs.get("motorWatts")?.focus());
    return new Promise((resolve) => { this.#resolve = resolve; });
  }

  cancel(): boolean {
    if (!this.#resolve) return false;
    this.close(null);
    return true;
  }

  private close(result: BoomerangPreviewConfiguration | null): void {
    const resolve = this.#resolve;
    this.#resolve = null;
    this.dom.templateModal.inert = false;
    this.dom.boomerangSettingsModal.hidden = true;
    this.dom.boomerangSettingsModal.style.display = "none";
    this.dom.boomerangSettingsButton.focus({ preventScroll: true });
    resolve?.(result);
  }

  private read(): BoomerangPreviewConfiguration {
    const value = { ...this.#draft };
    for (const [key, input] of this.#inputs) {
      if (key.includes(".") || input.disabled) continue;
      const conversion = this.#conversions.get(key)!;
      const stored = input.value === conversion.display ? conversion.original : input.valueAsNumber * conversion.factor;
      Object.assign(value, { [key]: stored });
    }
    for (const key of ["lateralPID", "angularPID"] as const) {
      value[key] = {
        ...value[key],
        kP: this.#inputs.get(`${key}.kP`)!.valueAsNumber,
        kI: this.#inputs.get(`${key}.kI`)!.valueAsNumber,
        kD: this.#inputs.get(`${key}.kD`)!.valueAsNumber,
      };
    }
    if (value.previewModel === "ez-template") value.settlingDistance = value.lookAheadDistance / 2;
    return normalizeBoomerangPreviewConfiguration(value);
  }

  private render(): void {
    this.#inputs.clear();
    this.#conversions.clear();
    const content = this.dom.boomerangSettingsContent;
    content.replaceChildren();
    const robot = this.group("Robot", "Enter theoretical speed at rated motor RPM, not measured loaded speed. PID defaults are starting assumptions, not recommended tuning.");
    this.addFields(robot, ROBOT_FIELDS);
    const pidGrid = document.createElement("div");
    pidGrid.className = "planBoomerangPIDGrid";
    for (const [key, title] of [["lateralPID", "Linear PID"], ["angularPID", "Angular PID"]] as const) {
      const row = document.createElement("div");
      row.className = "planBoomerangPID";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", title);
      const heading = document.createElement("span");
      heading.className = "planBoomerangPIDTitle";
      heading.textContent = title;
      row.appendChild(heading);
      for (const gain of ["kP", "kI", "kD"] as const)
        row.appendChild(this.numberInput(`${key}.${gain}`, gain, this.#draft[key][gain], -1000, 1000));
      pidGrid.appendChild(row);
    }
    robot.appendChild(pidGrid);
    content.appendChild(robot);

    const library = this.group("Library", "Presets load library defaults. Custom keeps your current values. Neither changes robot settings, PID, waypoint lead, or code.");
    const selectors = document.createElement("div");
    selectors.className = "planBoomerangFields";
    const label = document.createElement("label");
    label.className = "planBoomerangField";
    label.textContent = "Library preset";
    const preset = document.createElement("select");
    preset.id = "planBoomerangLibrary";
    preset.className = "settingsSelect";
    for (const [value, name] of [["lemlib", "LemLib"], ["ez-template", "EZ-Template"], ["custom", "Custom"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = name;
      preset.appendChild(option);
    }
    preset.value = this.#draft.library;
    preset.addEventListener("change", () => {
      if (!this.dom.boomerangSettingsForm.reportValidity()) {
        preset.value = this.#draft.library;
        return;
      }
      this.#draft = applyBoomerangLibraryPreset(preset.value as BoomerangLibrary, this.read());
      this.render();
      this.dom.boomerangSettingsContent.querySelector<HTMLElement>("#planBoomerangLibrary")?.focus();
    });
    label.appendChild(preset);
    const modelLabel = document.createElement("label");
    modelLabel.className = "planBoomerangField";
    modelLabel.textContent = "Preview model";
    const model = document.createElement("select");
    model.id = "planBoomerangPreviewModel";
    model.className = "settingsSelect";
    for (const [value, name] of [["lemlib", "Final-heading settling (LemLib-style)"], ["ez-template", "Projected-point steering (EZ-style)"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = name;
      model.appendChild(option);
    }
    model.value = this.#draft.previewModel;
    model.addEventListener("change", () => {
      if (!this.dom.boomerangSettingsForm.reportValidity()) {
        model.value = this.#draft.previewModel;
        return;
      }
      this.#draft = normalizeBoomerangPreviewConfiguration({
        ...this.read(), library: "custom", previewModel: model.value as BoomerangPreviewModel,
      });
      this.render();
      this.dom.boomerangSettingsContent.querySelector<HTMLElement>("#planBoomerangPreviewModel")?.focus();
    });
    modelLabel.appendChild(model);
    selectors.append(label, modelLabel);
    library.appendChild(selectors);
    const modelHint = document.createElement("p");
    modelHint.className = "settingsDescription";
    modelHint.textContent = "Final-heading: drift and settling settings. Projected-point: carrot distance, lookahead, and turn bias. Both use slew. Choose the closest approximation for a custom library.";
    library.appendChild(modelHint);
    this.addFields(library, LIBRARY_FIELDS);
    this.updateLibraryFields();
    const assumptions = document.createElement("p");
    assumptions.className = "settingsDescription planBoomerangAssumptions";
    assumptions.textContent = "Preview only; no settings are inserted into exported C++. Each segment starts at rest. Assumes matched motor gearing, a uniform square body based on track width, 85% drivetrain efficiency, and nominal traction. Actual motor response, wheel scrub, and mass distribution will differ.";
    content.append(library, assumptions);
  }

  private updateLibraryFields(): void {
    const model = this.#draft.previewModel;
    for (const field of LIBRARY_FIELDS) {
      const input = this.#inputs.get(field.key)!;
      const unused = !!field.model && field.model !== model;
      const derived = field.key === "settlingDistance" && model === "ez-template";
      input.disabled = unused || derived;
      if (!input.disabled) continue;
      const note = document.createElement("small");
      note.className = "planBoomerangFieldNote";
      note.textContent = derived ? " · Lookahead ÷ 2" : " · Not used";
      input.previousElementSibling!.appendChild(note);
      input.closest("label")!.title = derived
        ? "EZ-Template starts settling within half the lookahead distance."
        : `Not used by the ${model === "lemlib" ? "LemLib-style" : "EZ-style"} preview model.`;
    }
    if (model === "ez-template") {
      const lookahead = this.#inputs.get("lookAheadDistance")!;
      const updateDistance = () => {
        this.#inputs.get("settlingDistance")!.value = boomerangInputNumber(lookahead.valueAsNumber / 2);
      };
      lookahead.addEventListener("input", updateDistance);
      updateDistance();
    }
  }

  private group(title: string, description: string): HTMLElement {
    const group = document.createElement("section");
    group.className = "settingsSection settingsGroup";
    const heading = document.createElement("h3");
    heading.className = "settingsGroupTitle";
    heading.textContent = title;
    const hint = document.createElement("p");
    hint.className = "settingsDescription";
    hint.textContent = description;
    group.append(heading, hint);
    return group;
  }

  private addFields(parent: HTMLElement, fields: readonly NumberField[]): void {
    const grid = document.createElement("div");
    grid.className = "planBoomerangFields";
    for (const field of fields) {
      const unit = field.dimension ? boomerangInputUnit(field.dimension, this.#units) : { suffix: "", factor: 1 };
      const label = unit.suffix ? `${field.label} (${unit.suffix})` : field.label;
      const value = this.#draft[field.key];
      grid.appendChild(this.numberInput(field.key, label, value / unit.factor, field.min / unit.factor, field.max / unit.factor, field.step));
      const input = this.#inputs.get(field.key)!;
      this.#conversions.set(field.key, { factor: unit.factor, display: input.value, original: value });
      if (field.key === "motorWatts") {
        const snapPower = () => {
          input.value = String(normalizeBoomerangMotorWatts(input.valueAsNumber, this.#draft.motorWatts));
        };
        input.addEventListener("change", snapPower);
        input.addEventListener("blur", snapPower);
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") snapPower();
        });
      }
    }
    parent.appendChild(grid);
  }

  private numberInput(key: string, label: string, value: number, min: number, max: number, step: number | "any" = "any"): HTMLLabelElement {
    const field = document.createElement("label");
    field.className = "planBoomerangField";
    const caption = document.createElement("span");
    caption.textContent = label;
    const input = document.createElement("input");
    input.id = `planBoomerang-${key}`;
    input.type = "number";
    input.className = "settingsInput";
    input.required = true;
    input.min = boomerangInputNumber(min);
    input.max = boomerangInputNumber(max);
    input.step = String(step);
    input.value = boomerangInputNumber(value);
    this.#inputs.set(key, input);
    field.append(caption, input);
    return field;
  }
}

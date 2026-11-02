import type { PlanningFeature } from "../PlanningFeature";
import { getCurrentUnits } from "../../shared/units";
import { applyPlanningLibraryPreset, normalizePlanningMotorWatts, PLANNING_MOTOR_WATTS,
  type PlanningControllerModel, type PlanningPIDRole, type PlanningSimulationConfiguration,
  type PlanningSimulationLibrary } from "../planningSimulationConfiguration";
import { simulationInputNumber, simulationInputUnit, type SimulationInputDimension } from "./planningSimulationInputUnits";

type NumericKey = { [K in keyof PlanningSimulationConfiguration]: PlanningSimulationConfiguration[K] extends number ? K : never }[keyof PlanningSimulationConfiguration];
interface NumberField {
  key: NumericKey; label: string; min: number; max: number; step?: number;
  dimension?: SimulationInputDimension; model?: PlanningControllerModel;
}
const ROBOT_FIELDS: readonly NumberField[] = [
  { key: "motorWatts", label: "Drivetrain power (W)", ...PLANNING_MOTOR_WATTS },
  { key: "maxSpeedInchesPerSecond", label: "Theoretical speed", min: 1, max: 300, dimension: "speed" },
  { key: "robotWeightPounds", label: "Approx. weight", min: 0.1, max: 200, dimension: "weight" },
  { key: "trackWidth", label: "Effective track width", min: 0.1, max: 100, dimension: "distance" },
];
const LIBRARY_FIELDS: readonly NumberField[] = [
  { key: "horizontalDrift", label: "Horizontal drift", min: 0, max: 100, model: "lemlib" },
  { key: "lateralSlew", label: "Lateral slew (power/tick)", min: 0, max: 127, model: "lemlib" },
  { key: "ezSlewDistance", label: "Drive slew distance", min: 0, max: 100, dimension: "distance", model: "ez-template" },
  { key: "maxCarrotDistance", label: "Maximum carrot distance", min: 0, max: 1000, dimension: "distance", model: "ez-template" },
  { key: "lookAheadDistance", label: "Lookahead distance", min: 0.1, max: 1000, dimension: "distance", model: "ez-template" },
  { key: "turnBias", label: "Turn bias", min: 0.1, max: 10, model: "ez-template" },
];
const PID_ROWS: readonly [PlanningPIDRole, string, PlanningControllerModel?][] = [
  ["lateralPID", "Linear PID"], ["angularPID", "Angular PID", "lemlib"],
  ["pointSteeringPID", "Point steering PID", "ez-template"], ["boomerangSteeringPID", "Boomerang steering PID", "ez-template"],
  ["turnPID", "Turn PID", "ez-template"], ["swingPID", "Swing PID", "ez-template"],
];

/** Live document settings: each completed field edit is one history transaction. */
export class PlanningSimulationSettingsView {
  readonly #inputs = new Map<string, HTMLInputElement>();
  readonly #numericFields = new Map<string, NumberField>();
  readonly #conversions = new Map<string, { factor: number; display: string; original: number }>();
  #units = getCurrentUnits();
  #preset!: HTMLSelectElement;
  #model!: HTMLSelectElement;
  constructor(private readonly planning: PlanningFeature, private readonly content: HTMLElement) {}
  bind(): void {
    this.build(); this.render(true);
    this.planning.events.documentChanged.subscribe(({ kind }) => {
      if (["simulation-configuration", "history", "imported", "cleared"].includes(kind)) this.render(kind !== "simulation-configuration");
    });
  }
  render(force = false): void {
    const config = this.planning.simulationConfiguration;
    const units = getCurrentUnits();
    force ||= units !== this.#units;
    this.#units = units;
    this.#preset.value = config.library; this.#model.value = config.previewModel;
    this.#model.disabled = config.library !== "custom";
    for (const [key, input] of this.#inputs) {
      const field = this.#numericFields.get(key);
      const row = PID_ROWS.find(([role]) => key.startsWith(`${role}.`));
      const model = field?.model ?? row?.[2];
      const unused = !!model && config.previewModel !== model;
      input.disabled = unused;
      const label = input.closest("label")!;
      label.title = unused ? "Not used by the selected controller model." : "";
      const unit = field?.dimension ? simulationInputUnit(field.dimension, units) : { suffix: "", factor: 1 };
      if (field) label.querySelector("span")!.textContent = `${field.label}${unit.suffix ? ` (${unit.suffix})` : ""}${unused ? " · Not used" : ""}`;
      const value = field ? config[field.key] : config[key.split(".")[0] as PlanningPIDRole][key.split(".")[1] as "kP" | "kI" | "kD"];
      if (force || document.activeElement !== input && input.dataset.invalid !== "true") {
        input.value = simulationInputNumber(value / unit.factor);
        input.removeAttribute("aria-invalid"); delete input.dataset.invalid;
        this.#conversions.set(key, { factor: unit.factor, display: input.value, original: value });
      }
      if (field) { input.min = simulationInputNumber(field.min / unit.factor); input.max = simulationInputNumber(field.max / unit.factor); }
    }
    for (const row of this.content.querySelectorAll<HTMLElement>("[data-pid-model]")) row.hidden = row.dataset.pidModel !== config.previewModel;
  }
  private build(): void {
    this.content.replaceChildren();
    const heading = document.createElement("h3"); heading.textContent = "Simulation";
    const description = document.createElement("p"); description.className = "settingsDescription";
    description.textContent = "Approximate preview and playback for all motions. Shared across paths and saved with this document. Valid edits save on Enter or when you leave a field. Preview follows selected motions; custom C++ and Methods are not executed.";
    this.content.append(heading, description);
    const selectors = this.grid();
    this.#preset = this.select(selectors, "Library preset", [["lemlib", "LemLib"], ["ez-template", "EZ-Template"], ["custom", "Custom"]]);
    this.#preset.id = "settingsPlanSimulationLibrary";
    this.#model = this.select(selectors, "Custom base model", [["lemlib", "LemLib"], ["ez-template", "EZ-Template"]]);
    this.#model.id = "settingsPlanSimulationModel";
    this.#preset.addEventListener("change", () => this.planning.setSimulationConfiguration(applyPlanningLibraryPreset(this.#preset.value as PlanningSimulationLibrary, this.planning.simulationConfiguration)));
    this.#model.addEventListener("change", () => this.planning.setSimulationConfiguration({ library: "custom", previewModel: this.#model.value as PlanningControllerModel }));
    this.content.appendChild(selectors);
    this.group("Robot");
    const robot = this.grid(); this.content.appendChild(robot);
    for (const field of ROBOT_FIELDS) this.addField(robot, field);
    const hint = document.createElement("p"); hint.className = "settingsDescription";
    hint.textContent = "Use theoretical speed at rated motor RPM. PID gains use the library’s native units and are not converted with app units. Defaults are preview assumptions, not recommended robot tuning.";
    this.content.appendChild(hint);
    for (const [key, title, model] of PID_ROWS) {
      const row = document.createElement("div"); row.className = "planSimulationPID";
      if (model) row.dataset.pidModel = model;
      const label = document.createElement("span"); label.className = "planSimulationPIDTitle"; label.textContent = title;
      row.appendChild(label);
      for (const gain of ["kP", "kI", "kD"] as const) this.number(row, `${key}.${gain}`, gain, -1000, 1000);
      this.content.appendChild(row);
    }
    this.group("Library tuning");
    const library = this.grid(); this.content.appendChild(library);
    for (const field of LIBRARY_FIELDS) this.addField(library, field);
    const note = document.createElement("p"); note.className = "settingsDescription";
    note.textContent = "Presets reset library tuning while preserving robot specifications and every PID value. Physical assumptions and stopping rules use built-in defaults. These settings do not change exported C++.";
    this.content.appendChild(note);
  }
  private commit(key: string, input: HTMLInputElement): void {
    if (input.disabled) return;
    if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
      input.dataset.invalid = "true"; input.setAttribute("aria-invalid", "true"); return;
    }
    delete input.dataset.invalid; input.removeAttribute("aria-invalid");
    const previous = this.#conversions.get(key)!;
    let value = input.value === previous.display ? previous.original : input.valueAsNumber * previous.factor;
    if (key === "motorWatts") value = normalizePlanningMotorWatts(value);
    const [role, gain] = key.split(".");
    this.planning.setSimulationConfiguration(gain ? { [role!]: { [gain]: value } } : { [key]: value });
    input.value = simulationInputNumber(value / previous.factor);
    this.#conversions.set(key, { ...previous, original: value, display: input.value });
  }
  private addField(parent: HTMLElement, field: NumberField): void {
    this.#numericFields.set(field.key, field);
    this.number(parent, field.key, field.label, field.min, field.max);
  }
  private number(parent: HTMLElement, key: string, title: string, min: number, max: number): void {
    const label = document.createElement("label"); label.className = "planSimulationField";
    const name = document.createElement("span"); name.textContent = title;
    const input = document.createElement("input"); input.type = "number"; input.required = true; input.step = "any";
    input.min = String(min); input.max = String(max); input.className = "settingsInput";
    input.id = `settingsPlanSimulation-${key}`; input.setAttribute("aria-label", title);
    input.addEventListener("blur", () => this.commit(key, input));
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); this.commit(key, input); }
    });
    label.append(name, input); parent.appendChild(label); this.#inputs.set(key, input);
  }
  private grid(): HTMLElement { const grid = document.createElement("div"); grid.className = "planSimulationFields"; return grid; }
  private group(title: string): void { const h = document.createElement("h4"); h.textContent = title; this.content.appendChild(h); }
  private select(parent: HTMLElement, title: string, values: readonly (readonly [string, string])[]): HTMLSelectElement {
    const label = document.createElement("label"); label.className = "planSimulationField"; label.textContent = title;
    const select = document.createElement("select"); select.className = "settingsSelect";
    for (const [value, name] of values) { const option = document.createElement("option"); option.value = value; option.textContent = name; select.appendChild(option); }
    label.appendChild(select); parent.appendChild(label); return select;
  }
}

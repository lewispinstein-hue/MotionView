import type { PlanningFeature } from "../PlanningFeature";
import { getCurrentUnits } from "../../shared/units";
import { applyPlanningLibraryPreset, normalizePlanningMotorWatts, PLANNING_MOTOR_WATTS, PLANNING_SIMULATION_MODELS,
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
  { key: "jarSetback", label: "Boomerang setback", min: 0, max: 100, dimension: "distance", model: "jar-template" },
  { key: "jarHeadingMaxVoltage", label: "Heading limit (V)", min: 0, max: 12, model: "jar-template" },
  { key: "vexTurnConstant", label: "Turn constant", min: .01, max: 10, model: "vexcode" },
  { key: "vexTurnThreshold", label: "Turn threshold (°)", min: .1, max: 15, model: "vexcode" },
];
const PID_ROWS: readonly [PlanningPIDRole, string, readonly PlanningControllerModel[]][] = [
  ["lateralPID", "Linear PID", ["lemlib", "ez-template", "jar-template"]], ["angularPID", "Angular PID", ["lemlib"]],
  ["pointSteeringPID", "Point steering PID", ["ez-template", "jar-template"]], ["boomerangSteeringPID", "Boomerang steering PID", ["ez-template"]],
  ["turnPID", "Turn PID", ["ez-template", "jar-template"]], ["swingPID", "Swing PID", ["ez-template", "jar-template"]],
];

/** Live document settings: each completed field edit is one history transaction. */
export class PlanningSimulationSettingsView {
  readonly #inputs = new Map<string, HTMLInputElement>();
  readonly #numericFields = new Map<string, NumberField>();
  readonly #conversions = new Map<string, { factor: number; display: string; original: number }>();
  #units = getCurrentUnits();
  #preset!: HTMLSelectElement;
  #model!: HTMLSelectElement;
  #customDescription!: HTMLParagraphElement;
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
    this.#customDescription.hidden = !["custom", "jar-template", "vexcode"].includes(config.previewModel);
    this.#customDescription.textContent = config.previewModel === "jar-template"
      ? "JAR uses voltage-based Linear, Heading, Turn and Swing PID gains. Travel direction is chosen automatically. Preview follows JAR's target-plane and settling rules."
      : config.previewModel === "vexcode"
        ? "Approximate VEXcode built-in motion control, shared by C++ and Python. Waypoint Speed sets drive and turn velocity. Uses the default BRAKE stopping mode; PID gains are not used. Straight aligns before driving; Swing and Boomerang preview as Turn and Straight."
        : "Custom uses every tuning control. Angular PID is blended equally with the controller for each motion. Both slew limits, horizontal drift, lookahead, carrot cap, turn bias, setback, heading limit and turn controls apply.";
    for (const [key, input] of this.#inputs) {
      const field = this.#numericFields.get(key);
      const row = PID_ROWS.find(([role]) => key.startsWith(`${role}.`));
      const models = field?.model ? [field.model] : row?.[2];
      const unused = !!models && !models.includes(config.previewModel) && config.previewModel !== "custom";
      input.disabled = unused;
      const label = input.closest("label")!;
      label.title = unused ? "Not used by the selected controller model." : "";
      // Shared gains are retained in power units when switching presets. JAR's
      // UI uses its native volts; committing converts back without losing edits.
      const jarGain = !!row && config.previewModel === "jar-template";
      const unit = field?.dimension ? simulationInputUnit(field.dimension, units) : { suffix: "", factor: jarGain ? 127 / 12 : 1 };
      if (field) label.querySelector("span")!.textContent = `${field.label}${unit.suffix ? ` (${unit.suffix})` : ""}${unused ? " · Not used" : ""}`;
      const value = field ? config[field.key] : config[key.split(".")[0] as PlanningPIDRole][key.split(".")[1] as "kP" | "kI" | "kD"];
      const conversionChanged = this.#conversions.get(key)?.factor !== unit.factor;
      if (force || conversionChanged || document.activeElement !== input && input.dataset.invalid !== "true") {
        input.value = jarGain ? String(Number((value / unit.factor).toFixed(4))) : simulationInputNumber(value / unit.factor);
        input.removeAttribute("aria-invalid"); delete input.dataset.invalid;
        this.#conversions.set(key, { factor: unit.factor, display: input.value, original: value });
      }
      input.min = String((field?.min ?? -1000) / unit.factor);
      input.max = String((field?.max ?? 1000) / unit.factor);
    }
    for (const row of this.content.querySelectorAll<HTMLElement>("[data-pid-model]")) {
      row.hidden = config.previewModel !== "custom" && !row.dataset.pidModel!.split(" ").includes(config.previewModel);
      const entry = PID_ROWS.find(([role]) => role === row.dataset.pidRole)!;
      row.querySelector<HTMLElement>(".planSimulationPIDTitle")!.textContent = config.previewModel === "jar-template"
        ? `${entry[0] === "pointSteeringPID" ? "Heading PID" : entry[1]} (V)` : entry[1];
    }
  }
  private build(): void {
    this.content.replaceChildren();
    const heading = document.createElement("h3"); heading.textContent = "Simulation";
    const description = document.createElement("p"); description.className = "settingsDescription";
    description.textContent = "Approximate preview and playback for all motions. Shared across paths and saved with this document. Valid edits save on Enter or when you leave a field. Preview follows selected motions; custom code and Methods are not executed.";
    this.content.append(heading, description);
    const selectors = this.grid();
    this.#preset = this.select(selectors, "Library preset", PLANNING_SIMULATION_MODELS);
    this.#preset.id = "settingsPlanSimulationLibrary";
    this.#model = this.select(selectors, "Custom base model", PLANNING_SIMULATION_MODELS);
    this.#model.id = "settingsPlanSimulationModel";
    this.#preset.addEventListener("change", () => this.planning.setSimulationConfiguration(applyPlanningLibraryPreset(this.#preset.value as PlanningSimulationLibrary, this.planning.simulationConfiguration)));
    this.#model.addEventListener("change", () => this.planning.setSimulationConfiguration({ library: "custom", previewModel: this.#model.value as PlanningControllerModel }));
    this.content.appendChild(selectors);
    this.#customDescription = document.createElement("p");
    this.#customDescription.className = "settingsDescription";
    this.#customDescription.textContent = "Custom uses every tuning control. Angular PID is blended equally with the controller for each motion. Both slew limits, horizontal drift, lookahead, carrot cap and turn bias apply.";
    this.content.appendChild(this.#customDescription);
    this.group("Robot");
    const robot = this.grid(); this.content.appendChild(robot);
    for (const field of ROBOT_FIELDS) this.addField(robot, field);
    const hint = document.createElement("p"); hint.className = "settingsDescription";
    hint.textContent = "Use theoretical speed at rated motor RPM. PID gains use the library’s native units and are not converted with app units. Defaults are preview assumptions, not recommended robot tuning.";
    this.content.appendChild(hint);
    for (const [key, title, models] of PID_ROWS) {
      const row = document.createElement("div"); row.className = "planSimulationPID";
      row.dataset.pidModel = models.join(" "); row.dataset.pidRole = key;
      const label = document.createElement("span"); label.className = "planSimulationPIDTitle"; label.textContent = title;
      row.appendChild(label);
      for (const gain of ["kP", "kI", "kD"] as const) this.number(row, `${key}.${gain}`, gain, -1000, 1000);
      this.content.appendChild(row);
    }
    this.group("Library tuning");
    const library = this.grid(); this.content.appendChild(library);
    for (const field of LIBRARY_FIELDS) this.addField(library, field);
    const note = document.createElement("p"); note.className = "settingsDescription";
    note.textContent = "Presets reset library tuning while preserving robot specifications and every PID value. Physical assumptions and stopping rules use built-in defaults. These settings do not change exported code.";
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

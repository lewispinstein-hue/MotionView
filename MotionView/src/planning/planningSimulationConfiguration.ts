export interface PreviewPIDConfiguration {
  /** Stored in motor-power units; JAR's settings editor displays the voltage equivalent. */
  readonly kP: number;
  readonly kI: number;
  readonly kD: number;
  readonly windupRange: number;
  readonly signFlipReset: boolean;
}
export type PlanningControllerModel = "lemlib" | "ez-template" | "jar-template" | "vexcode" | "custom";
export type PlanningSimulationLibrary = PlanningControllerModel;
export const PLANNING_SIMULATION_MODELS = [
  ["lemlib", "LemLib"], ["ez-template", "EZ-Template"], ["jar-template", "JAR-Template"],
  ["vexcode", "VEXcode"], ["custom", "Custom"],
] as const satisfies readonly (readonly [PlanningControllerModel, string])[];

function isControllerModel(value: unknown): value is PlanningControllerModel {
  return PLANNING_SIMULATION_MODELS.some(([id]) => id === value);
}
export const PLANNING_MOTOR_WATTS = { min: 22, max: 88, step: 5.5 } as const;
export const PLANNING_PID_ROLES = [
  "lateralPID",
  "angularPID",
  "pointSteeringPID",
  "boomerangSteeringPID",
  "turnPID",
  "swingPID",
] as const;
export type PlanningPIDRole = (typeof PLANNING_PID_ROLES)[number];

/** Document-wide user inputs. Physical assumptions and stop rules live in the engine. */
export interface PlanningSimulationConfiguration {
  readonly library: PlanningSimulationLibrary;
  readonly previewModel: PlanningControllerModel;
  readonly separatePIDsInitialized: boolean;
  readonly lateralPID: PreviewPIDConfiguration;
  readonly angularPID: PreviewPIDConfiguration;
  readonly pointSteeringPID: PreviewPIDConfiguration;
  readonly boomerangSteeringPID: PreviewPIDConfiguration;
  readonly turnPID: PreviewPIDConfiguration;
  readonly swingPID: PreviewPIDConfiguration;
  readonly lateralSlew: number;
  readonly ezSlewDistance: number;
  readonly trackWidth: number;
  readonly motorWatts: number;
  readonly maxSpeedInchesPerSecond: number;
  readonly robotWeightPounds: number;
  readonly maxCarrotDistance: number;
  readonly lookAheadDistance: number;
  readonly turnBias: number;
  readonly horizontalDrift: number;
  readonly jarSetback: number;
  readonly jarHeadingMaxVoltage: number;
  readonly vexTurnConstant: number;
  readonly vexTurnThreshold: number;
}
export type PlanningSimulationConfigurationUpdate = Partial<
  Omit<PlanningSimulationConfiguration, PlanningPIDRole>
> & { readonly [K in PlanningPIDRole]?: Partial<PreviewPIDConfiguration> };

type LibraryTuning = Pick<
  PlanningSimulationConfiguration,
  | "horizontalDrift"
  | "lateralSlew"
  | "ezSlewDistance"
  | "maxCarrotDistance"
  | "lookAheadDistance"
  | "turnBias"
  | "jarSetback"
  | "jarHeadingMaxVoltage"
  | "vexTurnConstant"
  | "vexTurnThreshold"
>;
// Reference: LemLib stable moveToPose.cpp; EZ drive_defaults_set(), not header initializers.
// Drift and disabled slew are nominal robot assumptions, not recommended tuning.
const COMMON_TUNING = {
  jarSetback: 0, jarHeadingMaxVoltage: 12, vexTurnConstant: 1, vexTurnThreshold: 1,
};
const LIBRARY_DEFAULTS: Record<PlanningControllerModel, LibraryTuning> = {
  lemlib: {
    ...COMMON_TUNING,
    horizontalDrift: 8,
    lateralSlew: 0,
    ezSlewDistance: 3,
    maxCarrotDistance: 0,
    lookAheadDistance: 7,
    turnBias: 1,
  },
  "ez-template": {
    ...COMMON_TUNING,
    horizontalDrift: 0,
    lateralSlew: 0,
    ezSlewDistance: 3,
    maxCarrotDistance: 16,
    lookAheadDistance: 7,
    turnBias: 0.9,
  },
  custom: {
    ...COMMON_TUNING,
    horizontalDrift: 8,
    lateralSlew: 0,
    ezSlewDistance: 3,
    maxCarrotDistance: 16,
    lookAheadDistance: 7,
    turnBias: 0.9,
  },
  "jar-template": {
    ...COMMON_TUNING,
    // JAR's odom_constants(): heading output is limited to 10 V; a global
    // boomerang_setback left unset is zero. PID gains remain user-owned.
    jarHeadingMaxVoltage: 10,
    horizontalDrift: 0, lateralSlew: 0, ezSlewDistance: 3,
    maxCarrotDistance: 0, lookAheadDistance: 7, turnBias: 1,
  },
  vexcode: {
    ...COMMON_TUNING,
    horizontalDrift: 0, lateralSlew: 0, ezSlewDistance: 3,
    maxCarrotDistance: 0, lookAheadDistance: 7, turnBias: 1,
  },
};
const linear = Object.freeze({
  kP: 10,
  kI: 0,
  kD: 3,
  windupRange: 0,
  signFlipReset: true,
});
const angular = Object.freeze({
  kP: 2,
  kI: 0,
  kD: 10,
  windupRange: 0,
  signFlipReset: true,
});
export const DEFAULT_PLANNING_SIMULATION_CONFIGURATION: PlanningSimulationConfiguration =
  Object.freeze({
    library: "lemlib",
    previewModel: "lemlib",
    separatePIDsInitialized: false,
    lateralPID: linear,
    angularPID: angular,
    pointSteeringPID: angular,
    boomerangSteeringPID: angular,
    turnPID: angular,
    swingPID: angular,
    ...LIBRARY_DEFAULTS.lemlib,
    trackWidth: 12,
    motorWatts: 66,
    maxSpeedInchesPerSecond: 60,
    robotWeightPounds: 15,
  });
function bounded(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}
export function normalizePlanningMotorWatts(
  value: unknown,
  fallback = 66,
): number {
  const { min, max, step } = PLANNING_MOTOR_WATTS;
  return (
    Math.round(
      bounded(value, bounded(fallback, 66, min, max), min, max) / step,
    ) * step
  );
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function normalizePID(
  raw: unknown,
  fallback: PreviewPIDConfiguration,
): PreviewPIDConfiguration {
  const value = record(raw);
  return {
    kP: bounded(value.kP, fallback.kP, -1000, 1000),
    kI: bounded(value.kI, fallback.kI, -1000, 1000),
    kD: bounded(value.kD, fallback.kD, -1000, 1000),
    // These library implementation details are intentionally not user inputs.
    windupRange: 0,
    signFlipReset: true,
  };
}
export function normalizePlanningSimulationConfiguration(
  raw: unknown,
  fallback = DEFAULT_PLANNING_SIMULATION_CONFIGURATION,
): PlanningSimulationConfiguration {
  const value = record(raw);
  const library = isControllerModel(value.library) ? value.library : fallback.library;
  const previewModel =
    library !== "custom"
      ? library
      : isControllerModel(value.previewModel)
        ? value.previewModel
        : fallback.previewModel;
  const defaults =
    previewModel === fallback.previewModel
      ? fallback
      : LIBRARY_DEFAULTS[previewModel];
  const angularPID = normalizePID(value.angularPID, fallback.angularPID);
  const initialized =
    typeof value.separatePIDsInitialized === "boolean"
      ? value.separatePIDsInitialized
      : PLANNING_PID_ROLES.slice(2).some((key) => Object.hasOwn(value, key)) ||
        fallback.separatePIDsInitialized;
  const seedSeparate = !initialized && previewModel !== "lemlib" && previewModel !== "vexcode";
  const gains = Object.fromEntries(
    PLANNING_PID_ROLES.map((key) => [
      key,
      normalizePID(
        seedSeparate && key !== "lateralPID" && key !== "angularPID"
          ? angularPID
          : value[key],
        key === "lateralPID"
          ? fallback.lateralPID
          : key === "angularPID"
            ? angularPID
            : // A legacy two-PID document seeds extra controllers from its angular gains.
              fallback === DEFAULT_PLANNING_SIMULATION_CONFIGURATION &&
                value.angularPID &&
                !Object.hasOwn(value, "pointSteeringPID")
              ? angularPID
              : fallback[key],
      ),
    ]),
  ) as Record<PlanningPIDRole, PreviewPIDConfiguration>;
  return {
    library,
    previewModel,
    separatePIDsInitialized: initialized || seedSeparate,
    ...gains,
    lateralSlew: bounded(value.lateralSlew, defaults.lateralSlew, 0, 127),
    ezSlewDistance: bounded(
      value.ezSlewDistance,
      defaults.ezSlewDistance,
      0,
      100,
    ),
    trackWidth: bounded(value.trackWidth, fallback.trackWidth, 0.1, 100),
    motorWatts: normalizePlanningMotorWatts(
      value.motorWatts,
      fallback.motorWatts,
    ),
    maxSpeedInchesPerSecond: bounded(
      value.maxSpeedInchesPerSecond,
      fallback.maxSpeedInchesPerSecond,
      1,
      300,
    ),
    robotWeightPounds: bounded(
      value.robotWeightPounds,
      fallback.robotWeightPounds,
      0.1,
      200,
    ),
    maxCarrotDistance: bounded(
      value.maxCarrotDistance,
      defaults.maxCarrotDistance,
      0,
      1000,
    ),
    lookAheadDistance: bounded(
      value.lookAheadDistance,
      defaults.lookAheadDistance,
      0.1,
      1000,
    ),
    turnBias: bounded(value.turnBias, defaults.turnBias, 0.1, 10),
    horizontalDrift: bounded(
      value.horizontalDrift,
      defaults.horizontalDrift,
      0,
      100,
    ),
    jarSetback: bounded(value.jarSetback, defaults.jarSetback, 0, 100),
    jarHeadingMaxVoltage: bounded(value.jarHeadingMaxVoltage, defaults.jarHeadingMaxVoltage, 0, 12),
    vexTurnConstant: bounded(value.vexTurnConstant, defaults.vexTurnConstant, 0.01, 10),
    vexTurnThreshold: bounded(value.vexTurnThreshold, defaults.vexTurnThreshold, 0.1, 15),
  };
}
/** Presets never replace robot specifications, PID gains, waypoint data, or code. */
export function applyPlanningLibraryPreset(
  library: PlanningSimulationLibrary,
  current: PlanningSimulationConfiguration,
): PlanningSimulationConfiguration {
  return normalizePlanningSimulationConfiguration(
    library === "custom"
      ? { ...current, library }
      : {
          ...current,
          ...LIBRARY_DEFAULTS[library],
          library,
          previewModel: library,
        },
  );
}

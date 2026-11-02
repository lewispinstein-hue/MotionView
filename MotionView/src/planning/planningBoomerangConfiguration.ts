export interface PreviewPIDConfiguration {
  readonly kP: number;
  readonly kI: number;
  readonly kD: number;
  readonly windupRange: number;
  readonly signFlipReset: boolean;
}

export type BoomerangPreviewModel = "lemlib" | "ez-template";
export type BoomerangLibrary = BoomerangPreviewModel | "custom";

export const BOOMERANG_MOTOR_WATTS = { min: 22, max: 88, step: 5.5 } as const;

/** Shared preview tuning; never changes the user's templates or waypoint lead. */
export interface BoomerangPreviewConfiguration {
  readonly library: BoomerangLibrary;
  readonly previewModel: BoomerangPreviewModel;
  readonly lateralPID: PreviewPIDConfiguration;
  /** Angular PID errors are in degrees; lateral PID errors are in inches. */
  readonly angularPID: PreviewPIDConfiguration;
  readonly lateralSlew: number;
  readonly trackWidth: number;
  readonly motorWatts: number;
  readonly maxSpeedInchesPerSecond: number;
  readonly robotWeightPounds: number;
  readonly maxCarrotDistance: number;
  readonly lookAheadDistance: number;
  readonly turnBias: number;
  readonly horizontalDrift: number;
  readonly settlingDistance: number;
  readonly settlingMinSpeed: number;
  readonly lateralTolerance: number;
  readonly angularTolerance: number;
  readonly settleTimeSeconds: number;
  readonly timeStepSeconds: number;
  readonly maxDurationSeconds: number;
}

export type BoomerangPreviewConfigurationUpdate =
  Partial<Omit<BoomerangPreviewConfiguration, "lateralPID" | "angularPID">> & {
    readonly lateralPID?: Partial<PreviewPIDConfiguration>;
    readonly angularPID?: Partial<PreviewPIDConfiguration>;
  };

type LibraryDefaults = Pick<BoomerangPreviewConfiguration,
  "horizontalDrift" | "lateralSlew" | "settlingDistance" | "settlingMinSpeed" |
  "maxCarrotDistance" | "lookAheadDistance" | "turnBias">;

// LemLib stable: src/lemlib/chassis/motions/moveToPose.cpp.
// EZ-Template: include/EZ-Template/drive/drive.hpp and drive/pid_tasks.cpp.
// Drift 8 and disabled slew are nominal preview assumptions, not robot tuning.
// Inapplicable restrictions are neutral; the settings form marks them unused.
const LIBRARY_DEFAULTS: Readonly<Record<BoomerangPreviewModel, Readonly<LibraryDefaults>>> = {
  lemlib: {
    horizontalDrift: 8,
    lateralSlew: 0,
    settlingDistance: 7.5,
    settlingMinSpeed: 60,
    maxCarrotDistance: 0,
    lookAheadDistance: 7,
    turnBias: 1,
  },
  "ez-template": {
    horizontalDrift: 0,
    lateralSlew: 0,
    settlingDistance: 3.5, // LOOK_AHEAD / 2, not LemLib's fixed threshold.
    settlingMinSpeed: 0,
    maxCarrotDistance: 12,
    lookAheadDistance: 7,
    turnBias: 1.375,
  },
};

// Nominal robot/PID defaults, NOT library-recommended tuning for a real robot.
// Controller defaults follow LemLib stable and EZ-Template's boomerang settings.
export const DEFAULT_BOOMERANG_PREVIEW_CONFIGURATION: BoomerangPreviewConfiguration = Object.freeze({
  library: "lemlib",
  previewModel: "lemlib",
  lateralPID: Object.freeze({ kP: 6, kI: 0, kD: 0, windupRange: 0, signFlipReset: false }),
  angularPID: Object.freeze({ kP: 2.5, kI: 0, kD: 0, windupRange: 0, signFlipReset: false }),
  ...LIBRARY_DEFAULTS.lemlib,
  trackWidth: 12,
  motorWatts: 66,
  maxSpeedInchesPerSecond: 60,
  robotWeightPounds: 15,
  lateralTolerance: 0.05,
  angularTolerance: 0.25,
  settleTimeSeconds: 0.1,
  timeStepSeconds: 0.01,
  maxDurationSeconds: 60,
});

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value)) : fallback;
}

export function normalizeBoomerangMotorWatts(value: unknown, fallback = 66): number {
  const { min, max, step } = BOOMERANG_MOTOR_WATTS;
  return Math.round(bounded(value, bounded(fallback, 66, min, max), min, max) / step) * step;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizePID(raw: unknown, fallback: PreviewPIDConfiguration): PreviewPIDConfiguration {
  const value = record(raw);
  return {
    kP: bounded(value?.kP, fallback.kP, -1000, 1000),
    kI: bounded(value?.kI, fallback.kI, -1000, 1000),
    kD: bounded(value?.kD, fallback.kD, -1000, 1000),
    windupRange: bounded(value?.windupRange, fallback.windupRange, 0, 1000),
    signFlipReset: typeof value?.signFlipReset === "boolean" ? value.signFlipReset : fallback.signFlipReset,
  };
}

export function normalizeBoomerangPreviewConfiguration(
  raw: unknown,
  fallback = DEFAULT_BOOMERANG_PREVIEW_CONFIGURATION,
): BoomerangPreviewConfiguration {
  const value = record(raw);
  const library = value.library === "lemlib" || value.library === "ez-template" || value.library === "custom"
    ? value.library : fallback.library;
  const previewModel = library !== "custom" ? library
    : value.previewModel === "lemlib" || value.previewModel === "ez-template" ? value.previewModel : fallback.previewModel;
  const defaults = previewModel === fallback.previewModel ? fallback : LIBRARY_DEFAULTS[previewModel];
  return {
    library,
    // Older saved presets have no independent model; derive it from the preset.
    // Custom profiles preserve their chosen approximation instead of silently
    // falling through to either library's controller.
    previewModel,
    lateralPID: normalizePID(value.lateralPID, fallback.lateralPID),
    angularPID: normalizePID(value.angularPID, fallback.angularPID),
    lateralSlew: bounded(value.lateralSlew, defaults.lateralSlew, 0, 127),
    trackWidth: bounded(value.trackWidth, fallback.trackWidth, 0.1, 100),
    motorWatts: normalizeBoomerangMotorWatts(value.motorWatts, fallback.motorWatts),
    maxSpeedInchesPerSecond: bounded(value.maxSpeedInchesPerSecond, fallback.maxSpeedInchesPerSecond, 1, 300),
    robotWeightPounds: bounded(value.robotWeightPounds, fallback.robotWeightPounds, 0.1, 200),
    maxCarrotDistance: bounded(value.maxCarrotDistance, defaults.maxCarrotDistance, 0, 1000),
    lookAheadDistance: bounded(value.lookAheadDistance, defaults.lookAheadDistance, 0.1, 1000),
    turnBias: bounded(value.turnBias, defaults.turnBias, 0.1, 10),
    horizontalDrift: bounded(value.horizontalDrift, defaults.horizontalDrift, 0, 100),
    settlingDistance: bounded(value.settlingDistance, defaults.settlingDistance, 0, 1000),
    settlingMinSpeed: bounded(value.settlingMinSpeed, defaults.settlingMinSpeed, 0, 127),
    lateralTolerance: bounded(value.lateralTolerance, fallback.lateralTolerance, 0, 100),
    angularTolerance: bounded(value.angularTolerance, fallback.angularTolerance, 0, 180),
    settleTimeSeconds: bounded(value.settleTimeSeconds, fallback.settleTimeSeconds, 0, 60),
    timeStepSeconds: bounded(value.timeStepSeconds, fallback.timeStepSeconds, 0.001, 0.05),
    maxDurationSeconds: bounded(value.maxDurationSeconds, fallback.maxDurationSeconds, 0.01, 120),
  };
}

/** Applying a preset leaves robot-specific values, PID tuning, and code intact. */
export function applyBoomerangLibraryPreset(
  library: BoomerangLibrary,
  current: BoomerangPreviewConfiguration,
): BoomerangPreviewConfiguration {
  if (library === "custom") return normalizeBoomerangPreviewConfiguration({ ...current, library });
  const defaults = DEFAULT_BOOMERANG_PREVIEW_CONFIGURATION;
  return normalizeBoomerangPreviewConfiguration({
    ...current,
    ...LIBRARY_DEFAULTS[library],
    library,
    previewModel: library,
    lateralTolerance: defaults.lateralTolerance,
    angularTolerance: defaults.angularTolerance,
    settleTimeSeconds: defaults.settleTimeSeconds,
  });
}

import type { PlanMotionTemplates, PlanWaypointIndicatorIcon } from "../state/models";
import { createDefaultMotionTemplates, normalizeMotionTemplates } from "./planningMotions";

export const PLANNING_TEMPLATE_LIBRARIES = [
  { id: "lemlib", name: "LemLib" },
  { id: "ez-template", name: "EZ-Template" },
  { id: "jar-template", name: "JAR-Template" },
  { id: "vexcode-cpp", name: "VEXcode C++" },
  { id: "vexcode-python", name: "VEXcode Python" },
  { id: "custom", name: "Custom" },
] as const;

export type PlanningTemplateLibrary = typeof PLANNING_TEMPLATE_LIBRARIES[number]["id"];
export type PlanningTemplateLanguage = "cpp" | "python";

export interface PlanningSwingDriveSides {
  left: string;
  right: string;
}

/** Fixed library presets and one editable Custom bank, shared across paths. */
export interface PlanningTemplateConfiguration {
  library: PlanningTemplateLibrary;
  templates: Record<PlanningTemplateLibrary, PlanMotionTemplates>;
  swingDriveSides: Record<PlanningTemplateLibrary, PlanningSwingDriveSides>;
  customLanguage: PlanningTemplateLanguage;
}

interface SavedPlanningTemplateConfiguration {
  library: PlanningTemplateLibrary;
  templates?: { custom: PlanMotionTemplates };
  swingDriveSides?: { custom: PlanningSwingDriveSides };
  customLanguage?: PlanningTemplateLanguage;
}

/** Built-in presets are restored by ID; only the editable Custom bank needs code. */
export function serializePlanningTemplateConfiguration(
  configuration: Readonly<PlanningTemplateConfiguration>,
): SavedPlanningTemplateConfiguration {
  const saved: SavedPlanningTemplateConfiguration = { library: configuration.library };
  if (Object.values(configuration.templates.custom).some(code => code !== ""))
    saved.templates = { custom: { ...configuration.templates.custom } };
  const sides = configuration.swingDriveSides.custom;
  if (sides.left !== "left" || sides.right !== "right")
    saved.swingDriveSides = { custom: { ...sides } };
  if (configuration.customLanguage !== "cpp")
    saved.customLanguage = configuration.customLanguage;
  return saved;
}

export function isPlanningTemplateLibrary(value: unknown): value is PlanningTemplateLibrary {
  return PLANNING_TEMPLATE_LIBRARIES.some(library => library.id === value);
}

export function createPlanningTemplateConfiguration(): PlanningTemplateConfiguration {
  const configuration: PlanningTemplateConfiguration = {
    library: "custom",
    customLanguage: "cpp",
    templates: {
      // Use blocking LemLib calls and explicit EZ waits so ordered motions and
      // timeline nodes do not overtake a movement still running on the robot.
      // https://github.com/LemLib/LemLib/blob/stable/include/lemlib/chassis/chassis.hpp
      lemlib: {
        forward: "chassis.moveToPoint(@x, @y, 4000, {.forwards = @fwd, .maxSpeed = @spd}, false);",
        rotate: "chassis.turnToHeading(@th, 2000, {.maxSpeed = @spd}, false);",
        swing: "chassis.swingToHeading(@th, @side, 2000, {.maxSpeed = @spd}, false);",
        boomerang: "chassis.moveToPose(@x, @y, @th, 4000, {.forwards = @fwd, .lead = @ld, .maxSpeed = @spd}, false);",
      },
      // https://github.com/EZ-Robotics/EZ-Template/blob/main/include/EZ-Template/drive/drive.hpp
      "ez-template": {
        forward: "chassis.pid_odom_set(ez::odom{{@x, @y}, @fwd ? ez::fwd : ez::rev, @spd});\nchassis.pid_wait();",
        rotate: "chassis.pid_turn_set(@th, @spd, ez::shortest);\nchassis.pid_wait();",
        swing: "chassis.pid_swing_set(@side, @th, @spd, ez::shortest);\nchassis.pid_wait();",
        boomerang: "chassis.odom_boomerang_dlead_set(@ld);\nchassis.pid_odom_set(ez::odom{{@x, @y, @th}, @fwd ? ez::fwd : ez::rev, @spd});\nchassis.pid_wait();",
      },
      // JAR uses volts rather than PROS power, and chooses travel direction itself.
      // A right swing moves the right side, matching the default locked left side.
      // https://github.com/JacksonAreaRobotics/JAR-Template/blob/main/include/JAR-Template/drive.h
      "jar-template": {
        forward: "chassis.drive_to_point(@x, @y, chassis.drive_min_voltage, @spd * 12.0 / 127.0, chassis.heading_max_voltage);",
        rotate: "chassis.turn_to_angle(@th, @spd * 12.0 / 127.0);",
        swing: "chassis.@side(@th);",
        boomerang: "chassis.drive_to_pose(@x, @y, @th, @ld, chassis.boomerang_setback, chassis.drive_min_voltage, @spd * 12.0 / 127.0, chassis.heading_max_voltage);",
      },
      // https://api.vex.com/v5/home/cpp/Drivetrain/index.html
      "vexcode-cpp": {
        forward: "Drivetrain.turnToHeading(@bearing, degrees);\nDrivetrain.driveFor((@fwd ? forward : reverse), @dist, inches);",
        rotate: "Drivetrain.turnToHeading(@th, degrees);",
        swing: "",
        boomerang: "",
      },
      // https://api.vex.com/v5/home/python/Drivetrain.html
      "vexcode-python": {
        forward: "drivetrain.turn_to_heading(@bearing, DEGREES)\ndrivetrain.drive_for(FORWARD if @fwd else REVERSE, @dist, INCHES)",
        rotate: "drivetrain.turn_to_heading(@th, DEGREES)",
        swing: "",
        boomerang: "",
      },
      custom: { forward: "", rotate: "", swing: "", boomerang: "" },
    },
    swingDriveSides: {
      lemlib: { left: "lemlib::DriveSide::LEFT", right: "lemlib::DriveSide::RIGHT" },
      "ez-template": { left: "ez::RIGHT_SWING", right: "ez::LEFT_SWING" },
      "jar-template": { left: "right_swing_to_angle", right: "left_swing_to_angle" },
      "vexcode-cpp": { left: "left", right: "right" },
      "vexcode-python": { left: "left", right: "right" },
      custom: { left: "left", right: "right" },
    },
  };
  for (const { id } of PLANNING_TEMPLATE_LIBRARIES) {
    if (id === "custom") continue;
    Object.freeze(configuration.templates[id]);
    Object.freeze(configuration.swingDriveSides[id]);
  }
  return configuration;
}

export function normalizePlanningTemplateConfiguration(value: unknown): PlanningTemplateConfiguration {
  const result = createPlanningTemplateConfiguration();
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (isPlanningTemplateLibrary(source.library)) result.library = source.library;
  if (source.customLanguage === "python") result.customLanguage = "python";
  const banks = source.templates && typeof source.templates === "object"
    ? source.templates as Record<string, unknown> : {};
  const sides = source.swingDriveSides && typeof source.swingDriveSides === "object"
    ? source.swingDriveSides as Record<string, unknown> : {};
  result.templates.custom = normalizeMotionTemplates(banks.custom, result.templates.custom);
  result.swingDriveSides.custom = normalizeSwingDriveSides(sides.custom, result.swingDriveSides.custom);
  if (result.library !== "custom") {
    // Preserve edits saved by the earlier development build as Custom, without
    // allowing persisted text to replace the built-in preset itself.
    const saved = normalizeMotionTemplates(banks[result.library], result.templates[result.library]);
    // Upgrade our exact former fixed-left presets; custom code remains opaque.
    const previousSwing: Partial<Record<PlanningTemplateLibrary, string>> = {
      lemlib: "chassis.swingToHeading(@th, lemlib::DriveSide::LEFT, 2000, {.maxSpeed = @spd}, false);",
      "ez-template": "chassis.pid_swing_set(ez::RIGHT_SWING, @th, @spd, ez::shortest);\nchassis.pid_wait();",
      "jar-template": "chassis.right_swing_to_angle(@th);",
    };
    if (!source.swingDriveSides && saved.swing === previousSwing[result.library])
      saved.swing = result.templates[result.library].swing;
    // Upgrade the distance-only VEXcode defaults saved before alignment was added.
    const previousForward: Partial<Record<PlanningTemplateLibrary, readonly string[]>> = {
      "vexcode-cpp": [
        "Drivetrain.driveFor((@fwd ? forward : reverse), @dist, inches);",
        "Drivetrain.driveFor((@fwd ? forward : backward), @dist, inches);",
      ],
      "vexcode-python": ["drivetrain.drive_for(FORWARD if @fwd else REVERSE, @dist, INCHES)"],
    };
    if (previousForward[result.library]?.includes(saved.forward))
      saved.forward = result.templates[result.library].forward;
    const savedSides = normalizeSwingDriveSides(sides[result.library], result.swingDriveSides[result.library]);
    if (JSON.stringify(saved) !== JSON.stringify(result.templates[result.library]) ||
        JSON.stringify(savedSides) !== JSON.stringify(result.swingDriveSides[result.library])) {
      result.templates.custom = saved;
      result.swingDriveSides.custom = savedSides;
      result.customLanguage = planningTemplateLanguage(result);
      result.library = "custom";
    }
  }
  return result;
}

/** Editing a preset derives the complete set into Custom before changing code. */
export function editPlanningMotionTemplate(
  configuration: PlanningTemplateConfiguration,
  type: PlanWaypointIndicatorIcon,
  code: string,
): void {
  const templates = configuration.templates[configuration.library];
  if (templates[type] === code) return;
  deriveCustomTemplates(configuration);
  configuration.templates.custom[type] = code;
}

export function editPlanningSwingDriveSide(
  configuration: PlanningTemplateConfiguration,
  side: keyof PlanningSwingDriveSides,
  code: string,
): void {
  if (configuration.swingDriveSides[configuration.library][side] === code) return;
  deriveCustomTemplates(configuration);
  configuration.swingDriveSides.custom[side] = code;
}

function deriveCustomTemplates(configuration: PlanningTemplateConfiguration): void {
  if (configuration.library !== "custom") {
    configuration.templates.custom = { ...configuration.templates[configuration.library] };
    configuration.swingDriveSides.custom = { ...configuration.swingDriveSides[configuration.library] };
    configuration.customLanguage = planningTemplateLanguage(configuration);
    configuration.library = "custom";
  }
}

export function planningTemplateLanguage(configuration: Readonly<PlanningTemplateConfiguration>): PlanningTemplateLanguage {
  return configuration.library === "custom" ? configuration.customLanguage
    : configuration.library === "vexcode-python" ? "python" : "cpp";
}

function normalizeSwingDriveSides(value: unknown, fallback: PlanningSwingDriveSides): PlanningSwingDriveSides {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    left: typeof source.left === "string" ? source.left : fallback.left,
    right: typeof source.right === "string" ? source.right : fallback.right,
  };
}

/** Earlier documents' templates belong to Custom; absent source starts blank. */
export function loadPlanningTemplateConfiguration(
  data: Readonly<Record<string, unknown>>,
  fallbackTemplate: string,
): PlanningTemplateConfiguration {
  if (data["planned-template-configuration"] !== undefined)
    return normalizePlanningTemplateConfiguration(data["planned-template-configuration"]);
  const result = createPlanningTemplateConfiguration();
  const legacyTemplate = typeof data["planned-export-template"] === "string"
    ? data["planned-export-template"] : fallbackTemplate;
  if (data["planned-motion-templates"] !== undefined || legacyTemplate) {
    result.templates.custom = normalizeMotionTemplates(
      data["planned-motion-templates"], createDefaultMotionTemplates(legacyTemplate), true);
  }
  return result;
}

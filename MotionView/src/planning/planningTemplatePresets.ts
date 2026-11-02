import type { PlanMotionTemplates, PlanWaypointIndicatorIcon } from "../state/models";
import { createDefaultMotionTemplates, normalizeMotionTemplates } from "./planningMotions";

export const PLANNING_TEMPLATE_LIBRARIES = [
  { id: "lemlib", name: "LemLib" },
  { id: "ez-template", name: "EZ-Template" },
  { id: "jar-template", name: "JAR-Template" },
  { id: "custom", name: "Custom" },
] as const;

export type PlanningTemplateLibrary = typeof PLANNING_TEMPLATE_LIBRARIES[number]["id"];

/** Fixed library presets and one editable Custom bank, shared across paths. */
export interface PlanningTemplateConfiguration {
  library: PlanningTemplateLibrary;
  templates: Record<PlanningTemplateLibrary, PlanMotionTemplates>;
}

export function isPlanningTemplateLibrary(value: unknown): value is PlanningTemplateLibrary {
  return PLANNING_TEMPLATE_LIBRARIES.some(library => library.id === value);
}

export function createPlanningTemplateConfiguration(): PlanningTemplateConfiguration {
  const configuration: PlanningTemplateConfiguration = {
    library: "custom",
    templates: {
      // Use blocking LemLib calls and explicit EZ waits so ordered motions and
      // timeline nodes do not overtake a movement still running on the robot.
      // https://github.com/LemLib/LemLib/blob/stable/include/lemlib/chassis/chassis.hpp
      lemlib: {
        forward: "chassis.moveToPoint(@x, @y, 4000, {.forwards = @fwd, .maxSpeed = @spd}, false);",
        rotate: "chassis.turnToHeading(@th, 2000, {.maxSpeed = @spd}, false);",
        swing: "chassis.swingToHeading(@th, lemlib::DriveSide::LEFT, 2000, {.maxSpeed = @spd}, false);",
        boomerang: "chassis.moveToPose(@x, @y, @th, 4000, {.forwards = @fwd, .lead = @ld, .maxSpeed = @spd}, false);",
      },
      // https://github.com/EZ-Robotics/EZ-Template/blob/main/include/EZ-Template/drive/drive.hpp
      "ez-template": {
        forward: "chassis.pid_odom_set(ez::odom{{@x, @y}, @fwd ? ez::fwd : ez::rev, @spd});\nchassis.pid_wait();",
        rotate: "chassis.pid_turn_set(@th, @spd, ez::shortest);\nchassis.pid_wait();",
        swing: "chassis.pid_swing_set(ez::RIGHT_SWING, @th, @spd, ez::shortest);\nchassis.pid_wait();",
        boomerang: "chassis.odom_boomerang_dlead_set(@ld);\nchassis.pid_odom_set(ez::odom{{@x, @y, @th}, @fwd ? ez::fwd : ez::rev, @spd});\nchassis.pid_wait();",
      },
      // JAR uses volts rather than PROS power, and chooses travel direction itself.
      // A right swing moves the right side, matching the default locked left side.
      // https://github.com/JacksonAreaRobotics/JAR-Template/blob/main/include/JAR-Template/drive.h
      "jar-template": {
        forward: "chassis.drive_to_point(@x, @y, chassis.drive_min_voltage, @spd * 12.0 / 127.0, chassis.heading_max_voltage);",
        rotate: "chassis.turn_to_angle(@th, @spd * 12.0 / 127.0);",
        swing: "chassis.right_swing_to_angle(@th);",
        boomerang: "chassis.drive_to_pose(@x, @y, @th, @ld, chassis.boomerang_setback, chassis.drive_min_voltage, @spd * 12.0 / 127.0, chassis.heading_max_voltage);",
      },
      custom: { forward: "", rotate: "", swing: "", boomerang: "" },
    },
  };
  for (const { id } of PLANNING_TEMPLATE_LIBRARIES)
    if (id !== "custom") Object.freeze(configuration.templates[id]);
  return configuration;
}

export function normalizePlanningTemplateConfiguration(value: unknown): PlanningTemplateConfiguration {
  const result = createPlanningTemplateConfiguration();
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (isPlanningTemplateLibrary(source.library)) result.library = source.library;
  const banks = source.templates && typeof source.templates === "object"
    ? source.templates as Record<string, unknown> : {};
  result.templates.custom = normalizeMotionTemplates(banks.custom, result.templates.custom);
  if (result.library !== "custom") {
    // Preserve edits saved by the earlier development build as Custom, without
    // allowing persisted text to replace the built-in preset itself.
    const saved = normalizeMotionTemplates(banks[result.library], result.templates[result.library]);
    if (JSON.stringify(saved) !== JSON.stringify(result.templates[result.library])) {
      result.templates.custom = saved;
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
  if (configuration.library !== "custom") {
    configuration.templates.custom = { ...templates };
    configuration.library = "custom";
  }
  configuration.templates.custom[type] = code;
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

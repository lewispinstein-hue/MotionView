export type FieldCompetition = "all" | "vU" | "v5" | "iq";

export interface FieldOption {
  key: string;
  label: string;
  comp?: Exclude<FieldCompetition, "all">;
}

export const CURRENT_GAME_YEAR = "2026-2027";

export const FIELD_IMAGES: readonly FieldOption[] = [
  { key: "./assets/fields/v5/match_field_2026-2027_override.png", label: "Match Field (V5 Override)", comp: "v5" },
  { key: "./assets/fields/v5/skills_field_2026-2027_override.png", label: "Skills Field (V5 Override)", comp: "v5" },
  { key: "./assets/fields/IQ/head-to-head_field_2026-2027_level_up.png", label: "Head-to-Head Field (IQ Level Up)", comp: "iq" },
  { key: "./assets/fields/IQ/skills_field_2026-2027_level_up.png", label: "Skills Field (IQ Level Up)", comp: "iq" },
  { key: "./assets/fields/vU/match_field_2026-2027_override.png", label: "Match Field (VU Override)", comp: "vU" },
  { key: "./assets/fields/vU/skills_field_2026-2027_override.png", label: "Skills Field (VU Override)", comp: "vU" },
  { key: "./assets/fields/v5/match_field_2025-2026_pushback.png", label: "Match Field (V5 Pushback)", comp: "v5" },
  { key: "./assets/fields/v5/skills_field_2025-2026_pushback.png", label: "Skills Field (V5 Pushback)", comp: "v5" },
  { key: "./assets/fields/vU/field_2025-2026_pushback.png", label: "VexU Field (VU Pushback)", comp: "vU" },
  { key: "./assets/fields/v5/field_perimeter.png", label: "Field Perimeter" },
];

export const DEFAULT_FIELD_KEY = FIELD_IMAGES[0].key;

export function normalizeFieldCompetition(value: unknown): FieldCompetition {
  return value === "vU" || value === "v5" || value === "iq" ? value : "all";
}

export function isFieldCurrentYear(field: FieldOption): boolean {
  return String(field.key || "").includes(CURRENT_GAME_YEAR);
}

export function getVisibleFieldImages(options: {
  competition: FieldCompetition;
  showPreviousYearFields: boolean;
}): readonly FieldOption[] {
  return FIELD_IMAGES.filter((field) => {
    if (options.competition !== "all" && field.comp !== options.competition) return false;
    if (options.showPreviousYearFields) return true;
    return isFieldCurrentYear(field) || field.label.includes("Field Perimeter");
  });
}

export function getValidFieldKey(
  fieldKey: unknown,
  options: {
    competition: FieldCompetition;
    showPreviousYearFields: boolean;
  },
): string {
  const visibleFields = getVisibleFieldImages(options);
  if (!visibleFields.length) return "";
  const key = String(fieldKey ?? "");
  if (visibleFields.some((field) => field.key === key)) return key;
  return visibleFields[0]?.key || DEFAULT_FIELD_KEY;
}

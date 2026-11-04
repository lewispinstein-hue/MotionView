import type { PlanWaypointIndicatorIcon } from "../state/models";
import rotateIconSvg from "../assets/svg/planning/waypointRotate.svg?raw";
import swingIconSvg from "../assets/svg/planning/waypointSwing.svg?raw";
import forwardIconSvg from "../assets/svg/planning/waypointForward.svg?raw";
import boomerangIconSvg from "../assets/svg/planning/waypointBoomerang.svg?raw";

export const WAYPOINT_INDICATOR_ICONS = [
  "rotate",
  "swing",
  "forward",
  "boomerang",
] as const satisfies readonly PlanWaypointIndicatorIcon[];

const ICON_SVGS: Record<PlanWaypointIndicatorIcon, string> = {
  rotate: rotateIconSvg,
  swing: swingIconSvg,
  forward: forwardIconSvg,
  boomerang: boomerangIconSvg,
};

const ICON_TOOLTIPS: Record<PlanWaypointIndicatorIcon, string> = {
  rotate: "turnToHeading • Rotational Motion",
  swing: "swingToHeading • Swing Motion",
  forward: "moveToPoint • Linear Motion",
  boomerang: "moveToPose • Boomerang Motion",
};

export function getWaypointIndicatorTooltip(
  icon: PlanWaypointIndicatorIcon,
): string {
  return ICON_TOOLTIPS[icon];
}

export function isWaypointIndicatorIcon(
  value: unknown,
): value is PlanWaypointIndicatorIcon {
  return (
    typeof value === "string" &&
    WAYPOINT_INDICATOR_ICONS.includes(value as PlanWaypointIndicatorIcon)
  );
}

export function normalizeWaypointIndicatorIcons(
  value: unknown,
): PlanWaypointIndicatorIcon[] {
  if (!Array.isArray(value)) return [];
  const icons: PlanWaypointIndicatorIcon[] = [];
  for (const candidate of value) {
    if (!isWaypointIndicatorIcon(candidate) || icons.includes(candidate))
      continue;
    icons.push(candidate);
    if (icons.length === 2) break;
  }
  return icons;
}

/** Returns a stable visual order without changing the stored selection order. */
export function orderWaypointIndicatorIcons(
  value: readonly PlanWaypointIndicatorIcon[],
): PlanWaypointIndicatorIcon[] {
  const icons = normalizeWaypointIndicatorIcons(value);
  return icons.sort(
    (left, right) =>
      WAYPOINT_INDICATOR_ICONS.indexOf(left) -
      WAYPOINT_INDICATOR_ICONS.indexOf(right),
  );
}

export function createWaypointIndicatorIcon(
  icon: PlanWaypointIndicatorIcon,
  className = "",
): SVGSVGElement {
  // Embed the bundled SVG itself. Production URL imports can become data URLs,
  // which WebViews may reject when referenced by an SVG <use> element.
  const template = document.createElement("template");
  template.innerHTML = ICON_SVGS[icon];
  const svg = template.content.querySelector("svg")!;
  svg.removeAttribute("id");
  svg.classList.add("waypointIndicatorIcon");
  if (className) svg.classList.add(className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("title", getWaypointIndicatorTooltip(icon));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}

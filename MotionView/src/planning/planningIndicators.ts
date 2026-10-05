import type { PlanWaypointIndicatorIcon } from "../state/models";
import rotateIconUrl from "../assets/svg/planning/waypointRotate.svg?url";
import swingIconUrl from "../assets/svg/planning/waypointSwing.svg?url";
import forwardIconUrl from "../assets/svg/planning/waypointForward.svg?url";
import boomerangIconUrl from "../assets/svg/planning/waypointBoomerang.svg?url";

export const WAYPOINT_INDICATOR_ICONS = ["rotate", "swing", "forward", "boomerang"] as const satisfies readonly PlanWaypointIndicatorIcon[];

const ICON_HREFS: Record<PlanWaypointIndicatorIcon, string> = {
  rotate: `${rotateIconUrl}#icon-waypointRotate`,
  swing: `${swingIconUrl}#icon-waypointSwing`,
  forward: `${forwardIconUrl}#icon-waypointForward`,
  boomerang: `${boomerangIconUrl}#icon-waypointBoomerang`,
};

export function isWaypointIndicatorIcon(value: unknown): value is PlanWaypointIndicatorIcon {
  return typeof value === "string" && WAYPOINT_INDICATOR_ICONS.includes(value as PlanWaypointIndicatorIcon);
}

export function normalizeWaypointIndicatorIcons(value: unknown): PlanWaypointIndicatorIcon[] {
  if (!Array.isArray(value)) return [];
  const icons: PlanWaypointIndicatorIcon[] = [];
  for (const candidate of value) {
    if (!isWaypointIndicatorIcon(candidate) || icons.includes(candidate)) continue;
    icons.push(candidate);
    if (icons.length === 2) break;
  }
  return icons;
}

export function createWaypointIndicatorIcon(icon: PlanWaypointIndicatorIcon, className = ""): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("waypointIndicatorIcon");
  if (className) svg.classList.add(className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", ICON_HREFS[icon]);
  svg.appendChild(use);
  return svg;
}

import type { FieldPose } from "../../render/field";
import type { WatchMarker } from "../viewingTypes";
import { formatNumber } from "../viewingPresentation";
import type { WatchTooltipRow } from "./WatchTooltipView";

export function watchTooltipRows(
  marker: Readonly<WatchMarker>,
  pose: Readonly<FieldPose> | null,
): readonly WatchTooltipRow[] {
  return [
    ["Time", `${formatNumber(marker.t / 1000, 2)}s`],
    ["Pose", pose
      ? `X: ${formatNumber(pose.x, 1)} Y: ${formatNumber(pose.y, 1)} θ: ${formatNumber(pose.theta, 1)}°`
      : "—"],
    ["Name", marker.watch.label || "—"],
    ["Value", marker.watch.value == null ? "—" : String(marker.watch.value)],
  ];
}

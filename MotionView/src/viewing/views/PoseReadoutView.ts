import type { ViewingDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import { formatNumber } from "../viewingPresentation";
import type { FloatingInfoView } from "./FloatingInfoView";

export class PoseReadoutView {
  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingDom,
    private readonly floatingInfo: FloatingInfoView,
  ) {}

  render(): void {
    const pose = this.viewing.playback.currentDisplayPose();
    const index = this.viewing.playback.currentDisplayIndex();
    const deltaMs = this.viewing.playback.currentDisplayDeltaMs();
    if (!pose) {
      this.dom.timePill.textContent = "Time: —";
      this.dom.deltaPill.textContent = "Δ: —";
      this.dom.pointPill.textContent = "Point: —/—";
      this.dom.posePill.textContent = "X: — Y: — θ: — Speed: —";
      this.floatingInfo.update();
      return;
    }
    this.dom.timePill.textContent = `Time: ${pose.t == null ? "—" : `${formatNumber(pose.t / 1000, 2)}s`}`;
    this.dom.deltaPill.textContent = `Δ: ${deltaMs == null ? "—" : `${formatNumber(deltaMs / 1000, 3)}s`}`;
    this.dom.pointPill.textContent = `Point: ${index + 1}/${this.viewing.data.poses.length}`;
    this.dom.posePill.textContent = `X: ${formatNumber(pose.x, 1)} Y: ${formatNumber(pose.y, 1)} θ: ${formatNumber(pose.theta, 1)}° Speed: ${formatNumber(pose.speed_raw, 1)}`;
    this.floatingInfo.update();
  }
}

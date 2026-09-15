import type { ViewingReadoutDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import { formatNumber } from "../viewingPresentation";
import type { FloatingInfoView } from "./FloatingInfoView";

export class PoseReadoutView {
  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingReadoutDom,
    private readonly floatingInfo: FloatingInfoView,
  ) {}

  render(): void {
    const pose = this.viewing.projection.displayPose(this.viewing.playback.currentDisplayPose());
    const index = this.viewing.playback.currentDisplayIndex();
    const deltaMs = this.viewing.playback.currentDisplayDeltaMs();
    if (!pose) {
      this.dom.time.textContent = "Time: —";
      this.dom.delta.textContent = "Δ: —";
      this.dom.point.textContent = "Point: —/—";
      this.dom.pose.textContent = "X: — Y: — θ: — Speed: —";
      this.floatingInfo.update();
      return;
    }
    this.dom.time.textContent = `Time: ${pose.t == null ? "—" : `${formatNumber(pose.t / 1000, 2)}s`}`;
    this.dom.delta.textContent = `Δ: ${deltaMs == null ? "—" : `${formatNumber(deltaMs / 1000, 3)}s`}`;
    this.dom.point.textContent = `Point: ${index + 1}/${this.viewing.data.poses.length}`;
    this.dom.pose.textContent = `X: ${formatNumber(pose.x, 1)} Y: ${formatNumber(pose.y, 1)} θ: ${formatNumber(pose.theta, 1)}° Speed: ${formatNumber(pose.speed_raw, 1)}`;
    this.floatingInfo.update();
  }
}

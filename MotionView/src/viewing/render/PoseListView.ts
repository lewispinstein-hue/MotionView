import type { Pose } from "../../state/models";
import type { ViewingFeature } from "../ViewingFeature";
import type { ViewingListsDom } from "../ViewingDom";
import { createVirtualList, type VirtualList } from "./virtualList";
import { escapeHtml, formatNumber } from "../viewingPresentation";
import { getCurrentUnits } from "../../shared/units";

export class PoseListView {
  readonly #list: VirtualList<Readonly<Pose>>;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingListsDom,
  ) {
    const list = createVirtualList<Readonly<Pose>>(dom.poseList, {
      estimateRowHeight: 64,
      overscanPx: 320,
      getKey: (_pose, index) => String(index),
      renderItem: (_pose, index) => this.createItem(index),
    });
    if (!list) throw new Error("MotionView could not initialize the pose virtual list.");
    this.#list = list;
  }

  render(): void {
    const count = this.viewing.data.poses.length;
    this.dom.poseCount.textContent = count ? String(count) : "—";
    this.#list.setItems(this.viewing.data.poses as ArrayLike<Readonly<Pose>>);
  }

  highlight(scroll = false): void {
    if (scroll) this.#list.scrollToIndex(this.viewing.navigation.selectedIndex, 12);
    this.#list.refresh();
  }

  private createItem(index: number): HTMLElement {
    const rawPose = this.viewing.data.poses[index];
    const pose = this.viewing.projection.displayPose(this.viewing.projection.poseAt(index));
    const time = typeof rawPose?.t === "number" ? Math.round(rawPose.t) : null;
    const summary = pose
      ? `X: ${formatNumber(pose.x, 1, "0")}${getCurrentUnits()}, Y: ${formatNumber(pose.y, 1, "0")}${getCurrentUnits()}, θ: ${formatNumber(pose.theta, 1, "0")}°`
      : "—";
    const element = document.createElement("div");
    element.className = "poseItem";
    if (index === this.viewing.navigation.selectedIndex) element.classList.add("selected");
    element.dataset.idx = String(index);
    element.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px">
      <div style="font-weight:800">#${index + 1}</div>
      <div class="muted">${time != null ? formatNumber(time / 1000) : "—"}s</div>
    </div><div class="sub">${escapeHtml(summary)}</div>`;
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.viewing.playback.pause();
      this.viewing.navigation.selectPose(index);
    }, { passive: false });
    return element;
  }
}

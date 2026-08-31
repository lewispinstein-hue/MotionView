import type { Pose } from "../../state/models";
import type { ViewingFeature } from "../ViewingFeature";
import type { ViewingListsDom } from "../ViewingDom";
import { createVirtualList, type VirtualList } from "./virtualList";
import { escapeHtml, formatNumber } from "../viewingPresentation";
import { getCurrentUnits } from "../../shared/units";

interface PoseListItem {
  readonly pose: Readonly<Pose>;
  readonly index: number;
}

export class PoseListView {
  readonly #list: VirtualList<PoseListItem>;
  #itemCount = 0;
  #previewIndex: number | null = null;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingListsDom,
  ) {
    const list = createVirtualList<PoseListItem>(dom.poseList, {
      estimateRowHeight: 64,
      overscanPx: 320,
      scrollContainer: dom.scrollContainer,
      getKey: (item) => String(item.index),
      renderItem: (item) => this.createItem(item.index),
    });
    if (!list) throw new Error("MotionView could not initialize the pose virtual list.");
    this.#list = list;
  }

  get itemCount(): number { return this.#itemCount; }

  bind(): void {
    this.dom.poseSort.addEventListener("change", () => this.render());
  }

  render(): void {
    const items: PoseListItem[] = [];
    for (let index = 0; index < this.viewing.data.poses.length; index += 1) {
      const pose = this.viewing.data.poses[index];
      if (pose) items.push({ pose, index });
    }
    if (this.dom.poseSort.value === "-time") items.reverse();
    this.#itemCount = items.length;
    this.#list.setItems(items);
  }

  highlight(scroll = false): void {
    if (scroll) {
      const selected = this.viewing.navigation.selectedIndex;
      const index = Array.from(this.#list.getItems()).findIndex((item) => item.index === selected);
      if (index >= 0) this.#list.scrollToIndex(index, 12);
    }
    this.#list.refresh();
  }

  setPreviewTime(time: number): void {
    const items = this.#list.getItems();
    let nearestIndex = -1;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const timestamp = item?.pose.t;
      if (typeof timestamp !== "number") continue;
      const delta = Math.abs(timestamp - time);
      if (delta < nearestDelta) {
        nearestIndex = index;
        nearestDelta = delta;
      }
    }
    this.#previewIndex = nearestIndex >= 0 ? items[nearestIndex]!.index : null;
    if (nearestIndex >= 0) this.#list.scrollToIndex(nearestIndex, 12, "center");
    this.#list.refresh();
  }

  clearPreview(): void {
    if (this.#previewIndex == null) return;
    this.#previewIndex = null;
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
    if (index === this.#previewIndex) element.classList.add("previewSelected");
    element.dataset.idx = String(index);
    element.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px">
      <div style="font-weight:800">#${index + 1}</div>
      <div class="muted">${time != null ? formatNumber(time / 1000) : "—"}s</div>
    </div><div class="sub">${escapeHtml(summary)}</div>`;
    if (time != null) {
      element.addEventListener("pointerenter", () => {
        if (!this.viewing.playback.isPlaying) this.viewing.navigation.setTimelineHover(time);
      });
      element.addEventListener("pointerleave", () => {
        if (this.viewing.navigation.hoverTimelineTime === time) this.viewing.navigation.setTimelineHover(null);
      });
    }
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.viewing.playback.pause();
      this.viewing.navigation.setTimelineHover(null);
      this.viewing.navigation.selectPose(index);
    }, { passive: false });
    return element;
  }
}

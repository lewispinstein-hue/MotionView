import { requestDrawAll } from "../../render/renderScheduler";
import type { ViewingDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import type { WatchMarker } from "../viewingTypes";
import { heatColorFromNorm, levelFillWithAlpha } from "../viewingPresentation";
import type { WatchListView } from "./WatchListView";
import type { WatchTooltipView } from "./WatchTooltipView";

export class TimelineView {
  readonly #context: CanvasRenderingContext2D;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly dom: ViewingDom,
    private readonly watchList: WatchListView,
    private readonly watchTooltip: WatchTooltipView,
  ) {
    const context = dom.timelineCanvas.getContext("2d");
    if (!context) throw new Error("MotionView could not initialize the Viewing timeline canvas.");
    this.#context = context;
  }

  bind(): void {
    this.dom.timelineCanvas.addEventListener("mousemove", (event) => {
      if (!this.viewing.data.hasData || this.viewing.playback.isPlaying) return;
      const rect = this.dom.timelineCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const hit = this.pickWatch(x, event.clientY - rect.top);
      this.dom.timelineCanvas.style.cursor = hit ? "pointer" : "crosshair";
      this.viewing.navigation.setTimelineHover(this.xToTime(x));
    });
    this.dom.timelineCanvas.addEventListener("mouseleave", () => {
      this.viewing.navigation.setTimelineHover(null);
      this.dom.timelineCanvas.style.cursor = "default";
    });
    this.dom.timelineCanvas.addEventListener("mousedown", (event) => {
      if (!this.viewing.data.hasData || this.viewing.playback.isPlaying || this.viewing.navigation.livestreaming) return;
      const rect = this.dom.timelineCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const marker = this.pickWatch(x, event.clientY - rect.top);
      this.viewing.navigation.clearTrackLock();
      this.viewing.navigation.setTrackHover(null);
      if (marker) {
        this.viewing.playback.pause();
        this.viewing.navigation.setTimelineHover(null);
        const index = marker.idx ?? this.viewing.projection.findFloorIndex(marker.t);
        const pose = this.viewing.projection.interpolatePose(marker.t) ?? marker.pose;
        if (index >= 0 && pose) this.viewing.navigation.lockTrack(pose, index);
        this.viewing.navigation.selectWatch(marker);
        this.watchTooltip.show(marker, { x: event.clientX, y: event.clientY });
      } else {
        this.watchTooltip.hide();
        const time = this.xToTime(x);
        this.viewing.playback.pause();
        this.viewing.playback.setTime(time);
      }
      requestDrawAll();
    });
  }

  resize(): void {
    if (this.dom.timelineBar.classList.contains("isCollapsed")) return;
    const barHeight = this.dom.timelineBar.getBoundingClientRect().height;
    const topHeight = this.dom.timelineTop?.getBoundingClientRect().height ?? 0;
    this.dom.timelineCanvas.style.height = `${Math.max(144, barHeight - topHeight - 20)}px`;
    const ratio = window.devicePixelRatio || 1;
    const rect = this.dom.timelineCanvas.getBoundingClientRect();
    this.dom.timelineCanvas.width = Math.max(1, Math.floor(rect.width * ratio));
    this.dom.timelineCanvas.height = Math.max(1, Math.floor(rect.height * ratio));
    this.#context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.draw();
  }

  draw(): void {
    const context = this.#context;
    const rect = this.dom.timelineCanvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    context.clearRect(0, 0, width, height);
    const poses = this.viewing.data.poses;
    const range = this.viewing.projection.timeRange();
    if (!range || poses.length < 2) return;
    context.strokeStyle = "rgba(255,255,255,.08)";
    context.lineWidth = 1;
    for (let index = 0; index <= 10; index += 1) {
      const x = width * index / 10;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    context.lineWidth = 2;
    for (let index = 1; index < poses.length; index += 1) {
      const previous = poses[index - 1];
      const pose = poses[index];
      if (!previous || !pose || previous.t == null || pose.t == null) continue;
      const x0 = this.timeToX(previous.t);
      const x1 = this.timeToX(pose.t);
      const y0 = height - 6 - previous.speed_norm * (height - 12);
      const y1 = height - 6 - pose.speed_norm * (height - 12);
      const gradient = context.createLinearGradient(x0, y0, x1, y1);
      gradient.addColorStop(0, heatColorFromNorm(previous.speed_norm));
      gradient.addColorStop(1, heatColorFromNorm(pose.speed_norm));
      context.strokeStyle = gradient;
      context.beginPath();
      context.moveTo(x0, y0);
      context.lineTo(x1, y1);
      context.stroke();
    }
    for (const marker of this.viewing.projection.watchMarkers) {
      if (!this.watchList.isVisible(marker)) continue;
      const x = this.timeToX(marker.t);
      context.save();
      context.fillStyle = levelFillWithAlpha(marker.watch.level, 0.85);
      context.strokeStyle = "rgba(255,255,255,.95)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, 10, 4.2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.restore();
    }
    const selectedWatch = this.viewing.navigation.selectedWatch;
    if (selectedWatch && this.watchList.isVisible(selectedWatch)) {
      context.save();
      context.strokeStyle = "rgba(255,255,255,.95)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(this.timeToX(selectedWatch.t), 10, 9, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
    const currentTime = this.viewing.playback.isPlaying
      ? this.viewing.playback.timeMs
      : this.viewing.navigation.trackLockPose?.t ?? poses[this.viewing.navigation.selectedIndex]?.t;
    if (currentTime != null) {
      const x = this.timeToX(currentTime);
      context.strokeStyle = "rgba(255,255,255,.9)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    const hoverTime = this.viewing.navigation.hoverTimelineTime
      ?? this.viewing.navigation.trackHoverTime;
    if (!this.viewing.playback.isPlaying && hoverTime != null && hoverTime !== currentTime) {
      const x = this.timeToX(hoverTime);
      context.strokeStyle = "rgba(210,218,228,.42)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }

  timeToX(time: number): number {
    const range = this.viewing.projection.timeRange();
    const width = this.dom.timelineCanvas.getBoundingClientRect().width;
    return range ? ((time - range.start) / (range.end - range.start)) * width : 0;
  }

  xToTime(x: number): number {
    const range = this.viewing.projection.timeRange();
    const width = this.dom.timelineCanvas.getBoundingClientRect().width || 1;
    return range ? range.start + Math.max(0, Math.min(1, x / width)) * (range.end - range.start) : 0;
  }

  private pickWatch(x: number, y: number): Readonly<WatchMarker> | null {
    if (Math.abs(y - 10) > 12) return null;
    let best: Readonly<WatchMarker> | null = null;
    let bestDelta = 9;
    for (const marker of this.viewing.projection.watchMarkers) {
      if (!this.watchList.isVisible(marker)) continue;
      const delta = Math.abs(this.timeToX(marker.t) - x);
      if (delta < bestDelta) {
        best = marker;
        bestDelta = delta;
      }
    }
    return best;
  }
}

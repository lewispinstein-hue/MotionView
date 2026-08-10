import type { FieldPose, FieldRenderer, ViewingFieldLayer } from "../render/createFieldRenderer";
import type { ViewingRenderLayer } from "../render/renderScheduler";
import { requestDrawAll } from "../render/renderScheduler";
import type { ViewingDom } from "./ViewingDom";
import type { ViewingFeature } from "./ViewingFeature";
import type { ViewingDataChangedEvent } from "./viewingTypes";
import { FieldOverlayView } from "./views/FieldOverlayView";
import { FloatingInfoView } from "./views/FloatingInfoView";
import { PoseReadoutView } from "./views/PoseReadoutView";
import { TimelineView } from "./views/TimelineView";
import { WatchGraphView } from "./views/WatchGraphView";
import { ViewingListsView } from "./views/ViewingListsView";
import { WatchTooltipView } from "./views/WatchTooltipView";

/** Owns Viewing DOM and canvas presentation. It only reads feature state. */
export class ViewingView implements ViewingFieldLayer, ViewingRenderLayer {
  readonly #lists: ViewingListsView;
  readonly #watchGraph: WatchGraphView;
  readonly #floatingInfo: FloatingInfoView;
  readonly #readout: PoseReadoutView;
  readonly #fieldOverlay: FieldOverlayView;
  readonly #timeline: TimelineView;
  readonly #watchTooltip: WatchTooltipView;
  #bound = false;

  constructor(
    readonly viewing: ViewingFeature,
    readonly field: FieldRenderer,
    readonly dom: ViewingDom,
  ) {
    this.#lists = new ViewingListsView(viewing, dom);
    this.#watchGraph = new WatchGraphView(viewing, dom);
    this.#floatingInfo = new FloatingInfoView(viewing, dom);
    this.#readout = new PoseReadoutView(viewing, dom, this.#floatingInfo);
    this.#watchTooltip = new WatchTooltipView(viewing, dom);
    this.#fieldOverlay = new FieldOverlayView(viewing, dom, field, this.#lists.watches, this.#lists.waypoints, this.#watchTooltip);
    this.#timeline = new TimelineView(viewing, dom, this.#lists.watches, this.#watchTooltip);
  }

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.#lists.bind();
    this.#watchGraph.bind();
    this.#floatingInfo.bind();
    this.#watchTooltip.bind();
    this.#fieldOverlay.bind();
    this.#timeline.bind();
    this.dom.watchList.addEventListener("viewing-pin-watch", (event) => {
      const watch = (event as CustomEvent).detail?.watch;
      this.#floatingInfo.toggleWatch(watch?.id ?? null);
    });
    this.dom.watchList.addEventListener("viewing-open-watch-graph", (event) => {
      const marker = (event as CustomEvent).detail?.marker;
      if (marker) this.#watchGraph.open(marker);
    });
    this.viewing.events.dataChanged.subscribe((change) => this.handleDataChanged(change));
    this.viewing.events.navigationChanged.subscribe(() => {
      this.#lists.highlight();
      this.#readout.render();
      this.#watchGraph.updatePlayhead();
      requestDrawAll();
    });
    this.viewing.events.playbackChanged.subscribe(() => {
      this.#readout.render();
      this.#watchGraph.updatePlayhead();
      requestDrawAll();
    });
    this.viewing.events.projectionChanged.subscribe(() => requestDrawAll());
  }

  render(): void {
    this.#lists.render();
    this.#floatingInfo.refreshPinnedPanels();
    this.#readout.render();
  }

  get pathLength(): number {
    return this.viewing.data.poses.length;
  }

  pathPoseAt(index: number): FieldPose | null {
    return this.viewing.projection.poseAt(index);
  }

  currentPose(): FieldPose | null {
    return this.viewing.playback.currentDisplayPose();
  }

  drawOverlay(): void {
    this.#fieldOverlay.draw();
  }

  drawWaypointOffset(pose: FieldPose): void {
    this.#fieldOverlay.drawWaypointOffset(pose);
  }

  drawTimeline(): void {
    this.#timeline.draw();
  }

  resizeTimeline(): void {
    this.#timeline.resize();
  }

  resizeWatchGraph(): void {
    this.#watchGraph.resize();
  }

  toggleFloatingInfo(): void {
    this.#floatingInfo.toggle();
  }

  toggleWatchGraph(): void {
    this.#watchGraph.toggle();
  }

  openFloatingWatch(watchId: number | string | null = null): void {
    this.#floatingInfo.openWatch(watchId);
  }

  clearWaypointSelection(): void {
    this.viewing.navigation.clearDetails();
  }

  private handleDataChanged(change: Readonly<ViewingDataChangedEvent>): void {
    if (change.kind === "replaced" || change.kind === "cleared") {
      this.#watchTooltip.hide();
      this.#watchGraph.hide();
      this.render();
    } else if (change.kind === "appended") {
      if (change.result.watchesAdded) {
        this.#lists.watches.renderFilter();
        this.#lists.watches.render();
        this.#floatingInfo.refreshPinnedPanels();
        this.#watchGraph.render();
      }
      if (change.result.logsAdded) this.#lists.logs.render();
      if (change.result.waypointsAdded) {
        this.#lists.waypoints.renderFilter();
        this.#lists.waypoints.render();
      }
      if (change.result.posesAdded) this.#lists.poses.render();
      this.#readout.render();
    } else if (change.kind === "watch-visibility") {
      this.#lists.watches.render();
    } else if (change.kind === "speed-range") {
      this.#lists.poses.render();
      this.#readout.render();
    }
    requestDrawAll();
  }
}

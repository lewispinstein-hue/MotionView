import type { FieldRenderer } from "../render/field";
import { requestDrawAll } from "../render/renderScheduler";
import type { ViewingDom } from "./ViewingDom";
import type { ViewingFeature } from "./ViewingFeature";
import { FloatingInfoView } from "./render/FloatingInfoView";
import { PoseReadoutView } from "./render/PoseReadoutView";
import { ViewingFieldView } from "./render/ViewingFieldView";
import { ViewingSidebarView } from "./render/ViewingSidebarView";
import { ViewingTimelineView } from "./render/ViewingTimelineView";
import { WatchGraphView } from "./render/WatchGraphView";
import { WatchTooltipView } from "./render/WatchTooltipView";
import type { ViewingDataChangedEvent } from "./viewingTypes";

/** Composes Viewing presentation and translates feature events into focused updates. */
export class ViewingView {
  readonly fieldLayer: ViewingFieldView;
  readonly timelineLayer: ViewingTimelineView;
  readonly #sidebar: ViewingSidebarView;
  readonly #watchGraph: WatchGraphView;
  readonly #floatingInfo: FloatingInfoView;
  readonly #readout: PoseReadoutView;
  readonly #watchTooltip: WatchTooltipView;
  #bound = false;

  constructor(
    readonly viewing: ViewingFeature,
    field: FieldRenderer,
    readonly dom: ViewingDom,
  ) {
    this.#watchGraph = new WatchGraphView(viewing, dom.graph);
    this.#floatingInfo = new FloatingInfoView(viewing, dom.floating);
    this.#sidebar = new ViewingSidebarView(viewing, dom.lists, this.#floatingInfo, this.#watchGraph);
    this.#readout = new PoseReadoutView(viewing, dom.readout, this.#floatingInfo);
    this.#watchTooltip = new WatchTooltipView(dom.tooltip);
    this.fieldLayer = new ViewingFieldView(
      viewing,
      dom.field,
      field,
      this.#sidebar.watches,
      this.#sidebar.waypoints,
      this.#watchTooltip,
    );
    this.timelineLayer = new ViewingTimelineView(
      viewing,
      dom.timeline,
      this.#sidebar.watches,
      this.#watchTooltip,
    );
  }

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.#sidebar.bind();
    this.#watchGraph.bind();
    this.#floatingInfo.bind();
    this.#watchTooltip.bind();
    this.fieldLayer.bind();
    this.timelineLayer.bind();
    this.viewing.events.dataChanged.subscribe((change) => this.handleDataChanged(change));
    this.viewing.events.navigationChanged.subscribe(() => {
      this.#sidebar.highlight();
      this.#readout.render();
      this.#watchGraph.updatePlayhead();
      requestDrawAll();
    });
    this.viewing.events.playbackChanged.subscribe(() => {
      this.#readout.render();
      this.#watchGraph.updatePlayhead();
      requestDrawAll();
    });
    this.viewing.events.projectionChanged.subscribe((change) => {
      if (change.kind === "transform") {
        this.#watchTooltip.hide();
        this.#sidebar.poses.render();
        this.#readout.render();
      }
      requestDrawAll();
    });
  }

  render(): void {
    this.#sidebar.render();
    this.#floatingInfo.refreshPinnedPanels();
    this.#readout.render();
  }

  resize(): void {
    this.timelineLayer.resize();
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
        this.#sidebar.watches.renderFilter();
        this.#sidebar.watches.render();
        this.#floatingInfo.refreshPinnedPanels();
        this.#watchGraph.render();
      }
      if (change.result.logsAdded) this.#sidebar.logs.render();
      if (change.result.waypointsAdded) {
        this.#sidebar.waypoints.renderFilter();
        this.#sidebar.waypoints.render();
      }
      if (change.result.posesAdded) this.#sidebar.poses.render();
      this.#readout.render();
    } else if (change.kind === "watch-visibility") {
      this.#sidebar.watches.render();
    } else if (change.kind === "speed-range") {
      this.#sidebar.poses.render();
      this.#readout.render();
    }
    requestDrawAll();
  }
}

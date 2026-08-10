import type { ViewingDom } from "../ViewingDom";
import type { ViewingFeature } from "../ViewingFeature";
import { LogListView } from "./LogListView";
import { PoseListView } from "./PoseListView";
import { WatchListView } from "./WatchListView";
import { WaypointListView } from "./WaypointListView";

/** Owns the four virtualized Viewing lists and their coordinated updates. */
export class ViewingListsView {
  readonly poses: PoseListView;
  readonly logs: LogListView;
  readonly watches: WatchListView;
  readonly waypoints: WaypointListView;

  constructor(viewing: ViewingFeature, dom: ViewingDom) {
    this.poses = new PoseListView(viewing, dom);
    this.logs = new LogListView(viewing, dom);
    this.watches = new WatchListView(viewing, dom);
    this.waypoints = new WaypointListView(viewing, dom);
  }

  bind(): void {
    this.logs.bind();
    this.watches.bind();
    this.waypoints.bind();
  }

  render(): void {
    this.watches.renderFilter();
    this.waypoints.renderFilter();
    this.watches.render();
    this.logs.render();
    this.waypoints.render();
    this.poses.render();
  }

  highlight(): void {
    this.poses.highlight();
    this.watches.highlight();
    this.logs.highlight();
    this.waypoints.highlight(false);
  }
}

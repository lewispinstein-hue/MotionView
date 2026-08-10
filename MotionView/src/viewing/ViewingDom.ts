function optionalElement<T extends HTMLElement>(document: Document, id: string): T | null {
  return document.getElementById(id) as T | null;
}

function requiredElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = optionalElement<T>(document, id);
  if (!element) throw new Error(`MotionView Viewing UI requires #${id}.`);
  return element;
}

/** Stable typed references to DOM elements owned by Viewing mode. */
export class ViewingDom {
  readonly canvas: HTMLCanvasElement;
  readonly timelineCanvas: HTMLCanvasElement;
  readonly timelineBar: HTMLElement;
  readonly timelineTop: HTMLElement | null;
  readonly watchList: HTMLElement;
  readonly watchFilter: HTMLSelectElement;
  readonly watchSort: HTMLSelectElement;
  readonly watchCount: HTMLElement;
  readonly poseList: HTMLElement;
  readonly poseCount: HTMLElement;
  readonly waypointList: HTMLElement;
  readonly waypointCount: HTMLElement;
  readonly waypointFilter: HTMLSelectElement;
  readonly logList: HTMLElement;
  readonly logCount: HTMLElement;
  readonly logSort: HTMLSelectElement;
  readonly watchPopup: HTMLElement;
  readonly timePill: HTMLElement;
  readonly deltaPill: HTMLElement;
  readonly pointPill: HTMLElement;
  readonly posePill: HTMLElement;
  readonly cursorPill: HTMLElement;
  readonly planCursorPill: HTMLElement;
  readonly floatingInfo: HTMLElement;
  readonly toggleFloatingInfo: HTMLButtonElement;
  readonly closeFloatingInfo: HTMLButtonElement;
  readonly floatingHeader: HTMLElement;
  readonly floatingResizer: HTMLElement;
  readonly pinnedWatchHost: HTMLElement;
  readonly pinnedWatchTemplate: HTMLTemplateElement;
  readonly watchGraphPanel: HTMLElement;
  readonly watchGraphHeader: HTMLElement;
  readonly watchGraphResizer: HTMLElement;
  readonly closeWatchGraph: HTMLButtonElement;
  readonly watchGraphSubtitle: HTMLElement;
  readonly watchGraphTitle: HTMLElement;
  readonly watchGraphCompareSelect: HTMLSelectElement;
  readonly watchGraphLatest: HTMLElement;
  readonly watchGraphCompareLatest: HTMLElement;
  readonly watchGraphCount: HTMLElement;
  readonly watchGraphAverage: HTMLElement;
  readonly watchGraphMinimum: HTMLElement;
  readonly watchGraphMaximum: HTMLElement;
  readonly watchGraphCompareCount: HTMLElement;
  readonly watchGraphCompareAverage: HTMLElement;
  readonly watchGraphCompareMinimum: HTMLElement;
  readonly watchGraphCompareMaximum: HTMLElement;
  readonly watchGraphCanvas: HTMLCanvasElement;
  readonly watchGraphEmpty: HTMLElement;

  private constructor(document: Document) {
    this.canvas = requiredElement(document, "c");
    this.timelineCanvas = requiredElement(document, "timelineCanvas");
    this.timelineBar = requiredElement(document, "timelineBar");
    this.timelineTop = optionalElement(document, "timelineTop");
    this.watchList = requiredElement(document, "watchList");
    this.watchFilter = requiredElement(document, "watchFilter");
    this.watchSort = requiredElement(document, "watchSort");
    this.watchCount = requiredElement(document, "watchCount");
    this.poseList = requiredElement(document, "poseList");
    this.poseCount = requiredElement(document, "poseCount");
    this.waypointList = requiredElement(document, "waypointList");
    this.waypointCount = requiredElement(document, "waypointCount");
    this.waypointFilter = requiredElement(document, "waypointFilter");
    this.logList = requiredElement(document, "logList");
    this.logCount = requiredElement(document, "logCount");
    this.logSort = requiredElement(document, "logSort");
    this.watchPopup = requiredElement(document, "watchPopup");
    this.timePill = requiredElement(document, "timePill");
    this.deltaPill = requiredElement(document, "deltaPill");
    this.pointPill = requiredElement(document, "pointPill");
    this.posePill = requiredElement(document, "posePill");
    this.cursorPill = requiredElement(document, "cursorPill");
    this.planCursorPill = requiredElement(document, "planCursorPill");
    this.floatingInfo = requiredElement(document, "floatingInfo");
    this.toggleFloatingInfo = requiredElement(document, "btnToggleFloat");
    this.closeFloatingInfo = requiredElement(document, "btnCloseFloat");
    this.floatingHeader = requiredElement(document, "floatHeader");
    this.floatingResizer = requiredElement(document, "floatResizer");
    this.pinnedWatchHost = requiredElement(document, "pinnedWatchHost");
    this.pinnedWatchTemplate = requiredElement(document, "pinnedWatchTemplate");
    this.watchGraphPanel = requiredElement(document, "watchGraphPanel");
    this.watchGraphHeader = requiredElement(document, "watchGraphHeader");
    this.watchGraphResizer = requiredElement(document, "watchGraphResizer");
    this.closeWatchGraph = requiredElement(document, "btnCloseWatchGraph");
    this.watchGraphSubtitle = requiredElement(document, "watchGraphSubtitle");
    this.watchGraphTitle = requiredElement(document, "watchGraphTitle");
    this.watchGraphCompareSelect = requiredElement(document, "watchGraphCompareSelect");
    this.watchGraphLatest = requiredElement(document, "watchGraphLatest");
    this.watchGraphCompareLatest = requiredElement(document, "watchGraphCompareLatest");
    this.watchGraphCount = requiredElement(document, "watchGraphCount");
    this.watchGraphAverage = requiredElement(document, "watchGraphAvg");
    this.watchGraphMinimum = requiredElement(document, "watchGraphMin");
    this.watchGraphMaximum = requiredElement(document, "watchGraphMax");
    this.watchGraphCompareCount = requiredElement(document, "watchGraphCompareCount");
    this.watchGraphCompareAverage = requiredElement(document, "watchGraphCompareAvg");
    this.watchGraphCompareMinimum = requiredElement(document, "watchGraphCompareMin");
    this.watchGraphCompareMaximum = requiredElement(document, "watchGraphCompareMax");
    this.watchGraphCanvas = requiredElement(document, "watchGraphCanvas");
    this.watchGraphEmpty = requiredElement(document, "watchGraphEmpty");
  }

  static from(document: Document): ViewingDom {
    return new ViewingDom(document);
  }
}

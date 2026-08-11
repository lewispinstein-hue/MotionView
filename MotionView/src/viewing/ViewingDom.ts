function optionalElement<T extends HTMLElement>(document: Document, id: string): T | null {
  return document.getElementById(id) as T | null;
}

function requiredElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = optionalElement<T>(document, id);
  if (!element) throw new Error(`MotionView Viewing UI requires #${id}.`);
  return element;
}

export interface ViewingFieldDom {
  readonly canvas: HTMLCanvasElement;
}

export interface ViewingTimelineDom {
  readonly canvas: HTMLCanvasElement;
  readonly bar: HTMLElement;
  readonly top: HTMLElement | null;
}

export interface ViewingListsDom {
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
}

export interface ViewingReadoutDom {
  readonly time: HTMLElement;
  readonly delta: HTMLElement;
  readonly point: HTMLElement;
  readonly pose: HTMLElement;
  readonly cursor: HTMLElement;
  readonly planCursor: HTMLElement;
}

export interface ViewingFloatingDom {
  readonly panel: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly close: HTMLButtonElement;
  readonly header: HTMLElement;
  readonly resizer: HTMLElement;
  readonly pinnedHost: HTMLElement;
  readonly pinnedTemplate: HTMLTemplateElement;
  readonly values: {
    readonly x: HTMLElement;
    readonly y: HTMLElement;
    readonly theta: HTMLElement;
    readonly time: HTMLElement;
    readonly averageSpeed: HTMLElement;
    readonly leftVelocity: HTMLElement;
    readonly rightVelocity: HTMLElement;
    readonly deltaTime: HTMLElement;
    readonly pointCount: HTMLElement;
    readonly watchTime: HTMLElement;
    readonly watchLabel: HTMLElement;
    readonly watchValue: HTMLElement;
  };
}

export interface ViewingGraphDom {
  readonly panel: HTMLElement;
  readonly header: HTMLElement;
  readonly resizer: HTMLElement;
  readonly close: HTMLButtonElement;
  readonly subtitle: HTMLElement;
  readonly title: HTMLElement;
  readonly compareSelect: HTMLSelectElement;
  readonly latest: HTMLElement;
  readonly compareLatest: HTMLElement;
  readonly count: HTMLElement;
  readonly average: HTMLElement;
  readonly minimum: HTMLElement;
  readonly maximum: HTMLElement;
  readonly compareCount: HTMLElement;
  readonly compareAverage: HTMLElement;
  readonly compareMinimum: HTMLElement;
  readonly compareMaximum: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly empty: HTMLElement;
}

/** Stable typed DOM groups owned by Viewing presentation. */
export class ViewingDom {
  readonly field: ViewingFieldDom;
  readonly timeline: ViewingTimelineDom;
  readonly lists: ViewingListsDom;
  readonly readout: ViewingReadoutDom;
  readonly floating: ViewingFloatingDom;
  readonly graph: ViewingGraphDom;
  readonly tooltip: HTMLElement;

  private constructor(document: Document) {
    this.field = {
      canvas: requiredElement(document, "c"),
    };
    this.timeline = {
      canvas: requiredElement(document, "timelineCanvas"),
      bar: requiredElement(document, "timelineBar"),
      top: optionalElement(document, "timelineTop"),
    };
    this.lists = {
      watchList: requiredElement(document, "watchList"),
      watchFilter: requiredElement(document, "watchFilter"),
      watchSort: requiredElement(document, "watchSort"),
      watchCount: requiredElement(document, "watchCount"),
      poseList: requiredElement(document, "poseList"),
      poseCount: requiredElement(document, "poseCount"),
      waypointList: requiredElement(document, "waypointList"),
      waypointCount: requiredElement(document, "waypointCount"),
      waypointFilter: requiredElement(document, "waypointFilter"),
      logList: requiredElement(document, "logList"),
      logCount: requiredElement(document, "logCount"),
      logSort: requiredElement(document, "logSort"),
    };
    this.tooltip = requiredElement(document, "watchPopup");
    this.readout = {
      time: requiredElement(document, "timePill"),
      delta: requiredElement(document, "deltaPill"),
      point: requiredElement(document, "pointPill"),
      pose: requiredElement(document, "posePill"),
      cursor: requiredElement(document, "cursorPill"),
      planCursor: requiredElement(document, "planCursorPill"),
    };
    this.floating = {
      panel: requiredElement(document, "floatingInfo"),
      toggle: requiredElement(document, "btnToggleFloat"),
      close: requiredElement(document, "btnCloseFloat"),
      header: requiredElement(document, "floatHeader"),
      resizer: requiredElement(document, "floatResizer"),
      pinnedHost: requiredElement(document, "pinnedWatchHost"),
      pinnedTemplate: requiredElement(document, "pinnedWatchTemplate"),
      values: {
        x: requiredElement(document, "fx"),
        y: requiredElement(document, "fy"),
        theta: requiredElement(document, "ft"),
        time: requiredElement(document, "ftime"),
        averageSpeed: requiredElement(document, "favg"),
        leftVelocity: requiredElement(document, "flv"),
        rightVelocity: requiredElement(document, "frv"),
        deltaTime: requiredElement(document, "fdeltat"),
        pointCount: requiredElement(document, "fcount"),
        watchTime: requiredElement(document, "fwatchtime"),
        watchLabel: requiredElement(document, "fwatchlabel"),
        watchValue: requiredElement(document, "fwatchvalue"),
      },
    };
    this.graph = {
      panel: requiredElement(document, "watchGraphPanel"),
      header: requiredElement(document, "watchGraphHeader"),
      resizer: requiredElement(document, "watchGraphResizer"),
      close: requiredElement(document, "btnCloseWatchGraph"),
      subtitle: requiredElement(document, "watchGraphSubtitle"),
      title: requiredElement(document, "watchGraphTitle"),
      compareSelect: requiredElement(document, "watchGraphCompareSelect"),
      latest: requiredElement(document, "watchGraphLatest"),
      compareLatest: requiredElement(document, "watchGraphCompareLatest"),
      count: requiredElement(document, "watchGraphCount"),
      average: requiredElement(document, "watchGraphAvg"),
      minimum: requiredElement(document, "watchGraphMin"),
      maximum: requiredElement(document, "watchGraphMax"),
      compareCount: requiredElement(document, "watchGraphCompareCount"),
      compareAverage: requiredElement(document, "watchGraphCompareAvg"),
      compareMinimum: requiredElement(document, "watchGraphCompareMin"),
      compareMaximum: requiredElement(document, "watchGraphCompareMax"),
      canvas: requiredElement(document, "watchGraphCanvas"),
      empty: requiredElement(document, "watchGraphEmpty"),
    };
  }

  static from(document: Document): ViewingDom {
    return new ViewingDom(document);
  }
}

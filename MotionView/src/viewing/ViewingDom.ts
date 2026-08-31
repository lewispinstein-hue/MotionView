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
  readonly cursor: HTMLElement;
  readonly planCursor: HTMLElement;
}

export interface ViewingTimelineDom {
  readonly canvas: HTMLCanvasElement;
  readonly bar: HTMLElement;
  readonly top: HTMLElement | null;
}

export interface ViewingListsDom {
  readonly sectionTabs: readonly HTMLButtonElement[];
  readonly sectionScroller: HTMLElement;
  readonly panels: Readonly<Record<"watches" | "logs" | "waypoints" | "poses", HTMLElement>>;
  readonly scrollContainer: HTMLElement;
  readonly searchWrap: HTMLElement;
  readonly search: HTMLInputElement;
  readonly searchCount: HTMLElement;
  readonly watchList: HTMLElement;
  readonly levelFilter: HTMLSelectElement;
  readonly watchSort: HTMLSelectElement;
  readonly watchTabCount: HTMLElement;
  readonly poseList: HTMLElement;
  readonly poseSort: HTMLSelectElement;
  readonly poseTabCount: HTMLElement;
  readonly waypointList: HTMLElement;
  readonly waypointSort: HTMLSelectElement;
  readonly waypointTabCount: HTMLElement;
  readonly logList: HTMLElement;
  readonly logSort: HTMLSelectElement;
  readonly logTabCount: HTMLElement;
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
      cursor: requiredElement(document, "cursorPill"),
      planCursor: requiredElement(document, "planCursorPill"),
    };
    this.timeline = {
      canvas: requiredElement(document, "timelineCanvas"),
      bar: requiredElement(document, "timelineBar"),
      top: optionalElement(document, "timelineTop"),
    };
    this.lists = {
      sectionTabs: Array.from(document.querySelectorAll<HTMLButtonElement>("[data-viewing-section]")),
      sectionScroller: requiredElement(document, "viewingSidebarTabs"),
      panels: {
        watches: requiredElement(document, "watchPanel"),
        logs: requiredElement(document, "logPanel"),
        waypoints: requiredElement(document, "waypointPanel"),
        poses: requiredElement(document, "posePanel"),
      },
      scrollContainer: requiredElement(document, "viewingSidebarScroll"),
      searchWrap: requiredElement(document, "viewingSearchWrap"),
      search: requiredElement(document, "viewingSearch"),
      searchCount: requiredElement(document, "viewingSearchCount"),
      watchList: requiredElement(document, "watchList"),
      levelFilter: requiredElement(document, "levelFilter"),
      watchSort: requiredElement(document, "watchSort"),
      watchTabCount: requiredElement(document, "watchTabCount"),
      poseList: requiredElement(document, "poseList"),
      poseSort: requiredElement(document, "poseSort"),
      poseTabCount: requiredElement(document, "poseTabCount"),
      waypointList: requiredElement(document, "waypointList"),
      waypointSort: requiredElement(document, "waypointSort"),
      waypointTabCount: requiredElement(document, "waypointTabCount"),
      logList: requiredElement(document, "logList"),
      logSort: requiredElement(document, "logSort"),
      logTabCount: requiredElement(document, "logTabCount"),
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

  static from(documentRoot: Document = document): ViewingDom {
    return new ViewingDom(documentRoot);
  }
}

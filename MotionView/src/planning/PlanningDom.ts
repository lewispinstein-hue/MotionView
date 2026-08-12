function requiredElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`MotionView Planning UI requires #${id}.`);
  return element as T;
}

/** Stable typed references to elements owned by Planning presentation. */
export class PlanningDom {
  readonly canvas: HTMLCanvasElement;
  readonly timelineCanvas: HTMLCanvasElement;
  readonly timelineViewport: HTMLElement;
  readonly timelineContent: HTMLElement;
  readonly eventTimeline: HTMLElement;
  readonly eventTimelineInner: HTMLElement;
  readonly eventTimelineHint: HTMLElement;
  readonly timelineWaypointLayer: HTMLElement;
  readonly timelineNodeLayer: HTMLElement;
  readonly timelineDropLine: HTMLElement;
  readonly timePill: HTMLElement;
  readonly pointPill: HTMLElement;
  readonly cursorPill: HTMLElement;
  readonly nodeTooltip: HTMLElement;
  readonly list: HTMLElement;
  readonly count: HTMLElement;
  readonly selectedIndex: HTMLElement;
  readonly selectedXLabel: HTMLElement;
  readonly selectedYLabel: HTMLElement;
  readonly selectedX: HTMLInputElement;
  readonly selectedY: HTMLInputElement;
  readonly selectedTheta: HTMLInputElement;
  readonly selectedSpeed: HTMLInputElement;
  readonly objectList: HTMLElement;
  readonly addObject: HTMLButtonElement;
  readonly copyCode: HTMLButtonElement;
  readonly editTemplate: HTMLButtonElement;
  readonly exportButton: HTMLButtonElement;
  readonly templateModal: HTMLElement;
  readonly templateTitle: HTMLElement;
  readonly templateSubtitle: HTMLElement;
  readonly templateGroupTitle: HTMLElement;
  readonly templateDescription: HTMLElement;
  readonly templateNameField: HTMLElement;
  readonly templateNameDescription: HTMLElement;
  readonly templateName: HTMLInputElement;
  readonly templateValidation: HTMLElement;
  readonly templateClose: HTMLButtonElement;
  readonly templateCancel: HTMLButtonElement;
  readonly templateConfirm: HTMLButtonElement;
  readonly templateCode: HTMLTextAreaElement;
  readonly confirmModal: HTMLElement;
  readonly confirmTitle: HTMLElement;
  readonly confirmMessage: HTMLElement;
  readonly confirmClose: HTMLButtonElement;
  readonly confirmCancel: HTMLButtonElement;
  readonly confirmButton: HTMLButtonElement;

  private constructor(document: Document) {
    this.canvas = requiredElement(document, "c");
    this.timelineCanvas = requiredElement(document, "planningTimelineCanvas");
    this.timelineViewport = requiredElement(document, "planningTimelineViewport");
    this.timelineContent = requiredElement(document, "planningTimelineContent");
    this.eventTimeline = requiredElement(document, "planningEventTimeline");
    this.eventTimelineInner = requiredElement(document, "planningEventTimelineInner");
    this.eventTimelineHint = requiredElement(document, "planningEventTimelineHint");
    this.timelineWaypointLayer = requiredElement(document, "planningTimelineWaypointLayer");
    this.timelineNodeLayer = requiredElement(document, "planningTimelineNodeLayer");
    this.timelineDropLine = requiredElement(document, "planningTimelineDropLine");
    this.timePill = requiredElement(document, "planTimePill");
    this.pointPill = requiredElement(document, "planPointPill");
    this.cursorPill = requiredElement(document, "planCursorPill");
    this.nodeTooltip = requiredElement(document, "planNodeTooltip");
    this.list = requiredElement(document, "planList");
    this.count = requiredElement(document, "planCount");
    this.selectedIndex = requiredElement(document, "planSelIndex");
    this.selectedXLabel = requiredElement(document, "planSelXLabel");
    this.selectedYLabel = requiredElement(document, "planSelYLabel");
    this.selectedX = requiredElement(document, "planSelX");
    this.selectedY = requiredElement(document, "planSelY");
    this.selectedTheta = requiredElement(document, "planSelTheta");
    this.selectedSpeed = requiredElement(document, "planSelSpeed");
    this.objectList = requiredElement(document, "planObjectList");
    this.addObject = requiredElement(document, "btnPlanAddObject");
    this.copyCode = requiredElement(document, "btnPlanCopyCode");
    this.editTemplate = requiredElement(document, "btnPlanEditTemplate");
    this.exportButton = requiredElement(document, "btnPlanExport");
    this.templateModal = requiredElement(document, "planTemplateModal");
    this.templateTitle = requiredElement(document, "planTemplateTitle");
    this.templateSubtitle = requiredElement(document, "planTemplateSubtitle");
    this.templateGroupTitle = requiredElement(document, "planTemplateGroupTitle");
    this.templateDescription = requiredElement(document, "planTemplateDescription");
    this.templateNameField = requiredElement(document, "planTemplateNameField");
    this.templateNameDescription = requiredElement(document, "planTemplateNameDescription");
    this.templateName = requiredElement(document, "planTemplateNameInput");
    this.templateValidation = requiredElement(document, "planTemplateValidation");
    this.templateClose = requiredElement(document, "btnPlanTemplateClose");
    this.templateCancel = requiredElement(document, "btnPlanTemplateCancel");
    this.templateConfirm = requiredElement(document, "btnPlanTemplateConfirm");
    this.templateCode = requiredElement(document, "planTemplateInput");
    this.confirmModal = requiredElement(document, "planObjectDeleteModal");
    this.confirmTitle = requiredElement(document, "planObjectDeleteTitle");
    this.confirmMessage = requiredElement(document, "planObjectDeleteMessage");
    this.confirmClose = requiredElement(document, "btnPlanObjectDeleteClose");
    this.confirmCancel = requiredElement(document, "btnPlanObjectDeleteCancel");
    this.confirmButton = requiredElement(document, "btnPlanObjectDeleteConfirm");
  }

  static from(document: Document): PlanningDom {
    return new PlanningDom(document);
  }
}

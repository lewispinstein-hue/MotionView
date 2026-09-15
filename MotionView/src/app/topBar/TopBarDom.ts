function requiredElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`MotionView top bar requires #${id}.`);
  return element as T;
}

function requiredSelector<T extends HTMLElement>(document: Document, selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`MotionView top bar requires ${selector}.`);
  return element as T;
}

/** Stable typed references to elements owned by the application top bar. */
export class TopBarDom {
  readonly root: HTMLElement;
  readonly content: HTMLElement;
  readonly left: HTMLElement;
  readonly center: HTMLElement;
  readonly right: HTMLElement;
  readonly status: HTMLElement;
  readonly fileInput: HTMLInputElement;
  readonly robotImageInput: HTMLInputElement;
  readonly playButton: HTMLButtonElement;
  readonly fitButton: HTMLButtonElement;
  readonly settingsButton: HTMLButtonElement;
  readonly clearButton: HTMLButtonElement;
  readonly helpButton: HTMLButtonElement;
  readonly viewingModeButton: HTMLButtonElement;
  readonly planningModeButton: HTMLButtonElement;
  readonly speedSelect: HTMLSelectElement;
  readonly fieldSelect: HTMLSelectElement;
  readonly fileButton: HTMLButtonElement;

  private constructor(document: Document) {
    this.root = requiredElement(document, "topBar");
    this.content = requiredSelector(document, ".topBarContent");
    this.left = requiredSelector(document, ".topBarLeft");
    this.center = requiredSelector(document, ".topBarCenter");
    this.right = requiredSelector(document, ".topBarRight");
    this.status = requiredElement(document, "status");
    this.fileInput = requiredElement(document, "file");
    this.robotImageInput = requiredElement(document, "robotImageFile");
    this.playButton = requiredElement(document, "btnPlay");
    this.fitButton = requiredElement(document, "btnFit");
    this.settingsButton = requiredElement(document, "btnSettings");
    this.clearButton = requiredElement(document, "btnClearField");
    this.helpButton = requiredElement(document, "btnHelp");
    this.viewingModeButton = requiredElement(document, "modeViewing");
    this.planningModeButton = requiredElement(document, "modePlanning");
    this.speedSelect = requiredElement(document, "speedSelect");
    this.fieldSelect = requiredElement(document, "fieldSelect");
    this.fileButton = requiredElement(document, "btnFile");
  }

  static from(documentRoot: Document = document): TopBarDom {
    return new TopBarDom(documentRoot);
  }
}

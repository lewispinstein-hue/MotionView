function requiredElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`MotionView Help UI requires #${id}.`);
  return element as T;
}

export class HelpDom {
  readonly helpModal: HTMLElement;
  readonly helpClose: HTMLButtonElement;
  readonly showKeybinds: HTMLButtonElement;
  readonly showFeedback: HTMLButtonElement;
  readonly keybindsModal: HTMLElement;
  readonly keybindsClose: HTMLButtonElement;
  readonly keybindsContent: HTMLElement;
  readonly version: HTMLElement;
  readonly feedbackModal: HTMLElement;
  readonly feedbackClose: HTMLButtonElement;
  readonly feedbackDescription: HTMLTextAreaElement;
  readonly feedbackDescriptionCount: HTMLElement;
  readonly feedbackRoute: HTMLInputElement;
  readonly feedbackValidation: HTMLElement;
  readonly feedbackDeliveryStatus: HTMLElement;
  readonly feedbackCancel: HTMLButtonElement;
  readonly feedbackSend: HTMLButtonElement;
  readonly feedbackProductTags: readonly HTMLButtonElement[];
  readonly feedbackTypeTags: readonly HTMLButtonElement[];
  readonly feedbackAreaTags: readonly HTMLButtonElement[];

  private constructor(document: Document) {
    this.helpModal = requiredElement(document, "helpModal");
    this.helpClose = requiredElement(document, "btnHelpClose");
    this.showKeybinds = requiredElement(document, "btnHelpKeybinds");
    this.showFeedback = requiredElement(document, "btnHelpFeedback");
    this.keybindsModal = requiredElement(document, "keybindsModal");
    this.keybindsClose = requiredElement(document, "btnKeybindsClose");
    this.keybindsContent = requiredElement(document, "keybindsContent");
    this.version = requiredElement(document, "versionDisplay");
    this.feedbackModal = requiredElement(document, "feedbackModal");
    this.feedbackClose = requiredElement(document, "btnFeedbackClose");
    this.feedbackDescription = requiredElement(document, "feedbackDescription");
    this.feedbackDescriptionCount = requiredElement(document, "feedbackDescriptionCount");
    this.feedbackRoute = requiredElement(document, "feedbackRoute");
    this.feedbackValidation = requiredElement(document, "feedbackValidation");
    this.feedbackDeliveryStatus = requiredElement(document, "feedbackDeliveryStatus");
    this.feedbackCancel = requiredElement(document, "btnFeedbackCancel");
    this.feedbackSend = requiredElement(document, "btnFeedbackSend");
    this.feedbackProductTags = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-feedback-product]"));
    this.feedbackTypeTags = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-feedback-type]"));
    this.feedbackAreaTags = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-feedback-area]"));
  }

  static from(document: Document): HelpDom { return new HelpDom(document); }
}

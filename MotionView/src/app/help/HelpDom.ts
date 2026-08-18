function requiredElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`MotionView Help UI requires #${id}.`);
  return element as T;
}

export class HelpDom {
  readonly helpModal: HTMLElement;
  readonly helpClose: HTMLButtonElement;
  readonly showKeybinds: HTMLButtonElement;
  readonly keybindsModal: HTMLElement;
  readonly keybindsClose: HTMLButtonElement;
  readonly keybindsContent: HTMLElement;
  readonly version: HTMLElement;

  private constructor(document: Document) {
    this.helpModal = requiredElement(document, "helpModal");
    this.helpClose = requiredElement(document, "btnHelpClose");
    this.showKeybinds = requiredElement(document, "btnHelpKeybinds");
    this.keybindsModal = requiredElement(document, "keybindsModal");
    this.keybindsClose = requiredElement(document, "btnKeybindsClose");
    this.keybindsContent = requiredElement(document, "keybindsContent");
    this.version = requiredElement(document, "versionDisplay");
  }

  static from(document: Document): HelpDom { return new HelpDom(document); }
}

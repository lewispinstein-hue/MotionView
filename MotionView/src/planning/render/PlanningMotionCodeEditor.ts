import { applyMotionCodeEdit, createMotionCodeDocument, type MotionCodeEntry, type MotionCodeRange } from "../planningMotionCode";

/** One code surface with non-editable headings and stable motion ownership. */
export class PlanningMotionCodeEditor {
  readonly #element: HTMLDivElement;
  readonly #input: HTMLTextAreaElement;
  readonly #display: HTMLPreElement;
  #ranges: readonly MotionCodeRange[] = [];
  #source = "";
  #editOwnerId: string | null = null;

  constructor(
    textarea: HTMLTextAreaElement,
    private readonly change: (id: string, code: string) => void,
    private readonly select: (id: string) => void,
  ) {
    this.#element = document.createElement("div");
    this.#element.id = "planMotionCodePreview";
    this.#element.className = "planMotionCodePreview";
    this.#element.hidden = true;
    this.#display = document.createElement("pre");
    this.#display.className = "planMotionCodeDisplay";
    this.#display.setAttribute("aria-hidden", "true");
    this.#input = document.createElement("textarea");
    this.#input.id = "planMotionCodeInput";
    this.#input.className = "planMotionCodeInput";
    this.#input.setAttribute("aria-label", "Full waypoint code preview");
    this.#input.setAttribute("aria-describedby", "planTemplateDescription");
    this.#input.spellcheck = false;
    this.#input.wrap = "off";
    this.#input.addEventListener("beforeinput", (event) => this.prepareEdit(event));
    this.#input.addEventListener("input", () => this.updateDraft());
    this.#input.addEventListener("keydown", (event) => this.navigate(event));
    this.#input.addEventListener("scroll", () => this.syncScroll());
    for (const event of ["focus", "click", "keyup", "select"]) {
      this.#input.addEventListener(event, () => this.selectAtCaret());
    }
    this.#element.append(this.#display, this.#input);
    textarea.before(this.#element);
  }

  get focusTarget(): HTMLElement {
    return this.#input;
  }

  show(entries: readonly MotionCodeEntry[], selectedId: string | null): void {
    this.#element.hidden = false;
    const document = createMotionCodeDocument(entries);
    this.#source = document.source;
    this.#ranges = document.ranges;
    this.#editOwnerId = null;
    this.#input.value = this.#source;
    this.resize();
    this.renderDisplay();
    const start = this.#ranges.find((range) => range.id === selectedId)?.start ?? 0;
    this.#input.setSelectionRange(start, start);
  }

  focus(id: string): void {
    const range = this.#ranges.find((entry) => entry.id === id);
    if (!range) return;
    this.#input.setSelectionRange(range.start, range.start);
    this.#input.focus();
  }

  private updateDraft(): void {
    const next = this.#input.value;
    if (next === this.#source) return;
    const edit = applyMotionCodeEdit({ source: this.#source, ranges: this.#ranges }, next, this.#editOwnerId);
    this.#editOwnerId = null;
    if (!edit) {
      const caret = Math.min(this.#input.selectionStart, this.#source.length);
      this.#input.value = this.#source;
      this.#input.setSelectionRange(caret, caret);
      return;
    }
    this.#ranges = edit.document.ranges;
    this.#source = edit.document.source;
    this.change(edit.id, edit.code);
    this.select(edit.id);
    this.resize();
    this.renderDisplay();
  }

  private prepareEdit(event: InputEvent): void {
    this.#editOwnerId = null;
    if (event.inputType.startsWith("history")) return;
    const start = this.#input.selectionStart;
    const end = this.#input.selectionEnd;
    const owner = this.#ranges.find((range) => start >= range.start && end <= range.end);
    if (!owner || (start === end && (
      (event.inputType === "deleteContentBackward" && start === owner.start)
      || (event.inputType === "deleteContentForward" && end === owner.end)
    ))) {
      event.preventDefault();
      return;
    }
    this.#editOwnerId = owner.id;
  }

  private selectAtCaret(): void {
    const caret = this.#input.selectionDirection === "backward"
      ? this.#input.selectionStart : this.#input.selectionEnd;
    let owner = this.#ranges.find((range) => caret >= range.start && caret <= range.end);
    if (!owner && this.#input.selectionStart === this.#input.selectionEnd) {
      const boundaries = this.#ranges.flatMap((range) => [range.start, range.end]);
      const nearest = boundaries.reduce((best, value) => Math.abs(value - caret) < Math.abs(best - caret) ? value : best, boundaries[0] ?? 0);
      if (caret !== nearest) this.#input.setSelectionRange(nearest, nearest);
      owner = this.#ranges.find((range) => nearest >= range.start && nearest <= range.end);
    }
    if (owner) this.select(owner.id);
  }

  private navigate(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const caret = this.#input.selectionDirection === "backward"
      ? this.#input.selectionStart : this.#input.selectionEnd;
    const index = this.#ranges.findIndex((range) => caret >= range.start && caret <= range.end);
    const current = this.#ranges[index];
    if (!current) return;
    const previous = this.#ranges[index - 1];
    const next = this.#ranges[index + 1];
    const lineStart = Math.max(current.start, this.#source.lastIndexOf("\n", caret - 1) + 1);
    const newline = this.#source.indexOf("\n", caret);
    const lineEnd = newline < 0 ? current.end : Math.min(newline, current.end);
    const column = caret - lineStart;
    let target: number;
    if (event.key === "ArrowUp" && lineStart === current.start) {
      const start = previous ? Math.max(previous.start, this.#source.lastIndexOf("\n", previous.end - 1) + 1) : current.start;
      target = previous ? Math.min(start + column, previous.end) : current.start;
    } else if (event.key === "ArrowDown" && lineEnd === current.end) {
      const end = next ? this.#source.indexOf("\n", next.start) : -1;
      target = next ? Math.min(next.start + column, end < 0 ? next.end : Math.min(end, next.end)) : current.end;
    } else if (event.key === "ArrowLeft" && caret === current.start) {
      target = previous?.end ?? current.start;
    } else if (event.key === "ArrowRight" && caret === current.end) {
      target = next?.start ?? current.end;
    } else return;
    event.preventDefault();
    if (event.shiftKey) {
      const anchor = this.#input.selectionDirection === "backward" ? this.#input.selectionEnd : this.#input.selectionStart;
      this.#input.setSelectionRange(Math.min(anchor, target), Math.max(anchor, target), target < anchor ? "backward" : "forward");
    } else this.#input.setSelectionRange(target, target);
    this.selectAtCaret();
  }

  private resize(): void {
    this.#input.rows = Math.max(5, this.#source.split("\n").length);
  }

  private renderDisplay(): void {
    this.#display.replaceChildren();
    let offset = 0;
    for (const range of this.#ranges) {
      const heading = document.createElement("span");
      heading.className = "planMotionCodeHeading";
      heading.textContent = `${range.name}:`;
      heading.addEventListener("pointerdown", (event) => event.preventDefault());
      this.#display.append(
        document.createTextNode(this.#source.slice(offset, range.headingStart)),
        heading,
        document.createTextNode(this.#source.slice(range.start - 1, range.end)),
      );
      offset = range.end;
    }
    // Keep the final empty line aligned with the textarea's caret position.
    this.#display.appendChild(document.createTextNode("\u200b"));
    this.syncScroll();
  }

  private syncScroll(): void {
    this.#display.scrollTop = this.#input.scrollTop;
    this.#display.scrollLeft = this.#input.scrollLeft;
  }

  hide(): void {
    this.#element.hidden = true;
    this.#input.value = "";
    this.#display.replaceChildren();
    this.#source = "";
    this.#ranges = [];
  }
}

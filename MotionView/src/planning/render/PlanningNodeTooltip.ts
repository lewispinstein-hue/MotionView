const SHOW_DELAY_MS = 250;
const HIDE_DELAY_MS = 100;
const RESHOW_WINDOW_MS = 500;

/** One hover session shared by the field and timeline's tooltip element. */
export class PlanningNodeTooltip {
  #showTimer: number | null = null;
  #hideTimer: number | null = null;
  #reshowUntil = 0;

  constructor(private readonly element: HTMLElement) {}

  show(text: string, edited: boolean, position: () => void): void {
    this.clearTimers();
    const show = () => {
      this.#showTimer = null;
      this.element.textContent = text;
      this.element.classList.toggle("hasOverride", edited);
      this.element.hidden = false;
      this.element.classList.add("isVisible");
      position();
    };
    if (!this.element.hidden || performance.now() < this.#reshowUntil) show();
    else this.#showTimer = window.setTimeout(show, SHOW_DELAY_MS);
  }

  hide(immediate = false): void {
    if (this.#showTimer != null) window.clearTimeout(this.#showTimer);
    this.#showTimer = null;
    if (immediate) {
      this.clearTimers();
      this.#reshowUntil = 0;
      this.hideNow();
    } else if (!this.element.hidden && this.#hideTimer == null) {
      // Leaving one node fires before entering the next. Briefly retain the
      // visible tooltip so the next node can replace its content without a fade.
      this.#hideTimer = window.setTimeout(() => {
        this.#hideTimer = null;
        this.#reshowUntil = performance.now() + RESHOW_WINDOW_MS;
        this.hideNow();
      }, HIDE_DELAY_MS);
    }
  }

  private hideNow(): void {
    this.element.classList.remove("isVisible", "hasOverride");
    this.element.hidden = true;
  }

  private clearTimers(): void {
    if (this.#showTimer != null) window.clearTimeout(this.#showTimer);
    if (this.#hideTimer != null) window.clearTimeout(this.#hideTimer);
    this.#showTimer = null;
    this.#hideTimer = null;
  }
}

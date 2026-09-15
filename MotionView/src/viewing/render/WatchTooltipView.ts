export type WatchTooltipValueType = string | number;
export type WatchTooltipRow = readonly [key: string, value: WatchTooltipValueType];

/** Renders a positioned key/value tooltip shared by Viewing interactions. */
export class WatchTooltipView {
  #positionFrame: number | null = null;

  constructor(private readonly tooltip: HTMLElement) {}

  bind(): void {
    document.addEventListener("mousedown", (event) => {
      if (!this.tooltip.hidden && !this.tooltip.contains(event.target as Node)) this.hide();
    }, { capture: true });
  }

  show(rows: readonly WatchTooltipRow[], position: Readonly<{ x: number; y: number }>): void {
    this.tooltip.replaceChildren(...rows.map(([key, value]) => this.row(key, value)));
    this.tooltip.hidden = false;
    if (this.#positionFrame != null) cancelAnimationFrame(this.#positionFrame);
    this.#positionFrame = requestAnimationFrame(() => {
      this.#positionFrame = null;
      if (this.tooltip.hidden) return;
      const rect = this.tooltip.getBoundingClientRect();
      const maximumLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maximumTop = Math.max(8, window.innerHeight - rect.height - 8);
      const left = Math.max(8, Math.min(maximumLeft, position.x - rect.width / 2));
      const preferredTop = position.y - rect.height - 10;
      const top = preferredTop >= 8
        ? preferredTop
        : Math.max(8, Math.min(maximumTop, position.y + 10));
      this.tooltip.style.left = `${left}px`;
      this.tooltip.style.top = `${top}px`;
    });
  }

  hide(): void {
    if (this.#positionFrame != null) cancelAnimationFrame(this.#positionFrame);
    this.#positionFrame = null;
    this.tooltip.hidden = true;
  }

  private row(key: string, value: WatchTooltipValueType): HTMLElement {
    const row = document.createElement("div");
    row.className = "row";
    const keyElement = document.createElement("div");
    keyElement.className = "k";
    keyElement.textContent = key;
    const valueElement = document.createElement("div");
    valueElement.className = "v";
    valueElement.textContent = String(value);
    row.append(keyElement, valueElement);
    return row;
  }
}

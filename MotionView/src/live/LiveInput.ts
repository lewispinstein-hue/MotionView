import { getMode } from "../app/modeController";
import type { LiveFeature } from "./LiveFeature";

export class LiveInput {
  #bound = false;

  constructor(private readonly live: LiveFeature) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    document.addEventListener("keydown", (event) => this.handleKeydown(event));
  }

  handleKeydown(event: KeyboardEvent): boolean {
    if (getMode() !== "viewing" || !event.metaKey && !event.ctrlKey || event.shiftKey || event.altKey) return false;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) {
      return false;
    }
    const key = event.key.toLowerCase();
    if (key === "r") {
      event.preventDefault();
      this.live.stream.refreshNow();
      return true;
    }
    if (key === "s") {
      event.preventDefault();
      if (this.live.stream.streaming) void this.live.stop();
      else void this.live.start();
      return true;
    }
    return false;
  }
}

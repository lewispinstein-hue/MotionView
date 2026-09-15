import { getMode } from "../app/modeController";
import { isTypingTarget, LIVE_SHORTCUTS, matchesShortcut } from "../app/input";
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
    if (getMode() !== "viewing" || event.defaultPrevented || isTypingTarget(event.target)) return false;
    if (matchesShortcut(event, LIVE_SHORTCUTS.refresh)) {
      event.preventDefault();
      this.live.stream.refreshNow();
      return true;
    }
    if (matchesShortcut(event, LIVE_SHORTCUTS.toggleStreaming)) {
      event.preventDefault();
      if (this.live.stream.streaming) void this.live.stop();
      else void this.live.start();
      return true;
    }
    return false;
  }
}

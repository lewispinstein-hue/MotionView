import { getMode } from "../app/modeController";
import { setStatus } from "../app/status";
import type { ViewingFeature } from "./ViewingFeature";
import type { ViewingView } from "./ViewingView";

/** Translates Viewing keyboard intent into domain and presentation commands. */
export class ViewingInput {
  #bound = false;

  constructor(
    private readonly viewing: ViewingFeature,
    private readonly view: ViewingView,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    document.addEventListener("keydown", (event) => {
      if (this.handleKeydown(event)) event.stopImmediatePropagation();
    });
  }

  handleKeydown(event: KeyboardEvent): boolean {
    if (getMode() !== "viewing" || event.defaultPrevented || this.isTypingTarget(event.target)) return false;
    if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        this.view.toggleFloatingInfo();
        return true;
      }
      if (event.key === "g" || event.key === "G") {
        event.preventDefault();
        this.view.toggleWatchGraph();
        return true;
      }
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && (event.key === "n" || event.key === "N")) {
      event.preventDefault();
      this.view.openFloatingWatch();
      return true;
    }
    if (event.key === "Escape" && this.viewing.navigation.selectedWaypointId != null) {
      event.preventDefault();
      this.view.clearWaypointSelection();
      return true;
    }
    if (!this.viewing.data.hasData) return false;
    const { navigation, playback } = this.viewing;

    if (event.code === "Space" && navigation.liveConnected) {
      event.preventDefault();
      navigation.setAutoFollow(!navigation.autoFollow);
      setStatus(`Live View: Auto-follow head: ${navigation.autoFollow ? "ON" : "OFF"} (Space)`);
      return true;
    }

    if (event.code === "Space") {
      event.preventDefault();
      playback.toggle();
      return true;
    }

    if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      event.preventDefault();
      playback.pause();
      navigation.clearTrackLock();
      navigation.setTrackHover(null);
      navigation.movePoseBy(event.code === "ArrowLeft" ? -1 : 1);
      return true;
    }

    return false;
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement
      && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
      && target.isConnected
      && target.closest("[hidden]") == null;
  }
}

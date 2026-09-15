import { getMode } from "../app/modeController";
import { isTypingTarget, matchesShortcut, VIEWING_SHORTCUTS } from "../app/input";
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
    if (getMode() !== "viewing" || event.defaultPrevented || isTypingTarget(event.target)) return false;
    if (matchesShortcut(event, VIEWING_SHORTCUTS.floatingInfo)) {
      event.preventDefault();
      this.view.toggleFloatingInfo();
      return true;
    }
    if (matchesShortcut(event, VIEWING_SHORTCUTS.watchGraph)) {
      event.preventDefault();
      this.view.toggleWatchGraph();
      return true;
    }
    if (matchesShortcut(event, VIEWING_SHORTCUTS.floatingWatch)) {
      event.preventDefault();
      this.view.openFloatingWatch();
      return true;
    }
    if (matchesShortcut(event, VIEWING_SHORTCUTS.clearDetails) && this.viewing.navigation.selectedWaypointId != null) {
      event.preventDefault();
      this.view.clearWaypointSelection();
      return true;
    }
    if (!this.viewing.data.hasData) return false;
    const { navigation, playback } = this.viewing;

    if (matchesShortcut(event, VIEWING_SHORTCUTS.playback) && navigation.liveConnected) {
      event.preventDefault();
      navigation.setAutoFollow(!navigation.autoFollow);
      setStatus(`Live View: Auto-follow head: ${navigation.autoFollow ? "ON" : "OFF"} (Space)`);
      return true;
    }

    if (matchesShortcut(event, VIEWING_SHORTCUTS.playback)) {
      event.preventDefault();
      playback.toggle();
      return true;
    }

    const previous = matchesShortcut(event, VIEWING_SHORTCUTS.previousPose);
    if (previous || matchesShortcut(event, VIEWING_SHORTCUTS.nextPose)) {
      event.preventDefault();
      playback.pause();
      navigation.clearTrackLock();
      navigation.setTrackHover(null);
      navigation.movePoseBy(previous ? -1 : 1);
      return true;
    }

    return false;
  }
}

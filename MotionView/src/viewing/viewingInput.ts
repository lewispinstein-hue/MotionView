import { setStatus } from "../app/status";
import type { ViewingFeature } from "./ViewingFeature";

/** Translates keyboard intent into Viewing commands without reading or updating DOM. */
export class ViewingInput {
  constructor(private readonly viewing: ViewingFeature) {}

  handleKeydown(event: KeyboardEvent): boolean {
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
}

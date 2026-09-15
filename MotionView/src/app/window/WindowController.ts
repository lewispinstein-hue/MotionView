import { getWindowFullscreenState, isTauriRuntime, setWindowFullscreen } from "../../tauri/commands";
export class WindowController {
  #fullscreen = false; #bound = false;
  readonly #windows = isTauriRuntime() && typeof navigator === "object" && /Windows/.test(navigator.userAgent);
  bind(): void { if (this.#bound || !this.#windows) return; this.#bound = true; void this.refresh(); window.addEventListener("keydown", (event) => { if (event.key === "F11") { event.preventDefault(); void this.set(!this.#fullscreen); } else if (event.key === "Escape" && this.#fullscreen) { event.preventDefault(); void this.set(false); } }); }
  private async refresh(): Promise<void> { try { this.#fullscreen = await getWindowFullscreenState(); } catch (error) { console.error("MotionView: could not query fullscreen state:", error); } }
  private async set(enabled: boolean): Promise<void> { try { this.#fullscreen = await setWindowFullscreen(enabled); } catch (error) { console.error("MotionView: failed to change fullscreen state:", error); } }
}

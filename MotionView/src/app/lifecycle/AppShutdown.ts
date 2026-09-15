import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MotionViewApp } from "../MotionViewApp";
import type { FieldRenderer } from "../../render/field";
import type { SessionPersistence } from "../persistence";
import { saveRobotImage } from "../../tauri/commands";

export class AppShutdown {
  constructor(private readonly app: MotionViewApp, private readonly field: FieldRenderer, private readonly persistence: SessionPersistence) {}
  async bind(): Promise<void> {
    if (!this.app.core.tauri.isTauriRuntime()) return; const window = getCurrentWindow();
    await window.listen("tauri://close-requested", () => void this.quit("window-close"));
    await window.listen("motionview://app-quit-requested", () => void this.quit("backend-request"));
    globalThis.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "q") { event.preventDefault(); void this.quit("keyboard"); } });
  }
  private async quit(reason: "window-close" | "backend-request" | "keyboard"): Promise<void> {
    if (!this.app.beginExit(reason)) return;
    this.app.core.status.setStatus("App closing");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      const dataUrl = this.field.getRobotImageDataUrl();
      if (dataUrl && !this.field.getRobotImagePath()) {
        const path = await saveRobotImage(dataUrl);
        if (path) {
          this.field.setRobotImagePath(path);
          this.app.settings.update({ robotImage: { path, dataUrl: null } }, "system");
        }
      }
    } catch (error) {
      console.warn("Failed to persist robot image during exit:", error);
    }

    await this.persistence.saveNow();
    await this.app.settings.saveNow();
    try {
      await this.app.live.finalizeTelemetry();
    } catch (error) {
      console.warn("Failed to finalize live telemetry:", error);
    }

    try {
      const seconds = performance.now() / 1000;
      await this.app.finalizeExit({ uptime: Number((seconds > 60 ? seconds / 60 : seconds).toFixed(2)) });
    } catch (error) {
      console.error("Failed to finalize app quit:", error);
    }
  }
}

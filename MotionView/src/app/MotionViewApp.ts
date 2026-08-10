import type { TelemetryProperties } from "../telemetry/telemetryTypes";
import type { AppExitReason, AppLifecycleState } from "./appEvents";
import { CoreServices } from "./coreServices";

export class MotionViewApp {
  readonly core = new CoreServices();

  #lifecycle: AppLifecycleState = "created";
  #lifecycleBeforeExit: AppLifecycleState = "created";
  #version = this.core.telemetry.telemetryClient.getAppVersion();
  #exitReason: AppExitReason | null = null;
  #startPromise: Promise<void> | null = null;
  #readyPromise: Promise<void> | null = null;
  #finalizePromise: Promise<void> | null = null;

  get lifecycle(): AppLifecycleState {
    return this.#lifecycle;
  }

  get version(): string {
    return this.#version;
  }

  get exitReason(): AppExitReason | null {
    return this.#exitReason;
  }

  start(): Promise<void> {
    if (this.#startPromise) return this.#startPromise;

    this.#startPromise = (async () => {
      if (this.#lifecycle === "created") this.transitionTo("starting");
      try {
        this.#version = await this.core.telemetry.telemetryClient.init();
      } catch (error) {
        console.warn("Telemetry initialization failed:", error);
        this.#version = this.core.telemetry.telemetryClient.getAppVersion();
      }

      this.core.events.versionChanged.emit({ version: this.#version });
      if (this.#lifecycle === "starting") this.transitionTo("started");
    })();

    return this.#startPromise;
  }

  markReady(properties: TelemetryProperties = {}): Promise<void> {
    if (this.#readyPromise) return this.#readyPromise;

    this.#readyPromise = (async () => {
      await this.start();
      if (this.#lifecycle === "exiting" || this.#lifecycle === "exited") return;
      this.transitionTo("ready");
      try {
        await this.core.telemetry.appTelemetry.loaded(properties);
      } catch (error) {
        console.warn("App loaded telemetry failed:", error);
      }
    })();

    return this.#readyPromise;
  }

  beginExit(reason: AppExitReason): boolean {
    if (this.#lifecycle === "exiting" || this.#lifecycle === "exited") return false;
    this.#lifecycleBeforeExit = this.#lifecycle;
    this.#exitReason = reason;
    this.transitionTo("exiting");
    return true;
  }

  finalizeExit(properties: TelemetryProperties = {}): Promise<void> {
    if (this.#finalizePromise) return this.#finalizePromise;
    if (this.#lifecycle !== "exiting") {
      return Promise.reject(new Error("Cannot finalize MotionView exit before beginExit()."));
    }

    this.#finalizePromise = (async () => {
      try {
        await this.start();
        await this.core.telemetry.appTelemetry.exiting(properties);
        await this.core.telemetry.telemetryClient.flush();
        await this.core.tauri.finalizeAppQuit();
        this.transitionTo("exited");
      } catch (error) {
        this.#exitReason = null;
        this.transitionTo(this.#lifecycleBeforeExit);
        this.#finalizePromise = null;
        throw error;
      }
    })();

    return this.#finalizePromise;
  }

  private transitionTo(current: AppLifecycleState): void {
    if (this.#lifecycle === current) return;
    const previous = this.#lifecycle;
    this.#lifecycle = current;
    this.core.events.lifecycleChanged.emit({
      previous,
      current,
      exitReason: this.#exitReason,
    });
  }
}

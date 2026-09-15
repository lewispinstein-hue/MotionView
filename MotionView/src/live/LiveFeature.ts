import type { BridgeService } from "../app/BridgeService";
import type { ViewingFeature } from "../viewing/ViewingFeature";
import type { ViewingAppendResult } from "../viewing/viewingTypes";
import { LiveConnection } from "./LiveConnection";
import { LiveEvents } from "./LiveEvents";
import { LiveLineParser } from "./LiveLineParser";
import { LiveMetrics } from "./LiveMetrics";
import { LivePreferences } from "./LivePreferences";
import { LiveProject } from "./LiveProject";
import { LiveSession } from "./LiveSession";
import { LiveStream } from "./LiveStream";

export class LiveFeature {
  readonly events = new LiveEvents();
  readonly preferences: LivePreferences;
  readonly metrics: LiveMetrics;
  readonly project: LiveProject;
  readonly stream: LiveStream;
  readonly connection: LiveConnection;

  readonly #session = new LiveSession();
  #initializePromise: Promise<void> | null = null;

  constructor(
    private readonly viewing: ViewingFeature,
    bridge: BridgeService,
  ) {
    const parser = new LiveLineParser();
    this.preferences = new LivePreferences(this.#session, this.events);
    this.metrics = new LiveMetrics();
    this.project = new LiveProject(bridge, this.events);
    this.stream = new LiveStream(this.#session, this.events, bridge, viewing, parser, this.metrics);
    this.connection = new LiveConnection(
      this.#session,
      this.events,
      bridge,
      this.project,
      this.stream,
      viewing,
      parser,
    );

    this.events.connectionChanged.subscribe(() => this.syncViewingLiveState());
    this.events.streamChanged.subscribe(() => this.syncViewingLiveState());
    this.events.projectChanged.subscribe((event) => {
      if (event.valid && this.connection.state === "disconnected") void this.connection.connect();
      else if (!event.valid && this.connection.connected) void this.connection.disconnect();
    });
  }

  initialize(): Promise<void> {
    if (!this.#initializePromise) {
      this.#initializePromise = this.project.loadBackendPath()
        .then(async () => {
          if (this.project.valid) await this.connection.connect();
        })
        .catch((error) => {
          console.warn("Live initialization failed:", error);
        });
    }
    return this.#initializePromise;
  }

  loadCapture(text: string): ViewingAppendResult {
    return this.stream.loadCapture(text);
  }

  async start(): Promise<boolean> {
    await this.initialize();
    if (!this.connection.connected && !(await this.connection.connect())) return false;
    return this.stream.start();
  }

  stop(options: Readonly<{ force?: boolean }> = {}): Promise<boolean> {
    return this.stream.stop(options);
  }

  reset(): void {
    this.stream.reset();
    this.events.consoleChanged.emit({ kind: "reset" });
  }

  finalizeTelemetry(): Promise<void> {
    return this.metrics.finalizeTelemetry();
  }

  private syncViewingLiveState(): void {
    const streaming = this.stream.streaming || this.stream.state === "stopping";
    this.viewing.navigation.setLiveState(streaming, streaming);
  }
}

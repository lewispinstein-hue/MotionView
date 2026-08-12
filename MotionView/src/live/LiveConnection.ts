import type { BridgeService } from "../app/BridgeService";
import type { ViewingFeature } from "../viewing/ViewingFeature";
import type { LiveEvents } from "./LiveEvents";
import type { LiveLineParser } from "./LiveLineParser";
import type { LiveProject } from "./LiveProject";
import type { LiveSession } from "./LiveSession";
import type { LiveStream } from "./LiveStream";
import type { LiveConnectionState } from "./liveTypes";

export class LiveConnection {
  #command: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly session: LiveSession,
    private readonly events: LiveEvents,
    private readonly bridge: BridgeService,
    private readonly project: LiveProject,
    private readonly stream: LiveStream,
    private readonly viewing: ViewingFeature,
    private readonly parser: LiveLineParser,
  ) {}

  get state(): LiveConnectionState { return this.session.connectionState; }
  get connected(): boolean { return this.state === "connected"; }

  connect(): Promise<boolean> {
    return this.serialize(async () => {
      if (this.connected) return true;
      if (this.project.path && !this.project.valid && !(await this.project.validate())) return false;
      if (!this.project.valid) {
        this.appendConsole("Something went wrong. Try restarting the application or waiting.");
        this.events.notice.emit({ kind: "error", message: "Cannot connect: set a valid PROS directory in Settings first." });
        return false;
      }
      const websocketOrigin = (await this.bridge.resolveOrigin()) && this.bridge.websocketOrigin;
      if (!websocketOrigin) {
        this.appendConsole("[UI] Child process Bridge.py was not given a port. Live streaming cannot start.");
        return false;
      }
      if (!(await this.bridge.waitUntilReady(6_000, 200))) {
        this.appendConsole("[UI] Backend is still starting. Please try again in a moment.");
        return false;
      }

      this.viewing.playback.pause();
      if (this.session.socket) return false;
      this.setState("connecting");
      const connected = await this.openSocket(`${websocketOrigin}/ws`);
      if (!connected) this.setState("disconnected");
      return connected;
    });
  }

  disconnect(): Promise<void> {
    return this.serialize(async () => {
      if (this.state === "disconnected" && !this.session.socket) return;
      if (this.stream.streaming) await this.stream.stop();
      this.setState("disconnecting");
      const socket = this.session.socket;
      this.session.socket = null;
      if (socket) {
        try { socket.close(); } catch { /* best effort */ }
      }
      await this.stream.connectionClosed();
      this.setState("disconnected");
      this.appendConsole("[UI] Disconnected");
    });
  }

  private openSocket(url: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const socket = new WebSocket(url);
      this.session.socket = socket;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch { /* best effort */ }
        if (this.session.socket === socket) this.session.socket = null;
        resolve(false);
      }, 6_000);

      socket.addEventListener("open", () => {
        if (this.session.socket !== socket) return;
        clearTimeout(timeout);
        settled = true;
        this.setState("connected");
        this.stream.connectionOpened();
        this.appendConsole("[UI] Connected");
        resolve(true);
      });
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string" || !this.stream.acceptingData) return;
        const tagged = this.parser.classify(event.data);
        if (tagged) this.session.pending.push(tagged);
        const parsedWaypoint = tagged.startsWith("[WPOINT],") ? this.parser.parseWaypointLine(tagged) : null;
        const malformedWaypoint = parsedWaypoint?.malformed === true;
        const color = tagged && !malformedWaypoint ? "\x1b[32m" : "\x1b[31m";
        const displayLine = parsedWaypoint?.waypointEvent
          ? this.parser.formatWaypointLine(parsedWaypoint.waypointEvent)
          : event.data;
        this.appendConsole(`${color}|\x1b[0m ${displayLine}`);
      });
      socket.addEventListener("error", () => {
        this.appendConsole("[WS] error");
      });
      socket.addEventListener("close", () => {
        clearTimeout(timeout);
        if (this.session.socket === socket) this.session.socket = null;
        const wasActive = this.state !== "disconnected";
        void this.stream.connectionClosed().finally(() => {
          this.setState("disconnected");
          if (wasActive) this.appendConsole("[UI] Disconnected");
        });
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });
    });
  }

  private setState(next: LiveConnectionState): void {
    const previous = this.session.connectionState;
    if (previous === next) return;
    this.session.connectionState = next;
    this.events.connectionChanged.emit({ previous, current: next });
  }

  private appendConsole(line: string): void {
    this.events.consoleChanged.emit({ kind: "append", line });
  }

  private serialize<T>(command: () => Promise<T>): Promise<T> {
    const run = this.#command.catch(() => undefined).then(command);
    this.#command = run;
    return run;
  }
}

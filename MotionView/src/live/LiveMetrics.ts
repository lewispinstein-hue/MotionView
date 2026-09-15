import { liveTelemetry } from "../telemetry/createTelemetry";
import type { LiveCounts } from "./liveCore";

export class LiveMetrics {
  #poses = 0;
  #watches = 0;
  #logs = 0;
  #waypoints = 0;
  #finalized = false;

  accept(counts: Readonly<LiveCounts>): void {
    this.#poses += counts.posesAdded;
    this.#watches += counts.watchesAdded;
    this.#logs += counts.logsAdded;
    this.#waypoints += counts.waypointsAdded;
  }

  async finalizeTelemetry(): Promise<void> {
    if (this.#finalized) return;
    this.#finalized = true;
    await liveTelemetry.totalStreamingDuration();
    await liveTelemetry.livestreamMetrics({
      totalPosesReceived: this.#poses,
      totalLogsReceived: this.#logs,
      totalWatchesReceived: this.#watches,
      totalWaypointsReceived: this.#waypoints,
    });
  }
}


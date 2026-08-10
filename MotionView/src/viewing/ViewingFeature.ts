import type { WatchEntry } from "../state/models";
import { ViewingEvents } from "./viewingEvents";
import { ViewingNavigation } from "./ViewingNavigation";
import { ViewingPlayback } from "./viewingPlayback";
import { ViewingProjection } from "./ViewingProjection";
import { ViewingSession } from "./viewingSession";
import type {
  ParsedLiveViewingBatch,
  ViewingAppendResult,
  ViewingDataReader,
  ViewingDataSink,
  ViewingExportView,
} from "./viewingTypes";

export class ViewingFeature implements ViewingDataSink {
  readonly events = new ViewingEvents();
  readonly data: ViewingDataReader;
  readonly navigation: ViewingNavigation;
  readonly projection: ViewingProjection;
  readonly playback: ViewingPlayback;
  readonly #session: ViewingSession;

  constructor() {
    this.#session = new ViewingSession(this.events);
    this.data = this.#session;
    this.navigation = new ViewingNavigation(this.data, this.events);
    this.projection = new ViewingProjection(this.data, this.events);
    this.playback = new ViewingPlayback(this.data, this.navigation, this.projection, this.events);
  }

  load(data: unknown): void {
    this.#session.load(data);
  }

  loadParsedBatch(batch: ParsedLiveViewingBatch): ViewingAppendResult {
    return this.#session.loadParsedBatch(batch);
  }

  appendLiveBatch(batch: ParsedLiveViewingBatch): ViewingAppendResult {
    return this.#session.appendLiveBatch(batch);
  }

  clear(): void {
    this.#session.clear();
  }

  setWatchVisibility(watch: Readonly<WatchEntry>, visible: boolean): void {
    this.#session.setWatchVisibility(watch, visible);
  }

  setSpeedRange(minimum: number, maximum: number): void {
    this.#session.setSpeedRange(minimum, maximum);
  }

  exportData(): ViewingExportView {
    return this.#session.exportData();
  }
}

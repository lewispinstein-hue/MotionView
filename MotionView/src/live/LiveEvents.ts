import { TypedEvent } from "../app/typedEvent";
import type {
  LiveBatchAcceptedEvent,
  LiveConnectionChangedEvent,
  LiveConsoleEvent,
  LiveNoticeEvent,
  LivePreferencesChangedEvent,
  LiveProjectChangedEvent,
  LiveStreamChangedEvent,
} from "./liveTypes";

export class LiveEvents {
  readonly connectionChanged = new TypedEvent<LiveConnectionChangedEvent>();
  readonly streamChanged = new TypedEvent<LiveStreamChangedEvent>();
  readonly projectChanged = new TypedEvent<LiveProjectChangedEvent>();
  readonly preferencesChanged = new TypedEvent<LivePreferencesChangedEvent>();
  readonly consoleChanged = new TypedEvent<LiveConsoleEvent>();
  readonly batchAccepted = new TypedEvent<LiveBatchAcceptedEvent>();
  readonly notice = new TypedEvent<LiveNoticeEvent>();
}


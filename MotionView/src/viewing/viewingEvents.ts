import { TypedEvent } from "../app/typedEvent";
import type { ViewingDataChangedEvent, ViewingNavigationChangedEvent, ViewingPlaybackChangedEvent, ViewingProjectionChangedEvent } from "./viewingTypes";

export class ViewingEvents {
  readonly dataChanged = new TypedEvent<ViewingDataChangedEvent>();
  readonly navigationChanged = new TypedEvent<ViewingNavigationChangedEvent>();
  readonly playbackChanged = new TypedEvent<ViewingPlaybackChangedEvent>();
  readonly projectionChanged = new TypedEvent<ViewingProjectionChangedEvent>();
}

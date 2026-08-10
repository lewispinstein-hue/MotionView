import { TypedEvent } from "../app/typedEvent";
import type { ViewingDataChangedEvent } from "./viewingTypes";

export class ViewingEvents {
  readonly dataChanged = new TypedEvent<ViewingDataChangedEvent>();
}

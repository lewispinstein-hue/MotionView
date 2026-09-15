import { TypedEvent } from "../../app/typedEvent";

export class FieldRendererEvents {
  readonly fieldImageLoaded = new TypedEvent<{ readonly fieldKey: string }>();
  readonly robotImageAvailabilityChanged = new TypedEvent<{ readonly available: boolean }>();
}

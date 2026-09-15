import { TypedEvent } from "./typedEvent";

export type AppLifecycleState =
  | "created"
  | "starting"
  | "started"
  | "ready"
  | "exiting"
  | "exited";

export type AppExitReason = "window-close" | "backend-request" | "keyboard";

export interface AppLifecycleChangedEvent {
  previous: AppLifecycleState;
  current: AppLifecycleState;
  exitReason: AppExitReason | null;
}

export interface AppVersionChangedEvent {
  version: string;
}

export class AppEvents {
  readonly lifecycleChanged = new TypedEvent<AppLifecycleChangedEvent>();
  readonly versionChanged = new TypedEvent<AppVersionChangedEvent>();
}

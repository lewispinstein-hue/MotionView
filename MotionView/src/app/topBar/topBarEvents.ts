import { TypedEvent } from "../typedEvent";

export type TopBarActionRequestedEvent =
  | { readonly kind: "file-selected"; readonly file: File | null; readonly input: HTMLInputElement }
  | { readonly kind: "robot-image-selected"; readonly file: File | null; readonly input: HTMLInputElement }
  | { readonly kind: "clear-requested"; readonly clearAll: boolean }
  | { readonly kind: "settings-requested" }
  | { readonly kind: "help-requested" };

export type TopBarSettingsChangedEvent =
  | { readonly kind: "playback-speed"; readonly speed: number }
  | { readonly kind: "field"; readonly fieldKey: string };

export class TopBarEvents {
  readonly actionRequested = new TypedEvent<TopBarActionRequestedEvent>();
  readonly settingsChanged = new TypedEvent<TopBarSettingsChangedEvent>();
}

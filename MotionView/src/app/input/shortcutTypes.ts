export type ShortcutScope = "app" | "viewing" | "planning" | "live";
export type ShortcutHelpGroup = "Global" | "Viewing" | "Planning";

export interface ShortcutChord {
  readonly key?: string;
  readonly code?: string;
  readonly primary?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export interface ShortcutDefinition {
  readonly id: string;
  readonly scope: ShortcutScope;
  readonly keys: readonly ShortcutChord[];
  readonly display: string;
  readonly label: string;
  readonly helpGroup: ShortcutHelpGroup;
}

export function matchesShortcut(event: KeyboardEvent, definition: ShortcutDefinition): boolean {
  return definition.keys.some((chord) => {
    if (chord.key !== undefined && event.key.toLowerCase() !== chord.key.toLowerCase()) return false;
    if (chord.code !== undefined && event.code !== chord.code) return false;
    if (chord.primary !== undefined && (event.metaKey || event.ctrlKey) !== chord.primary) return false;
    if (chord.shift !== undefined && event.shiftKey !== chord.shift) return false;
    if (chord.alt !== undefined && event.altKey !== chord.alt) return false;
    return true;
  });
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)
    && target.isConnected
    && target.closest("[hidden]") == null;
}

import type { ShortcutDefinition } from "./shortcutTypes";

const shortcut = (definition: ShortcutDefinition): ShortcutDefinition => definition;
const noModifiers = { primary: false, shift: false, alt: false } as const;
const primary = { primary: true, shift: false, alt: false } as const;

export const APP_SHORTCUTS = {
  fitField: shortcut({ id: "fit-field", scope: "app", keys: [{ key: "f" }], display: "F", label: "Fit/reset field position", helpGroup: "Global" }),
  viewingMode: shortcut({ id: "viewing-mode", scope: "app", keys: [{ key: "1", ...primary }], display: "Cmd/Ctrl + 1", label: "Switch to Viewing mode", helpGroup: "Global" }),
  planningMode: shortcut({ id: "planning-mode", scope: "app", keys: [{ key: "2", ...primary }], display: "Cmd/Ctrl + 2", label: "Switch to Planning mode", helpGroup: "Global" }),
  clearAll: shortcut({ id: "clear-all", scope: "app", keys: [{ key: "k", primary: true, shift: true, alt: false }], display: "Cmd/Ctrl + Shift + K", label: "Clear everything (field + plan)", helpGroup: "Global" }),
  toggleRightSidebar: shortcut({ id: "toggle-right-sidebar", scope: "app", keys: [{ key: "b", primary: true, shift: true, alt: false }], display: "Cmd/Ctrl + Shift + B", label: "Toggle right sidebar", helpGroup: "Global" }),
  toggleTimeline: shortcut({ id: "toggle-timeline", scope: "app", keys: [{ key: "m", ...primary }], display: "Cmd/Ctrl + M", label: "Toggle timeline", helpGroup: "Global" }),
  openFile: shortcut({ id: "open-file", scope: "app", keys: [{ key: "o", ...primary }], display: "Cmd/Ctrl + O", label: "Import a run", helpGroup: "Viewing" }),
  clearCurrent: shortcut({ id: "clear-current", scope: "app", keys: [{ key: "k", ...primary }], display: "Cmd/Ctrl + K", label: "Clear current mode", helpGroup: "Planning" }),
  toggleLeftSidebar: shortcut({ id: "toggle-left-sidebar", scope: "app", keys: [{ key: "b", ...primary }], display: "Cmd/Ctrl + B", label: "Toggle left sidebar", helpGroup: "Viewing" }),
  togglePlanOverlay: shortcut({ id: "toggle-plan-overlay", scope: "app", keys: [{ key: "p", ...noModifiers }], display: "P", label: "Toggle Planned Overlay", helpGroup: "Viewing" }),
} as const;

export const VIEWING_SHORTCUTS = {
  floatingInfo: shortcut({ id: "floating-info", scope: "viewing", keys: [{ key: "t", ...noModifiers }], display: "T", label: "Toggle Floating Info panel", helpGroup: "Viewing" }),
  watchGraph: shortcut({ id: "watch-graph", scope: "viewing", keys: [{ key: "g", ...noModifiers }], display: "G", label: "Toggle Floating Graph", helpGroup: "Viewing" }),
  floatingWatch: shortcut({ id: "floating-watch", scope: "viewing", keys: [{ key: "n", primary: false, shift: true, alt: false }], display: "Shift + N", label: "Open pinned watch panel", helpGroup: "Viewing" }),
  clearDetails: shortcut({ id: "clear-viewing-details", scope: "viewing", keys: [{ key: "Escape" }], display: "Escape", label: "Clear selected waypoint details", helpGroup: "Viewing" }),
  playback: shortcut({ id: "viewing-playback", scope: "viewing", keys: [{ code: "Space" }], display: "Space", label: "Play/Pause playback (or toggle Auto-follow Head when live-connected)", helpGroup: "Viewing" }),
  previousPose: shortcut({ id: "previous-pose", scope: "viewing", keys: [{ code: "ArrowLeft" }], display: "← / →", label: "Step to previous/next pose", helpGroup: "Viewing" }),
  nextPose: shortcut({ id: "next-pose", scope: "viewing", keys: [{ code: "ArrowRight" }], display: "", label: "", helpGroup: "Viewing" }),
} as const;

export const LIVE_SHORTCUTS = {
  toggleStreaming: shortcut({ id: "toggle-streaming", scope: "live", keys: [{ key: "s", ...primary }], display: "Cmd/Ctrl + S", label: "Start/stop live streaming", helpGroup: "Viewing" }),
  refresh: shortcut({ id: "refresh-stream", scope: "live", keys: [{ key: "r", ...primary }], display: "Cmd/Ctrl + R", label: "Refresh & sync livestream (if streaming)", helpGroup: "Viewing" }),
} as const;

export const PLANNING_SHORTCUTS = {
  playback: shortcut({ id: "planning-playback", scope: "planning", keys: [{ code: "Space" }], display: "Space", label: "Play/Pause plan playback", helpGroup: "Planning" }),
  remove: shortcut({ id: "planning-remove", scope: "planning", keys: [{ key: "Delete" }, { key: "Backspace" }], display: "Delete / Backspace", label: "Delete selected waypoint(s) or node", helpGroup: "Planning" }),
  nudge: shortcut({ id: "planning-nudge", scope: "planning", keys: [{ code: "ArrowLeft", shift: false }, { code: "ArrowRight", shift: false }, { code: "ArrowUp", shift: false }, { code: "ArrowDown", shift: false }], display: "← / → / ↑ / ↓", label: "Nudge selected waypoint(s)", helpGroup: "Planning" }),
  nudgeFast: shortcut({ id: "planning-nudge-fast", scope: "planning", keys: [{ code: "ArrowLeft", shift: true }, { code: "ArrowRight", shift: true }, { code: "ArrowUp", shift: true }, { code: "ArrowDown", shift: true }], display: "Shift + ←/→/↑/↓", label: "Nudge selected waypoint(s) by 5× normal", helpGroup: "Planning" }),
  undo: shortcut({ id: "planning-undo", scope: "planning", keys: [{ key: "z", primary: true, shift: false, alt: false }], display: "Cmd/Ctrl + Z", label: "Undo", helpGroup: "Planning" }),
  redo: shortcut({ id: "planning-redo", scope: "planning", keys: [{ key: "z", primary: true, shift: true, alt: false }, { key: "y", primary: true, shift: false, alt: false }], display: "Cmd/Ctrl + Shift + Z", label: "Redo", helpGroup: "Planning" }),
} as const;

export const SHORTCUT_CATALOG: readonly ShortcutDefinition[] = [
  APP_SHORTCUTS.fitField,
  APP_SHORTCUTS.viewingMode,
  APP_SHORTCUTS.planningMode,
  APP_SHORTCUTS.clearAll,
  APP_SHORTCUTS.toggleRightSidebar,
  APP_SHORTCUTS.toggleTimeline,
  APP_SHORTCUTS.openFile,
  LIVE_SHORTCUTS.toggleStreaming,
  LIVE_SHORTCUTS.refresh,
  APP_SHORTCUTS.toggleLeftSidebar,
  APP_SHORTCUTS.togglePlanOverlay,
  VIEWING_SHORTCUTS.floatingInfo,
  VIEWING_SHORTCUTS.watchGraph,
  VIEWING_SHORTCUTS.floatingWatch,
  VIEWING_SHORTCUTS.playback,
  VIEWING_SHORTCUTS.previousPose,
  PLANNING_SHORTCUTS.playback,
  PLANNING_SHORTCUTS.remove,
  PLANNING_SHORTCUTS.nudge,
  PLANNING_SHORTCUTS.nudgeFast,
  PLANNING_SHORTCUTS.undo,
  PLANNING_SHORTCUTS.redo,
  APP_SHORTCUTS.clearCurrent,
];

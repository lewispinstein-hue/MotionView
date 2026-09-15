import { APP_SHORTCUTS } from "./shortcutCatalog";
import { isTypingTarget, matchesShortcut } from "./shortcutTypes";
import type { AppCommands } from "./AppCommands";

/** Translates global shortcuts into application commands. */
export class AppInput {
  #bound = false;

  constructor(private readonly commands: AppCommands) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    document.addEventListener("keydown", (event) => this.handleKeydown(event));
  }

  handleKeydown(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || isTypingTarget(event.target)) return false;
    const run = (command: () => void): true => {
      event.preventDefault();
      command();
      return true;
    };
    if (matchesShortcut(event, APP_SHORTCUTS.toggleTimeline)) return run(() => this.commands.toggleTimeline());
    if (matchesShortcut(event, APP_SHORTCUTS.toggleLeftSidebar)) return run(() => this.commands.toggleLeftSidebar());
    if (matchesShortcut(event, APP_SHORTCUTS.toggleRightSidebar)) return run(() => this.commands.toggleRightSidebar());
    if (matchesShortcut(event, APP_SHORTCUTS.viewingMode)) return run(() => this.commands.setViewingMode());
    if (matchesShortcut(event, APP_SHORTCUTS.planningMode)) return run(() => this.commands.setPlanningMode());
    if (matchesShortcut(event, APP_SHORTCUTS.openFile)) return run(() => this.commands.openRoute());
    if (matchesShortcut(event, APP_SHORTCUTS.clearCurrent)) return run(() => void this.commands.clearCurrent());
    if (matchesShortcut(event, APP_SHORTCUTS.clearAll)) return run(() => void this.commands.clearAll());
    if (matchesShortcut(event, APP_SHORTCUTS.togglePlanOverlay)) return run(() => this.commands.togglePlanningOverlay());
    if (matchesShortcut(event, APP_SHORTCUTS.fitField)) return run(() => this.commands.fitField());
    return false;
  }
}

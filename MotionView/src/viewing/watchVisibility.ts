import type { WatchEntry } from "../state/models";
import type { WatchMarker } from "./viewingTypes";

export interface WatchVisibilityController {
  keyForWatch(watch: WatchEntry | null | undefined): string;
  filterKeyForWatch(watch: WatchEntry | null | undefined): string;
  filterMatches(watch: WatchEntry | null | undefined): boolean;
  filterLabelForWatch(watch: WatchEntry | null | undefined): string;
  isWatchVisible(watch: WatchEntry | null | undefined): boolean;
  isMarkerVisible(marker: WatchMarker | null | undefined): boolean;
  iconId(watch: Partial<WatchEntry> | null | undefined): string;
  title(watch: Partial<WatchEntry> | null | undefined): string;
  currentVisibilityForWatch(watch: WatchEntry | null | undefined): boolean;
  toggleWatchVisibilityForWatch(watch: WatchEntry | null | undefined): void;
}

export interface CreateWatchVisibilityOptions {
  getWatches(): readonly WatchEntry[];
  getFilterValue(): string;
  graphKeyForWatch(watch: WatchEntry | null | undefined): string;
  updateButtons(key: string, iconId: string, title: string): void;
}

export function createWatchVisibility(options: CreateWatchVisibilityOptions): WatchVisibilityController {
  const isWatchVisible = (watch: Partial<WatchEntry> | null | undefined) => watch?.visible !== false;

  const keyForWatch = (watch: WatchEntry | null | undefined) => {
    const idNum = Number(watch?.id);
    if (Number.isInteger(idNum)) return `id:${idNum}`;
    return `entry:${Number(watch?.t)}`;
  };

  const filterKeyForWatch = (watch: WatchEntry | null | undefined) => options.graphKeyForWatch(watch);

  const filterMatches = (watch: WatchEntry | null | undefined) => {
    const filter = options.getFilterValue();
    if (filter === "all") return true;
    return filterKeyForWatch(watch) === filter;
  };

  const filterLabelForWatch = (watch: WatchEntry | null | undefined) => {
    const idNum = Number(watch?.id);
    const hasId = Number.isInteger(idNum);
    const label = String(watch?.label ?? "").trim();
    if (hasId && label) return `${label}`;
    if (hasId) return `Watch ${idNum}`;
    return label || "Unnamed Watch";
  };

  const iconId = (watch: Partial<WatchEntry> | null | undefined) => (
    isWatchVisible(watch) ? "icon-visibleWatch" : "icon-invisibleWatch"
  );

  const title = (watch: Partial<WatchEntry> | null | undefined) => (
    isWatchVisible(watch) ? "Hide watch" : "Show watch"
  );

  const currentVisibilityForWatch = (watch: WatchEntry | null | undefined) => {
    const key = keyForWatch(watch);
    const watches = options.getWatches();
    for (let i = watches.length - 1; i >= 0; i -= 1) {
      const candidate = watches[i];
      if (keyForWatch(candidate) !== key) continue;
      return isWatchVisible(candidate);
    }
    return true;
  };

  return {
    keyForWatch,
    filterKeyForWatch,
    filterMatches,
    filterLabelForWatch,
    isWatchVisible,
    isMarkerVisible(marker) {
      return isWatchVisible(marker?.watch) && filterMatches(marker?.watch);
    },
    iconId,
    title,
    currentVisibilityForWatch,
    toggleWatchVisibilityForWatch(watch) {
      if (!watch) return;
      const key = keyForWatch(watch);
      const nextVisible = !isWatchVisible(watch);

      for (const candidate of options.getWatches()) {
        if (keyForWatch(candidate) !== key) continue;
        candidate.visible = nextVisible;
      }

      const nextWatch = { visible: nextVisible };
      options.updateButtons(key, iconId(nextWatch), title(nextWatch));
    },
  };
}

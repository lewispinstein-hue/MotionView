import type { WatchMarker } from "./viewingTypes";

export function sortWatchMarkersByTime(markers: WatchMarker[]) {
  return markers.slice().sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

export function lastWatchAtTime(markersByTime: WatchMarker[], tMs: number) {
  if (!markersByTime.length) return null;
  let lo = 0;
  let hi = markersByTime.length - 1;
  if ((markersByTime[0].t ?? 0) > tMs) return null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const tm = markersByTime[mid].t ?? 0;
    if (tm <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return markersByTime[lo] || null;
}

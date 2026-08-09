export type StatusListener = (message: string) => void;

let currentStatus = "";
const statusListeners = new Set<StatusListener>();

export function setStatus(message: unknown, log = true): void {
  currentStatus = String(message ?? "");
  for (const listener of statusListeners) listener(currentStatus);
  if (log) console.log(`Status: ${message}`);
}

export function getStatus(): string {
  return currentStatus;
}

export function subscribeStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

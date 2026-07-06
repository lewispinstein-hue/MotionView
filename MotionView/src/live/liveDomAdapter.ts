export interface LiveUiState {
  connected: boolean;
  streaming: boolean;
  actionInFlight: boolean;
}

export interface LiveButtonElements {
  connectButton: HTMLButtonElement | null;
  startStopButton: HTMLButtonElement | null;
  refreshButton: HTMLButtonElement | null;
  playButton: HTMLButtonElement | null;
  fileButton: HTMLButtonElement | null;
}

export function applyLiveButtonState(elements: LiveButtonElements, state: LiveUiState) {
  const { connected, streaming, actionInFlight } = state;

  if (elements.connectButton) {
    elements.connectButton.classList.toggle("isOn", connected);
    elements.connectButton.textContent = connected ? "Disconnect" : "Connect";
    elements.connectButton.title = connected ? "Disconnect" : "Connect";
    elements.connectButton.disabled = actionInFlight || elements.connectButton.disabled;
  }

  if (elements.playButton) {
    elements.playButton.disabled = connected;
  }

  if (elements.fileButton) {
    elements.fileButton.disabled = connected;
  }

  if (elements.startStopButton) {
    elements.startStopButton.disabled = !connected || actionInFlight;
    elements.startStopButton.textContent = streaming ? "Stop" : "Start";
    elements.startStopButton.classList.toggle("isOn", streaming);
    elements.startStopButton.title = connected
      ? (streaming ? "Stop streaming. Cmd/Ctrl+Click to force kill." : "Starts streaming.")
      : "Starts streaming. Connect to start.";
  }

  if (elements.refreshButton) {
    elements.refreshButton.disabled = !connected || actionInFlight;
  }
}

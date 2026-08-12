function element<T extends HTMLElement>(root: Document, id: string): T | null {
  return root.getElementById(id) as T | null;
}

export class LiveDom {
  private constructor(
    readonly startStopButton: HTMLButtonElement | null,
    readonly refreshButton: HTMLButtonElement | null,
    readonly refreshInterval: HTMLSelectElement | null,
    readonly console: HTMLElement | null,
    readonly fileButton: HTMLButtonElement | null,
    readonly playButton: HTMLButtonElement | null,
    readonly projectInput: HTMLInputElement | null,
    readonly autoDetectButton: HTMLButtonElement | null,
    readonly projectStatus: HTMLElement | null,
    readonly autoStatus: HTMLElement | null,
    readonly autoResults: HTMLElement | null,
  ) {}

  static from(root: Document): LiveDom {
    return new LiveDom(
      element(root, "btnLeftStream"),
      element(root, "btnLeftRefresh"),
      element(root, "leftRefreshInterval"),
      element(root, "liveWin"),
      element(root, "btnFile"),
      element(root, "btnPlay"),
      element(root, "prosDirInput"),
      element(root, "btnProsDirAuto"),
      element(root, "prosDirStatus"),
      element(root, "prosDirAutoStatus"),
      element(root, "prosDirAutoResults"),
    );
  }
}

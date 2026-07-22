import type { VirtualList } from "./virtualList";

export interface PoseListRendererDependencies {
  poseList: HTMLElement | null;
  poseCount: HTMLElement | null;
  poseListVirtual: VirtualList<unknown> | null;
  getPoseCount(): number;
  getPose(index: number): any;
  getSelectedIndex(): number;
  poseToInches(pose: any): { x: number; y: number; theta: number };
  formatNumberString(value: unknown, decimals?: number, fallback?: string): string;
  fmtNum(value: unknown, decimals?: number): string;
  escapeHtml(value: unknown): string;
  onPoseSelected(index: number): void;
}

export interface PoseListRenderer {
  createItem(index: number): HTMLElement;
  render(): void;
  highlight(): void;
}

export function createPoseListRenderer(deps: PoseListRendererDependencies): PoseListRenderer {
  function createItem(index: number) {
    const pose = deps.getPose(index);
    const time = typeof pose?.t === "number" ? Math.round(pose.t) : null;
    const poseInches = deps.poseToInches(pose);
    const poseSummary = `X: ${deps.formatNumberString(poseInches.x, 1, "0")}in, Y: ${deps.formatNumberString(poseInches.y, 1, "0")}in, θ: ${deps.formatNumberString(poseInches.theta, 1, "0")}°`;

    const div = document.createElement("div");
    div.className = "poseItem";
    if (index === deps.getSelectedIndex()) div.classList.add("selected");
    div.dataset.idx = String(index);
    div.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px">
      <div style="font-weight:800">#${index + 1}</div>
      <div class="muted">${time != null ? deps.fmtNum(time / 1000) : "—"}s</div>
    </div>
    <div class="sub">${deps.escapeHtml(poseSummary)}</div>`;
    div.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      deps.onPoseSelected(index);
    }, { passive: false });
    return div;
  }

  function highlight() {
    if (!deps.poseListVirtual) return;
    deps.poseListVirtual.scrollToIndex(deps.getSelectedIndex(), 12);
    deps.poseListVirtual.refresh();
  }

  function render() {
    if (!deps.poseList) return;
    const count = deps.getPoseCount();
    if (!count) {
      if (deps.poseCount) deps.poseCount.textContent = "—";
      deps.poseListVirtual?.setItems([]);
      return;
    }
    if (deps.poseCount) deps.poseCount.textContent = `${count}`;
    deps.poseListVirtual?.setItems({ length: count });
    highlight();
  }

  return {
    createItem,
    render,
    highlight,
  };
}

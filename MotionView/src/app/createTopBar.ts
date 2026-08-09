import type { AppMode } from "./modeController";
import type { FieldOption } from "../render/fieldImages";

export interface TopBarPlaybackState {
  enabled: boolean;
  playing: boolean;
  label: string;
}

export interface TopBarDependencies {
  onOpenFile(file: File | null, input: HTMLInputElement): void | Promise<void>;
  onRobotImageSelected(file: File | null, input: HTMLInputElement): void | Promise<void>;
  onFitField(): void;
  onClearField(event: MouseEvent): void;
  onOpenSettings(): void;
  onOpenHelp(): void;
  onSetMode(mode: AppMode): void;
  onTogglePlayback(): void;
  onPlaybackSpeedChanged(speed: number): void;
  onFieldChanged(fieldKey: string): void | Promise<void>;
}

export interface TopBarController {
  bindEvents(): void;
  setStatus(message: unknown, log?: boolean): void;
  syncMode(mode: AppMode): void;
  syncPlayback(state: TopBarPlaybackState): void;
  syncPlanOverlay(enabled: boolean): void;
  setFieldOptions(fields: readonly FieldOption[], selectedKey: string): void;
  getSelectedField(): string;
  getPlaybackSpeed(): number;
  setPlaybackSpeed(speed: number): void;
  setFieldEnabled(enabled: boolean): void;
  openFilePicker(): void;
  openRobotImagePicker(): void;
  scheduleLayout(): void;
}

const TOP_BAR_CENTER_STATUS_GAP_PX = 16;
const TOP_BAR_CENTER_RIGHT_SCROLL_GAP_PX = 0;

function optionalElement<T extends Element>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function createTopBar(deps: TopBarDependencies): TopBarController {
  const topBarEl = optionalElement<HTMLElement>("topBar");
  const topBarContentEl = document.querySelector<HTMLElement>(".topBarContent");
  const topBarLeftEl = document.querySelector<HTMLElement>(".topBarLeft");
  const topBarCenterEl = document.querySelector<HTMLElement>(".topBarCenter");
  const topBarRightEl = document.querySelector<HTMLElement>(".topBarRight");
  const statusEl = optionalElement<HTMLElement>("status");
  const fileEl = optionalElement<HTMLInputElement>("file");
  const robotImageFileEl = optionalElement<HTMLInputElement>("robotImageFile");
  const btnPlay = optionalElement<HTMLButtonElement>("btnPlay");
  const btnFit = optionalElement<HTMLButtonElement>("btnFit");
  const btnSettings = optionalElement<HTMLButtonElement>("btnSettings");
  const btnClearField = optionalElement<HTMLButtonElement>("btnClearField");
  const btnHelp = optionalElement<HTMLButtonElement>("btnHelp");
  const modeViewingBtn = optionalElement<HTMLButtonElement>("modeViewing");
  const modePlanningBtn = optionalElement<HTMLButtonElement>("modePlanning");
  const speedSelect = optionalElement<HTMLSelectElement>("speedSelect");
  const fieldSelect = optionalElement<HTMLSelectElement>("fieldSelect");

  let topBarMaxObservedWidth = 0;
  let topBarMaxCenteredStatusWidth = 0;
  let topBarSavedScrollLeft = 0;
  let bound = false;

  function updateTopBarStatusLayout() {
    if (!topBarEl || !topBarContentEl || !topBarLeftEl || !topBarCenterEl || !topBarRightEl || !statusEl) return;

    const fullText = statusEl.dataset.fullText ?? statusEl.textContent ?? "";
    const previousScrollLeft = Math.max(topBarSavedScrollLeft, topBarEl.scrollLeft || 0);
    topBarEl.classList.remove("isOverflowing");
    topBarCenterEl.style.left = "50%";
    topBarCenterEl.style.top = "50%";
    statusEl.style.maxWidth = "";
    statusEl.textContent = fullText;
    statusEl.title = "";

    const topBarRect = topBarEl.getBoundingClientRect();
    const centerRect = topBarCenterEl.getBoundingClientRect();
    const rightRect = topBarRightEl.getBoundingClientRect();
    const statusRect = statusEl.getBoundingClientRect();

    const centerWidth = Math.ceil(centerRect.width);
    const idealCenterX = Math.floor(topBarRect.width / 2);
    const idealCenterLeft = idealCenterX - centerWidth / 2;
    const statusStartX = Math.floor(statusRect.left - topBarRect.left);
    const statusNaturalWidth = Math.ceil(statusEl.scrollWidth);

    const centeredStatusMaxWidth = Math.max(0, Math.floor(idealCenterLeft - statusStartX - TOP_BAR_CENTER_STATUS_GAP_PX));
    const currentBarWidth = Math.ceil(topBarRect.width);
    if (currentBarWidth >= topBarMaxObservedWidth) {
      topBarMaxObservedWidth = currentBarWidth;
      topBarMaxCenteredStatusWidth = centeredStatusMaxWidth;
    }

    statusEl.style.maxWidth = `${Math.max(0, centeredStatusMaxWidth)}px`;
    const centeredCurrentlyTruncates = statusEl.scrollWidth > statusEl.clientWidth;
    const centeredCenterRight = idealCenterX + centerWidth / 2;
    const gapToRightWhileCentered = (rightRect.left - topBarRect.left) - centeredCenterRight;

    if (!centeredCurrentlyTruncates && gapToRightWhileCentered >= TOP_BAR_CENTER_RIGHT_SCROLL_GAP_PX) {
      topBarCenterEl.style.left = "50%";
      statusEl.title = "";
      topBarSavedScrollLeft = 0;
      return;
    }

    const preservedStatusWidth = Math.max(centeredStatusMaxWidth, topBarMaxCenteredStatusWidth);
    const desiredStatusWidth = Math.min(statusNaturalWidth, preservedStatusWidth);
    const centeredKeepsStatusUntruncated = centeredStatusMaxWidth >= desiredStatusWidth;

    const minCenterX = Math.ceil(statusStartX + desiredStatusWidth + TOP_BAR_CENTER_STATUS_GAP_PX + centerWidth / 2);
    const shiftedCenterX = Math.max(idealCenterX, minCenterX);
    const shiftedCenterRight = shiftedCenterX + centerWidth / 2;
    const gapToRightAfterShift = (rightRect.left - topBarRect.left) - shiftedCenterRight;

    if (centeredKeepsStatusUntruncated) {
      topBarCenterEl.style.left = "50%";
      statusEl.style.maxWidth = `${Math.max(0, desiredStatusWidth)}px`;
      statusEl.title = "";
      topBarSavedScrollLeft = 0;
      return;
    }

    if (gapToRightAfterShift >= TOP_BAR_CENTER_RIGHT_SCROLL_GAP_PX) {
      topBarCenterEl.style.left = `${shiftedCenterX}px`;
      statusEl.style.maxWidth = `${Math.max(0, desiredStatusWidth)}px`;
      statusEl.title = statusEl.scrollWidth > statusEl.clientWidth ? fullText : "";
      topBarSavedScrollLeft = 0;
      return;
    }

    topBarEl.classList.add("isOverflowing");
    topBarCenterEl.style.left = "";
    topBarCenterEl.style.top = "";
    statusEl.style.maxWidth = `${Math.max(0, desiredStatusWidth)}px`;
    statusEl.textContent = fullText;
    statusEl.title = statusEl.scrollWidth > statusEl.clientWidth ? fullText : "";
    requestAnimationFrame(() => {
      if (!topBarEl?.classList.contains("isOverflowing")) return;
      const maxScrollLeft = Math.max(0, topBarEl.scrollWidth - topBarEl.clientWidth);
      const restoredScrollLeft = Math.min(previousScrollLeft, maxScrollLeft);
      topBarEl.scrollLeft = restoredScrollLeft;
      topBarSavedScrollLeft = restoredScrollLeft;
    });
  }

  const scheduleLayout = (() => {
    let rafId = 0;
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        updateTopBarStatusLayout();
      });
    };
  })();

  function bindEvents() {
    if (bound) return;
    bound = true;

    btnFit?.addEventListener("click", () => deps.onFitField());
    btnSettings?.addEventListener("click", (event) => {
      event.stopPropagation();
      deps.onOpenSettings();
    });
    btnClearField?.addEventListener("click", (event) => deps.onClearField(event));
    btnHelp?.addEventListener("click", (event) => {
      event.stopPropagation();
      deps.onOpenHelp();
    });
    modeViewingBtn?.addEventListener("click", () => deps.onSetMode("viewing"));
    modePlanningBtn?.addEventListener("click", () => deps.onSetMode("planning"));
    btnPlay?.addEventListener("click", () => deps.onTogglePlayback());
    speedSelect?.addEventListener("change", () => deps.onPlaybackSpeedChanged(Number(speedSelect.value) || 1));
    fieldSelect?.addEventListener("change", () => {
      void deps.onFieldChanged(fieldSelect.value);
    });
    fileEl?.addEventListener("change", (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : fileEl;
      void deps.onOpenFile(input.files?.[0] ?? null, input);
    });
    robotImageFileEl?.addEventListener("change", (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : robotImageFileEl;
      void deps.onRobotImageSelected(input.files?.[0] ?? null, input);
    });

    if (typeof ResizeObserver === "function") {
      const topBarResizeObserver = new ResizeObserver(() => scheduleLayout());
      if (topBarEl) topBarResizeObserver.observe(topBarEl);
      if (topBarContentEl) topBarResizeObserver.observe(topBarContentEl);
      if (topBarLeftEl) topBarResizeObserver.observe(topBarLeftEl);
      if (topBarCenterEl) topBarResizeObserver.observe(topBarCenterEl);
      if (topBarRightEl) topBarResizeObserver.observe(topBarRightEl);
    }

    topBarEl?.addEventListener("scroll", () => {
      topBarSavedScrollLeft = topBarEl.scrollLeft || 0;
    }, { passive: true });
  }

  return {
    bindEvents,
    setStatus(message, log = true) {
      const fullText = String(message ?? "");
      if (statusEl) statusEl.dataset.fullText = fullText;
      scheduleLayout();
      if (log) console.log(`Status: ${message}`);
    },
    syncMode(mode) {
      if (modeViewingBtn) {
        const active = mode === "viewing";
        modeViewingBtn.classList.toggle("isActive", active);
        modeViewingBtn.setAttribute("aria-selected", active ? "true" : "false");
      }
      if (modePlanningBtn) {
        const active = mode === "planning";
        modePlanningBtn.classList.toggle("isActive", active);
        modePlanningBtn.setAttribute("aria-selected", active ? "true" : "false");
      }
    },
    syncPlayback(state) {
      if (!btnPlay) return;
      btnPlay.disabled = !state.enabled;
      btnPlay.textContent = state.label;
      btnPlay.setAttribute("aria-pressed", state.playing ? "true" : "false");
    },
    syncPlanOverlay(enabled) {
      const toggle = optionalElement<HTMLButtonElement>("btnTogglePlanOverlay");
      toggle?.classList.toggle("isOn", enabled);
    },
    setFieldOptions(fields, selectedKey) {
      if (!fieldSelect) {
        console.warn("fieldSelect element not found");
        return;
      }
      fieldSelect.innerHTML = "";
      if (!fields.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No fields available";
        opt.disabled = true;
        fieldSelect.appendChild(opt);
        fieldSelect.value = "";
        return;
      }
      for (const field of fields) {
        const opt = document.createElement("option");
        opt.value = field.key;
        opt.textContent = field.label;
        fieldSelect.appendChild(opt);
      }
      fieldSelect.value = selectedKey;
    },
    getSelectedField() {
      return fieldSelect?.value ?? "";
    },
    getPlaybackSpeed() {
      return Number(speedSelect?.value) || 1;
    },
    setPlaybackSpeed(speed) {
      if (speedSelect) speedSelect.value = String(speed);
    },
    setFieldEnabled(enabled) {
      if (fieldSelect) fieldSelect.disabled = !enabled;
    },
    openFilePicker() {
      fileEl?.click();
    },
    openRobotImagePicker() {
      robotImageFileEl?.click();
    },
    scheduleLayout,
  };
}

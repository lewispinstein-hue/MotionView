interface ModalBinding {
  modal: HTMLElement;
  dismiss: () => void;
  open: boolean;
  previousFocus: HTMLElement | null;
}

const bindings: ModalBinding[] = [];
let active: ModalBinding[] = [];
let installed = false;
let syncing = false;
let lastFocus: HTMLElement | null = null;

function visible(element: HTMLElement): boolean {
  return element.isConnected && element.closest("[hidden]") == null &&
    element.style.display !== "none" && element.getClientRects().length > 0;
}

/** Background shortcuts must not act through any visible application modal. */
export function hasOpenModal(): boolean {
  if (typeof document === "undefined") return false;
  return [...document.querySelectorAll<HTMLElement>(".modal, dialog[open]")].some(visible);
}

function focusable(modal: HTMLElement): HTMLElement[] {
  return [...modal.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.tabIndex >= 0 && visible(element));
}

function focusModal(binding: ModalBinding): void {
  const target = focusable(binding.modal)[0] ?? binding.modal.querySelector<HTMLElement>('[role="dialog"]') ?? binding.modal;
  if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

function syncModals(): void {
  if (syncing) return;
  syncing = true;
  try {
    const previous = active.at(-1);
    for (const binding of bindings) {
      const open = visible(binding.modal);
      if (open === binding.open) continue;
      binding.open = open;
      if (open) {
        binding.previousFocus = lastFocus && visible(lastFocus)
          ? lastFocus : previous?.previousFocus ?? null;
        active.push(binding);
      } else {
        active = active.filter((item) => item !== binding);
      }
    }
    const current = active.at(-1);
    if (current && !current.modal.contains(document.activeElement)) {
      const restore = previous && !previous.open ? previous.previousFocus : null;
      if (restore && current.modal.contains(restore) && visible(restore))
        restore.focus({ preventScroll: true });
      else focusModal(current);
    }
    else if (!current && previous && !previous.open && previous.previousFocus && visible(previous.previousFocus))
      previous.previousFocus.focus({ preventScroll: true });
  } finally {
    syncing = false;
  }
}

/** Shared focus/keyboard boundary for all existing modal controllers. */
export function bindModalActivity(modal: HTMLElement, dismiss: () => void): void {
  if (bindings.some((binding) => binding.modal === modal)) return;
  bindings.push({ modal, dismiss, open: false, previousFocus: null });
  if (!installed) {
    installed = true;
    lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.addEventListener("focusin", (event) => {
      syncModals();
      const current = active.at(-1);
      if (current && !current.modal.contains(event.target as Node)) focusModal(current);
      if (document.activeElement instanceof HTMLElement) lastFocus = document.activeElement;
    });
    window.addEventListener("keydown", (event) => {
      syncModals();
      const current = active.at(-1);
      if (!current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        current.dismiss();
        syncModals();
      } else if (event.key === "Tab") {
        const elements = focusable(current.modal);
        const index = elements.indexOf(document.activeElement as HTMLElement);
        if (!elements.length) {
          event.preventDefault();
          focusModal(current);
        } else if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === elements.length - 1)) {
          event.preventDefault();
          elements[event.shiftKey ? elements.length - 1 : 0].focus();
        }
      }
    }, true);
  }
  new MutationObserver(syncModals).observe(modal, {
    attributes: true, attributeFilter: ["hidden", "style", "class"],
  });
  syncModals();
}

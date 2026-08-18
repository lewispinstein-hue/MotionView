/** Closes a modal when its container or backdrop receives the click. */
export function bindModalBackdropDismissal(modal: HTMLElement, dismiss: () => void): void {
  modal.addEventListener("click", (event) => {
    const target = event.target;
    if (target === modal || target instanceof Element && target.classList.contains("modalBackdrop")) {
      dismiss();
    }
  });
}

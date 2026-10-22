/** Closes a modal only when the press and release both happen on its backdrop. */
export function bindModalBackdropDismissal(
  modal: HTMLElement,
  dismiss: () => void,
): void {
  let startedOnBackdrop = false;
  let releasedOnBackdrop = false;
  const isBackdrop = (target: EventTarget | null): boolean =>
    target === modal ||
    (target instanceof Element && target.classList.contains("modalBackdrop"));

  modal.addEventListener("pointerdown", (event) => {
    startedOnBackdrop = isBackdrop(event.target);
    releasedOnBackdrop = false;
  });
  modal.addEventListener("pointerup", (event) => {
    releasedOnBackdrop = isBackdrop(event.target);
  });
  modal.addEventListener("pointercancel", () => {
    startedOnBackdrop = false;
    releasedOnBackdrop = false;
  });
  modal.addEventListener("click", (event) => {
    const shouldDismiss =
      startedOnBackdrop && releasedOnBackdrop && isBackdrop(event.target);
    startedOnBackdrop = false;
    releasedOnBackdrop = false;
    if (shouldDismiss) dismiss();
  });
}

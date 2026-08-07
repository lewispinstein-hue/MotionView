import type { ViewingInput } from "./viewingTypes";

export function createViewingInput(): ViewingInput {
  return {
    bindEvents() {},
    handleKeydown() {
      return false;
    },
  };
}

export type TypedEventListener<T> = (event: Readonly<T>) => void;

export class TypedEvent<T> {
  readonly #listeners = new Set<TypedEventListener<T>>();

  subscribe(listener: TypedEventListener<T>): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(event: Readonly<T>): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error("MotionView event listener failed:", error);
      }
    }
  }
}

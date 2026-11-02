import type { PlanningSimulationRequest, PlanningSimulationResult } from "./planningSimulationTypes";

export interface PlanningSimulationJob {
  readonly signature: string;
  readonly pathId: string;
  readonly generation: number;
  readonly request: PlanningSimulationRequest;
}

/** One worker, one running request, and at most one newer pending request. */
export class PlanningSimulationWorker {
  #worker: Worker | null = null;
  #running: PlanningSimulationJob | null = null;
  #queued: PlanningSimulationJob | null = null;
  #seed: PlanningSimulationResult | undefined;

  constructor(
    private readonly completed: (job: PlanningSimulationJob, result: PlanningSimulationResult) => void,
    private readonly failed: (job: PlanningSimulationJob) => void,
  ) {}

  request(job: PlanningSimulationJob, seed: PlanningSimulationResult): void {
    // Releasing a drag can request the same input that is already running.
    this.#queued = this.#running?.signature === job.signature ? null : job;
    this.#seed = seed;
    this.dispatch();
  }

  clearQueued(): void { this.#queued = null; }

  private dispatch(): void {
    if (this.#running || !this.#queued) return;
    const job = this.#queued;
    this.#queued = null;
    this.#running = job;
    try {
      const fresh = !this.#worker;
      if (!this.#worker) {
        const worker = new Worker(new URL("./planningSimulation.worker.ts", import.meta.url), { type: "module" });
        this.#worker = worker;
        worker.onmessage = (event: MessageEvent<{ result?: PlanningSimulationResult }>) => {
          if (this.#worker !== worker || !this.#running) return;
          const finished = this.#running;
          this.#running = null;
          if (event.data.result) {
            this.completed(finished, event.data.result);
          } else {
            this.#worker = null;
            worker.terminate();
            this.failed(finished);
          }
          this.dispatch();
        };
        worker.onerror = () => {
          if (this.#worker !== worker || !this.#running) return;
          const failed = this.#running;
          this.#running = null; this.#worker = null;
          worker.terminate();
          this.failed(failed);
          this.dispatch();
        };
      }
      // The worker retains its previous result between updates. Only seed it
      // when starting/restarting, rather than copying a whole route every frame.
      this.#worker.postMessage({ request: job.request, ...(fresh ? { previous: this.#seed } : {}) });
    } catch {
      this.#running = null;
      this.#worker?.terminate(); this.#worker = null;
      this.failed(job);
      this.dispatch();
    }
  }
}

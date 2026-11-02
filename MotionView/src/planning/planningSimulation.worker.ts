import { simulatePlanningRoute } from "./planningSimulation";
import type { PlanningSimulationRequest, PlanningSimulationResult } from "./planningSimulationTypes";
let previous: PlanningSimulationResult | undefined;
self.onmessage = (event: MessageEvent<{ request: PlanningSimulationRequest; previous?: PlanningSimulationResult }>) => {
  try {
    previous = simulatePlanningRoute(event.data.request, previous ?? event.data.previous);
    self.postMessage({ result: previous });
  }
  catch { self.postMessage({ error: "Preview unavailable" }); }
};

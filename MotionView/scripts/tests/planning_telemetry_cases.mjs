import assert from "node:assert/strict";

export async function runPlanningTelemetryTests(server) {
  const { PlanningTelemetry } = await server.ssrLoadModule(
    "/telemetry/planningTelemetry.ts",
  );
  const { TelemetryClient } = await server.ssrLoadModule(
    "/telemetry/telemetryClient.ts",
  );
  const events = [];
  let now = 0;
  let contextReads = 0;
  const client = { capture: async (name, properties) => {
      events.push({ name, properties });
      return true;
    }, queueAutomatic: (name, properties) => {
      events.push({ name, properties });
      return true;
    } };
  const telemetry = new PlanningTelemetry(client, () => now);
  telemetry.setLagContext(() => {
    contextReads += 1;
    return {
      plan_waypoints: 12,
      simulator_model: "lemlib",
      movement_types: ["forward", "boomerang"],
      lead_waypoints: 2,
    };
  });

  telemetry.modeChanged("planning");
  telemetry.recordRender(8);
  telemetry.recordRender(10);
  assert.equal(contextReads, 0, "normal rendering must not inspect route details");
  assert.equal(events.length, 0, "normal frames must not send events");
  now = 4_000;
  telemetry.modeChanged("viewing");
  assert.equal(events.length, 0, "switching modes must not end the session");
  now = 9_000;
  telemetry.modeChanged("planning");
  telemetry.pathCreated();
  telemetry.pathDerived({ source_waypoints: 4, source_nodes: 1, path_count_after: 2 });
  telemetry.pathTransformed();
  telemetry.codeExported({ export_surface: "file", export_library: "lemlib" });
  telemetry.codeExportBlocked({ export_surface: "clipboard", reason: "too_few_waypoints" });
  telemetry.simulationRequested(12, "lemlib");
  telemetry.simulationFinished(9_000, 12, "reached");
  telemetry.simulationRequested(12, "lemlib");
  telemetry.simulationFailed(9_000, 12, "lemlib", "worker_error");
  telemetry.recordRender(40);
  telemetry.recordRender(42);
  telemetry.recordRender(50);
  assert.equal(contextReads, 1, "details are read only after sustained lag");
  const lag = events.find((event) => event.name === "planning_render_lag");
  assert.deepEqual(lag.properties.movement_types, ["forward", "boomerang"]);
  assert.equal(lag.properties.plan_waypoints, 12);
  assert.equal(events.filter((event) => event.name === "planning_render_lag").length, 1);

  now = 14_000;
  await telemetry.sessionEnded({ plan_paths: 2, plan_waypoints_total: 12 });
  await telemetry.sessionEnded({ plan_paths: 999 });
  const summary = events.filter((event) => event.name === "planning_session_ended");
  assert.equal(summary.length, 1, "app-close summary must be idempotent");
  assert.equal(summary[0].properties.planning_visits, 2);
  assert.equal(summary[0].properties.active_seconds, 9);
  assert.equal(summary[0].properties.frames_sampled, 5);
  assert.equal(summary[0].properties.slow_frame_count, 3);
  assert.equal(summary[0].properties.paths_derived, 1);
  assert.equal(summary[0].properties.code_exports, 1);
  const simulation = events.find((event) => event.name === "planning_simulation_summary");
  assert.equal(simulation.properties.requests, 2);
  assert.equal(simulation.properties.completed, 1);
  assert.equal(simulation.properties.worker_failures, 1);
  assert.equal(simulation.properties.latest_preview_outcome, "reached");
  assert.equal(events.filter((event) => event.name === "planning_simulation_failed").length, 1);
  assert.equal(events.filter((event) => event.name === "planning_template_exported").length, 1);

  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const stored = new Map();
  try {
    globalThis.window = { __TAURI_INTERNALS__: {} };
    globalThis.localStorage = {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    };
    const client = new TelemetryClient();
    client.setEnabled(true);
    assert.equal(client.queueAutomatic("planning_session_ended", { paths_created: 1 }), true);
    const queued = JSON.parse(stored.get("motionview.telemetry.queue"));
    assert.equal(queued[0].properties.viewer_session_id, client.getViewerSessionId());
    assert.equal(queued[0].properties.paths_created, 1);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
}

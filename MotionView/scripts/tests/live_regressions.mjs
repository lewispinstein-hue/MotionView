import assert from "node:assert/strict";
import { createServer } from "vite";
import { runLiveShutdownRegressions } from "./live_shutdown_regressions.mjs";
import { runReleaseRegressions } from "./release_regressions.mjs";

const server = await createServer({
  configFile: "vite.config.js",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = (callback) => {
  callback(Date.now());
  return 0;
};

try {
  const { LiveLineParser } = await server.ssrLoadModule("/live/LiveLineParser.ts");
  const { LiveEvents } = await server.ssrLoadModule("/live/LiveEvents.ts");
  const { LiveMetrics } = await server.ssrLoadModule("/live/LiveMetrics.ts");
  const { LiveSession } = await server.ssrLoadModule("/live/LiveSession.ts");
  const { LiveStream } = await server.ssrLoadModule("/live/LiveStream.ts");
  const { TelemetryQueue } = await server.ssrLoadModule("/telemetry/telemetryQueue.ts");
  const { withViewerSessionId } = await server.ssrLoadModule("/telemetry/telemetryClient.ts");
  const { ViewingFeature } = await server.ssrLoadModule("/viewing/ViewingFeature.ts");
  const { RouteImportService } = await server.ssrLoadModule("/app/import/RouteImportService.ts");

  {
    const viewing = new ViewingFeature();
    viewing.load({
      poses: [{ t: 70_000, x: 1, y: 1 }],
      watches: [{ t: 69_900, id: 1, level: "INFO", label: "Stale", value: "1" }],
    });
    const parser = new LiveLineParser();
    const parsed = parser.parse({
      lines: [
        "[WATCH],69950,INFO,1,Stale,2",
        "[START],0,2,300001",
        "[POSE],0,2,3,0,0,0",
        "[WATCH],20,INFO,1,Fresh,3000",
      ],
      startIndex: 0,
      endIndex: 4,
    }, viewing.data, 70_000);

    assert.equal(parsed.startsNewRun, true);
    assert.deepEqual(parsed.runStart, {
      robotStartTimestampMs: 0,
      odomProviderId: 2,
      odomProvider: "custom",
      mvlibVersionEncoded: 300001,
    });
    assert.equal(parsed.batch.poses?.[0]?.t, 0);
    assert.deepEqual(parsed.batch.watches?.map((watch) => watch.t), [20]);
    viewing.loadParsedBatch(parsed.batch);
    assert.deepEqual([...viewing.data.poses].map((pose) => pose.t), [0]);
    assert.deepEqual(viewing.data.watches.map((watch) => watch.label), ["Fresh"]);

    const invalidVelocity = parser.parse({
      lines: [
        "[POSE],30,3,4,0,NaN,42",
        "[POSE],31,4,5,0,0,0",
      ],
      startIndex: 0,
      endIndex: 2,
    }, viewing.data, 20);
    assert.deepEqual(invalidVelocity.batch.poses?.map((pose) => pose.t), [30, 31]);
    assert.deepEqual(invalidVelocity.batch.poses?.map((pose) => ({
      l_vel: pose.l_vel,
      r_vel: pose.r_vel,
      speed_raw: pose.speed_raw,
    })), [
      { l_vel: null, r_vel: null, speed_raw: null },
      { l_vel: 0, r_vel: 0, speed_raw: 0 },
    ]);
    assert.equal(invalidVelocity.lastPoseTimestamp, 31,
      "a pose with invalid speeds must preserve timestamp order");
    viewing.appendLiveBatch(invalidVelocity.batch);
    assert.deepEqual([...viewing.data.poses].map((pose) => pose.t), [0, 30, 31]);
    const navigableInvalidPose = viewing.projection.interpolatePose(30);
    assert.deepEqual({ t: navigableInvalidPose?.t, x: navigableInvalidPose?.x, y: navigableInvalidPose?.y },
      { t: 30, x: 3, y: 4 });
    assert.equal(navigableInvalidPose?.speed_raw, null,
      "invalid speed must remain absent while the pose is still navigable");

    const startOnly = parser.parse({ lines: ["[START],0"], startIndex: 0, endIndex: 1 }, viewing.data, 0);
    assert.equal(startOnly.startsNewRun, true);
    viewing.loadParsedBatch(startOnly.batch);
    assert.equal(viewing.data.hasData, false);

    const latestStartWins = parser.parse({
      lines: [
        "[START],0",
        "[POSE],10,1,1,0,0,0",
        "[START],0",
        "[POSE],20,2,2,0,0,0",
      ],
      startIndex: 0,
      endIndex: 4,
    }, viewing.data, null);
    assert.deepEqual(latestStartWins.batch.poses?.map((pose) => pose.t), [20]);

    const legacyStart = parser.parse({ lines: ["[START],1250"], startIndex: 0, endIndex: 1 }, viewing.data, null);
    assert.deepEqual(legacyStart.runStart, {
      robotStartTimestampMs: 1250,
      odomProviderId: null,
      odomProvider: "unknown",
      mvlibVersionEncoded: null,
    });
  }

  {
    const session = new LiveSession();
    session.connectionState = "connected";
    session.streamState = "streaming";
    session.pending.push("[POSE],0,1,2,0,0,0");
    const stream = new LiveStream(
      session,
      new LiveEvents(),
      {},
      new ViewingFeature(),
      { parse() { throw new Error("fixture parser failure"); } },
      new LiveMetrics({ telemetry: {
        totalStreamingDuration: async () => undefined,
        livestreamMetrics: async () => undefined,
        liveRunStarted: async () => undefined,
        liveRunFatalError: async () => undefined,
        liveRunEnded: async () => undefined,
      } }),
    );
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      stream.refreshNow();
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(session.pending.pendingCount(), 0, "a failed live batch must not block later telemetry");
  }

  {
    const session = new LiveSession();
    session.connectionState = "connected";
    session.streamState = "streaming";
    session.lastPoseTimestamp = 100;
    session.pending.push("[POSE],101,1,2,0,0,0");
    const viewing = new ViewingFeature();
    const stream = new LiveStream(
      session,
      new LiveEvents(),
      {},
      viewing,
      new LiveLineParser(),
      new LiveMetrics({ telemetry: {
        totalStreamingDuration: async () => undefined,
        livestreamMetrics: async () => undefined,
        liveRunStarted: async () => undefined,
        liveRunFatalError: async () => undefined,
        liveRunEnded: async () => undefined,
      } }),
    );

    stream.discardPending();
    assert.equal(session.pending.pendingCount(), 0, "clearing live output discards pre-clear records");
    assert.equal(session.lastPoseTimestamp, 100, "clearing live output preserves parser continuity");

    session.pending.push("[POSE],102,3,4,0,0,0");
    assert.equal(stream.refreshNow().posesAdded, 1, "new records continue after a live-data clear");
    assert.equal(viewing.data.poses[0]?.t, 102);
  }

  {
    const events = [];
    const telemetry = {
      totalStreamingDuration: async (properties = {}) => { events.push({ event: "total_streaming_duration", properties }); },
      livestreamMetrics: async (properties = {}) => { events.push({ event: "livestream_metrics", properties }); },
      liveRunStarted: async (properties) => { events.push({ event: "live_run_started", properties }); },
      liveRunFatalError: async (properties) => { events.push({ event: "live_run_fatal_error", properties }); },
      liveRunEnded: async (properties) => { events.push({ event: "live_run_ended", properties }); },
    };
    let now = 100;
    let id = 0;
    const metrics = new LiveMetrics({ telemetry, now: () => now, createRunId: () => `run-${++id}` });
    const parser = new LiveLineParser();
    const viewing = new ViewingFeature();
    const first = parser.parse({
      lines: [
        "[START],10,3,300001",
        "[POSE],20,1,2,0,0,0",
        "[WATCH],25,INFO,7,Velocity,3000",
        "[LOG],30,FATAL,[MVLIB] Motor controller unavailable",
        "[LOG],35,FATAL,User diagnostic must remain private",
      ],
      startIndex: 0,
      endIndex: 5,
    }, viewing.data, null);
    assert.ok(first.runStart);
    metrics.beginRun(first.runStart);
    metrics.accept(viewing.loadParsedBatch(first.batch), first.batch);
    now = 175;
    metrics.beginRun({ robotStartTimestampMs: 0, odomProviderId: null, odomProvider: "unknown", mvlibVersionEncoded: null });
    now = 200;
    metrics.endRun("manual_stop");
    await metrics.drainTelemetry();

    assert.deepEqual(events.map(({ event }) => event), [
      "live_run_started",
      "live_run_fatal_error",
      "live_run_ended",
      "live_run_started",
      "live_run_ended",
    ]);
    assert.equal(events[0].properties.live_run_id, "run-1");
    assert.equal(events[0].properties.odom_provider, "lemlib");
    assert.equal(events[1].properties.message, "Motor controller unavailable");
    assert.equal(events.filter(({ event }) => event === "live_run_fatal_error").length, 1, "user FATAL logs must not be reported");
    assert.deepEqual(events[2].properties, {
      live_run_id: "run-1",
      robot_start_timestamp_ms: 10,
      odom_provider_id: 3,
      odom_provider: "lemlib",
      mvlib_version_encoded: 300001,
      end_reason: "replaced_by_start",
      observed_duration_ms: 75,
      telemetry_duration_ms: 25,
      last_telemetry_timestamp_ms: 35,
      poses_received: 1,
      watches_received: 1,
      logs_received: 2,
      waypoints_received: 0,
      poses_len: 1,
      watches_len: 1,
      logs_len: 2,
      waypoints_len: 0,
      accepted_batches: 1,
      fatal_system_logs: 1,
    });
    assert.equal(events[4].properties.end_reason, "manual_stop");

    await metrics.finalizeTelemetry();
    assert.equal(events[5].event, "total_streaming_duration");
    assert.deepEqual(events[6], {
      event: "livestream_metrics",
      properties: {
        totalPosesReceived: 1,
        totalWatchesReceived: 1,
        totalLogsReceived: 2,
        totalWaypointsReceived: 0,
        totalRuns: 2,
        totalAcceptedBatches: 1,
        totalFatalSystemLogs: 1,
        totalObservedDurationMs: 100,
        totalTelemetryDurationMs: 25,
      },
    });

    for (const reason of ["force_stop", "terminal_disconnected", "connection_closed", "app_closed"]) {
      const boundaryEvents = [];
      const boundaryMetrics = new LiveMetrics({
        telemetry: {
          totalStreamingDuration: async () => { boundaryEvents.push("total"); },
          livestreamMetrics: async (properties) => { boundaryEvents.push({ event: "livestream_metrics", properties }); },
          liveRunStarted: async () => { boundaryEvents.push("start"); },
          liveRunFatalError: async () => { boundaryEvents.push("fatal"); },
          liveRunEnded: async (properties) => { boundaryEvents.push(properties.end_reason); },
        },
        now: () => 0,
        createRunId: () => "boundary-run",
      });
      boundaryMetrics.beginRun({ robotStartTimestampMs: 0, odomProviderId: null, odomProvider: "unknown", mvlibVersionEncoded: null });
      if (reason === "app_closed") await boundaryMetrics.finalizeTelemetry();
      else {
        boundaryMetrics.endRun(reason);
        boundaryMetrics.endRun(reason);
        await boundaryMetrics.drainTelemetry();
      }
      assert.deepEqual(
        boundaryEvents,
        reason === "app_closed"
          ? [
            "start",
            "app_closed",
            "total",
            {
              event: "livestream_metrics",
              properties: {
                totalPosesReceived: 0,
                totalWatchesReceived: 0,
                totalLogsReceived: 0,
                totalWaypointsReceived: 0,
                totalRuns: 1,
                totalAcceptedBatches: 0,
                totalFatalSystemLogs: 0,
                totalObservedDurationMs: 0,
                totalTelemetryDurationMs: 0,
              },
            },
          ]
          : ["start", reason],
      );
    }
  }

  {
    const originalStorage = globalThis.localStorage;
    const storage = new Map();
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    try {
      const queue = new TelemetryQueue("motionview.test.session-queue");
      const captured = withViewerSessionId({ source: "run" }, "session-a");
      queue.enqueue({ event: "live_run_started", properties: captured, createdAt: new Date(0).toISOString() });
      assert.equal(queue.read()[0]?.properties.viewer_session_id, "session-a");
      const laterSessionCapture = withViewerSessionId({ source: "next-run" }, "session-b");
      assert.equal(laterSessionCapture.viewer_session_id, "session-b");
      assert.equal(queue.read()[0]?.properties.viewer_session_id, "session-a", "queued events retain their capture-session identity");
    } finally {
      if (originalStorage) globalThis.localStorage = originalStorage;
      else delete globalThis.localStorage;
    }
  }

  {
    const viewing = new ViewingFeature();
    viewing.load({
      poses: [
        { t: 100, x: 0, y: 0 },
        { t: 200, x: 1, y: 0 },
        { t: 300, x: 2, y: 0 },
      ],
      watches: [
        { t: 100, id: 1, level: "INFO", label: "Left", value: "1" },
        { t: 300, id: 1, level: "INFO", label: "Left", value: "3" },
      ],
    });
    viewing.appendLiveBatch({
      watches: [{ t: 200, id: 2, level: "INFO", label: "Inserted", value: "2" }],
    });

    assert.deepEqual(viewing.data.watches.map((watch) => watch.t), [100, 200, 300]);
    assert.deepEqual(viewing.projection.watchMarkers.map((marker) => marker.t), [100, 200, 300]);
    assert.deepEqual(
      viewing.projection.watchMarkers.map((marker) => marker.watch.label),
      ["Left", "Inserted", "Left"],
    );
  }

  {
    let planningCleared = false;
    let captureLoaded = false;
    let fieldEnabled = false;
    const importer = new RouteImportService({
      planning: {
        hasData: true,
        clear() { planningCleared = true; },
      },
      live: {
        captureHasData: () => true,
        loadCapture() { captureLoaded = true; },
      },
    }, {}, {
      setFieldEnabled() { fieldEnabled = true; },
    }, "");

    const result = await importer.loadCapture("[POSE],0,1,2,0,0,0");
    assert.equal(result.loaded, true);
    assert.equal(captureLoaded, true);
    assert.equal(planningCleared, false, "viewing-only captures must preserve the planning route");
    assert.equal(fieldEnabled, true);
  }

  await runLiveShutdownRegressions(server);
  await runReleaseRegressions(server);
  console.log("Live-stream regression tests passed.");
} finally {
  if (originalRequestAnimationFrame) globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  else delete globalThis.requestAnimationFrame;
  await server.close();
}

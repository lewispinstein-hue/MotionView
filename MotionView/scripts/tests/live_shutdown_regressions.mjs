import assert from "node:assert/strict";

export async function runLiveShutdownRegressions(server) {
  const { LiveConnection } = await server.ssrLoadModule("/live/LiveConnection.ts");
  const { LiveEvents } = await server.ssrLoadModule("/live/LiveEvents.ts");
  const { LiveSession } = await server.ssrLoadModule("/live/LiveSession.ts");
  const { LiveStream } = await server.ssrLoadModule("/live/LiveStream.ts");
  const { LiveLineParser } = await server.ssrLoadModule("/live/LiveLineParser.ts");
  const { LiveMetrics } = await server.ssrLoadModule("/live/LiveMetrics.ts");
  const { ViewingFeature } = await server.ssrLoadModule("/viewing/ViewingFeature.ts");
  const { AppShutdown } = await server.ssrLoadModule("/app/lifecycle/AppShutdown.ts");

  const originals = {
    WebSocket: globalThis.WebSocket,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };

  const timers = new Map();
  let nextTimer = 1;
  let scenarios = 0;

  class TestSocket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    receive(data) {
      this.dispatchEvent(new MessageEvent("message", { data }));
    }
    close() {
      this.dispatchEvent(new Event("close"));
    }
  }

  globalThis.WebSocket = TestSocket;
  globalThis.setInterval = (callback) => {
    const id = nextTimer++;
    timers.set(id, callback);
    return id;
  };

  globalThis.clearInterval = (id) => timers.delete(id);
  const success = { ok: true, status: 200, json: { ok: true } };
  const failure = { ok: false, status: 500, json: { ok: false } };
  const records = [
    "[START],0,3,300001",
    "[POSE],10,1,2,0,10,10",
    "[WATCH],11,INFO,7,Battery,12.5",
    "[LOG],12,INFO,First diagnostic",
    "[WPOINT],13,CREATED,4,Target,20,30,NA,1000,1,NA,0",
    "[WPOINT],14,REACHED,4,Target,50",
  ];

  const tick = () => {
    for (const callback of [...timers.values()]) callback();
  };

  const make = async (interval, stopRequest = async () => success) => {
    const session = new LiveSession();
    session.refreshIntervalMs = interval;
    const events = new LiveEvents();
    const viewing = new ViewingFeature();
    const parser = new LiveLineParser();
    const metricEvents = [];
    const metrics = new LiveMetrics({
      telemetry: {
        totalStreamingDuration: async () => {},
        livestreamMetrics: async () => {},
        liveRunStarted: async () => {},
        liveRunFatalError: async () => {},
        liveRunEnded: async (properties) => metricEvents.push(properties),
      },
      now: () => 100,
      createRunId: () => "shutdown-run",
    });

    const requests = [];
    const bridge = {
      resolveOrigin: async () => "http://test.invalid",
      websocketUrl: "ws://test.invalid/ws",
      waitUntilReady: async () => true,
      post: async (path) => {
        requests.push(path);
        return path === "/api/start" ? success : stopRequest(path);
      },
    };
    const stream = new LiveStream(
      session,
      events,
      bridge,
      viewing,
      parser,
      metrics,
    );
    const connection = new LiveConnection(
      session,
      events,
      bridge,
      { path: "/test-project", valid: true },
      stream,
      viewing,
      parser,
    );
    assert.equal(await connection.connect(), true);
    assert.equal(await stream.start(), true);
    const socket = session.socket;
    const send = (lines = records) => {
      for (const line of lines) socket.receive(line);
    };
    const accepted = [];
    events.batchAccepted.subscribe(({ result, pendingLineCount }) => {
      accepted.push(result);
      assert.equal(
        pendingLineCount,
        0,
        "the applied batch is consumed before subscribers run",
      );
    });
    const close = async () => {
      await connection.disconnect();
      assert.equal(timers.size, 0, "each fixture must release its interval");
    };
    return {
      session,
      events,
      viewing,
      metrics,
      metricEvents,
      stream,
      connection,
      socket,
      send,
      requests,
      accepted,
      close,
    };
  };
  const assertStored = (fixture, poses = 1, logs = 1) => {
    assert.equal(fixture.viewing.data.poses.length, poses);
    assert.equal(fixture.viewing.data.watches.length, 1);
    assert.equal(fixture.viewing.data.logs.length, logs);
    assert.equal(fixture.viewing.data.waypoints.length, 1);
    assert.equal(
      fixture.viewing.data.waypoints[0].events.at(-1).type,
      "REACHED",
    );
    assert.equal(fixture.viewing.projection.watchMarkers.length, 1);
    assert.equal(
      [...fixture.viewing.exportData().poses].length,
      poses,
      "the final records must be available to export/persistence",
    );
    assert.equal(fixture.stream.pendingLineCount, 0);
  };
  const assertEnded = async (fixture, reason, poses = 1, logs = 1) => {
    await fixture.metrics.drainTelemetry();
    assert.equal(
      fixture.metricEvents.length,
      1,
      "one final run summary, including all drained records",
    );
    const summary = fixture.metricEvents[0];
    assert.equal(summary.end_reason, reason);
    assert.equal(summary.poses_received, poses);
    assert.equal(summary.watches_received, 1);
    assert.equal(summary.logs_received, logs);
    assert.equal(summary.waypoints_received, 2);
    assert.equal(fixture.stream.state, "idle");
    assert.equal(
      fixture.session.refreshTimer,
      null,
      "completed captures release their interval",
    );
    assert.equal(fixture.session.lastPoseTimestamp, null);
  };

  try {
    for (const interval of [0, 500, 10_000]) {
      const fixture = await make(interval);
      try {
        // A failed no-device attempt can exit before any records arrive.
        fixture.socket.receive("[UI] terminal exited (code 1)");
        await fixture.stream.start();
        for (let cycle = 0; cycle < 3; cycle++) {
          assert.equal(fixture.stream.streaming, true);
          assert.equal(fixture.session.refreshTimer !== null, interval > 0);
          assert.equal(
            timers.size,
            interval > 0 ? 1 : 0,
            "restart must not leak intervals",
          );
          fixture.send();
          tick();
          if (interval > 0) assertStored(fixture);
          else
            assert.equal(
              fixture.stream.pendingLineCount,
              records.length,
              "Off remains manual until exit",
            );
          fixture.socket.receive("[INTERNAL] terminal closed");
          await fixture.stream.remoteExit();
          assertStored(fixture);
          assert.equal(fixture.session.refreshTimer, null);
          await fixture.stream.start();
        }
        await fixture.metrics.drainTelemetry();
        assert.equal(fixture.metricEvents.length, 3);
        scenarios += 1;
      } finally {
        await fixture.close();
      }
    }
    // No refresh tick runs before these boundaries, including when Off is intentional.
    for (const interval of [0, 500, 10_000]) {
      for (const ending of [
        "manual_stop",
        "force_stop",
        "terminal_disconnected",
        "connection_closed",
      ]) {
        const fixture = await make(interval);
        try {
          fixture.send();
          assert.equal(fixture.stream.pendingLineCount, records.length);
          if (ending === "manual_stop")
            assert.equal(await fixture.stream.stop(), true);
          else if (ending === "force_stop")
            assert.equal(await fixture.stream.stop({ force: true }), true);
          else if (ending === "terminal_disconnected") {
            fixture.socket.receive("[INTERNAL] terminal closed");
            await fixture.stream.remoteExit(); // Wait for the handler's queued exit as well.
          } else {
            const disconnected = new Promise((resolve) => {
              fixture.events.connectionChanged.subscribe(({ current }) => {
                if (current === "disconnected") resolve();
              });
            });
            fixture.socket.close();
            await disconnected;
          }
          assertStored(fixture);
          assert.equal(fixture.accepted.length, 1);
          await assertEnded(fixture, ending);
          await fixture.stream.stop();
          await fixture.stream.remoteExit();
          assertStored(fixture);
          await assertEnded(fixture, ending);
          scenarios += 1;
        } finally {
          await fixture.close();
        }
      }
    }

    for (const interval of [0, 500]) {
      let resolveStop;
      let enteredStop;
      const entered = new Promise((resolve) => {
        enteredStop = resolve;
      });
      const fixture = await make(
        interval,
        () =>
          new Promise((resolve) => {
            resolveStop = resolve;
            enteredStop();
          }),
      );
      try {
        fixture.send(records.slice(0, -1));
        const stopping = fixture.stream.stop();
        await entered;
        assert.equal(fixture.stream.state, "stopping");
        // Deliver through the real WebSocket handler while the request is pending.
        fixture.send([
          "[POSE],20,3,4,0,10,10",
          "[WPOINT],21,REACHED,4,Target,20",
          "[LOG],22,INFO,Final diagnostic",
        ]);
        tick();
        assert.equal(
          fixture.stream.pendingLineCount,
          8,
          "a timer tick during Stop must not erase the final batch",
        );
        resolveStop(success);
        assert.equal(await stopping, true);
        assertStored(fixture, 2, 2);
        await assertEnded(fixture, "manual_stop", 2, 2);
        assert.equal(
          fixture.viewing.data.poses[fixture.viewing.data.poses.length - 1].t,
          20,
        );
        assert.equal(
          fixture.viewing.data.logs.at(-1).message,
          "Final diagnostic",
        );
        fixture.send(["[POSE],30,9,9,0,0,0"]);
        assert.equal(
          fixture.stream.pendingLineCount,
          0,
          "finished captures no longer accept records",
        );
        scenarios += 1;
      } finally {
        await fixture.close();
      }
    }

    {
      let attempts = 0;
      const fixture = await make(0, async () =>
        ++attempts === 1 ? failure : success,
      );
      try {
        fixture.send();
        assert.equal(await fixture.stream.stop(), false);
        assertStored(fixture);
        assert.equal(fixture.stream.streaming, true);
        await fixture.metrics.drainTelemetry();
        assert.equal(
          fixture.metricEvents.length,
          0,
          "failed Stop must keep the run open",
        );
        fixture.send(["[POSE],20,3,4,0,0,0"]);
        assert.equal(await fixture.stream.stop(), true);
        assertStored(fixture, 2);
        await assertEnded(fixture, "manual_stop", 2);
        scenarios += 1;
      } finally {
        await fixture.close();
      }
    }

    {
      const fixture = await make(0, async (path) =>
        path === "/api/kill" ? failure : success,
      );
      try {
        fixture.send();
        assert.equal(await fixture.stream.stop({ force: true }), true);
        assert.deepEqual(fixture.requests, [
          "/api/start",
          "/api/kill",
          "/api/stop",
        ]);
        assertStored(fixture);
        await assertEnded(fixture, "force_stop");
        scenarios += 1;
      } finally {
        await fixture.close();
      }
    }

    {
      const fixture = await make(0);
      try {
        fixture.send();
        fixture.session.connectionState = "disconnected";
        await fixture.stream.connectionClosed();
        assertStored(fixture);
        await assertEnded(fixture, "connection_closed");
        scenarios += 1;
      } finally {
        await fixture.close();
      }
    }
    {
      const fixture = await make(0);
      try {
        fixture.send();
        let saved;
        let finalized = false;
        const shutdown = new AppShutdown(
          {
            beginExit: () => true,
            core: { status: { setStatus() {} } },
            live: {
              stop: (options) => fixture.stream.stop(options),
              finalizeTelemetry: () => fixture.metrics.finalizeTelemetry(),
            },
            settings: { saveNow: async () => {} },
            finalizeExit: async () => {
              finalized = true;
            },
          },
          {
            getRobotImageDataUrl: () => null,
            getCustomFieldImageDataUrl: () => null,
          },
          {
            saveNow: async () => {
              const data = fixture.viewing.exportData();
              saved = {
                poses: [...data.poses],
                watches: [...data.watches],
                logs: [...data.logs],
                waypoints: [...data.waypoints],
              };
            },
          },
        );
        // Exercise the close handler's actual sequencing without a native window.
        await shutdown.quit("keyboard");
        assertStored(fixture);
        assert.equal(
          saved.poses.length,
          1,
          "quit must apply pending data before saving",
        );
        assert.equal(saved.watches.length, 1);
        assert.equal(saved.logs.length, 1);
        assert.equal(saved.waypoints[0].events.at(-1).type, "REACHED");
        await assertEnded(fixture, "app_closed");
        assert.equal(finalized, true);
        scenarios += 1;
      } finally {
        await fixture.close();
      }
    }
    console.log(`Live shutdown regressions passed (${scenarios} scenarios).`);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

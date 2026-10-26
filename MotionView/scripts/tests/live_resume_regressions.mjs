import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function runLiveResumeRegressions(server) {
  const { LiveConnection } = await server.ssrLoadModule("/live/LiveConnection.ts");
  const { LiveEvents } = await server.ssrLoadModule("/live/LiveEvents.ts");
  const { LiveSession } = await server.ssrLoadModule("/live/LiveSession.ts");
  const { LiveStream } = await server.ssrLoadModule("/live/LiveStream.ts");
  const { LiveLineParser } = await server.ssrLoadModule("/live/LiveLineParser.ts");
  const { ViewingFeature } = await server.ssrLoadModule("/viewing/ViewingFeature.ts");
  const venv = fileURLToPath(new URL(
    process.platform === "win32" ? "../../../.venv/Scripts/python.exe" : "../../../.venv/bin/python",
    import.meta.url,
  ));
  const python = existsSync(venv) ? venv : process.platform === "win32" ? "python" : "python3";
  const decode = (body, events) => {
    const result = spawnSync(python, [fileURLToPath(new URL("./live_resume_decoder.py", import.meta.url))], {
      input: JSON.stringify({ body, events }), encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return JSON.parse(result.stdout);
  };
  const originals = {
    WebSocket: globalThis.WebSocket,
    now: Date.now,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  class TestSocket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    receive(data) { this.dispatchEvent(new MessageEvent("message", { data })); }
    close() { this.dispatchEvent(new Event("close")); }
  }
  let now = 10_000;
  const timers = new Set();
  globalThis.WebSocket = TestSocket;
  Date.now = () => now;
  globalThis.setInterval = (callback) => { timers.add(callback); return callback; };
  globalThis.clearInterval = (callback) => timers.delete(callback);
  let scenarios = 0;

  try {
    for (const interval of [0, 500]) {
      for (const end of ["stop", "terminal", "socket"]) {
        for (const gap of [20, 35_000, 135_000]) {
          const session = new LiveSession();
          session.refreshIntervalMs = interval;
          const events = new LiveEvents();
          const viewing = new ViewingFeature();
          const parser = new LiveLineParser();
          const requests = [];
          let next = [
            ["start", 70_000], ["pose", 70_000], ["pose", 70_040],
            ["created", 70_030], ["watch", 70_035], ["log", 70_036],
          ];
          let fail = false;
          const success = { ok: true, status: 200, json: { ok: true } };
          const bridge = {
            resolveOrigin: async () => "http://test.invalid",
            websocketUrl: "ws://test.invalid/ws",
            waitUntilReady: async () => true,
            post: async (path, body) => {
              if (path === "/api/start") {
                requests.push(body);
                if (fail) return { ok: false, status: 500, json: { ok: false } };
                for (const line of decode(body, next)) session.socket.receive(line);
              }
              return success;
            },
          };
          const stream = new LiveStream(session, events, bridge, viewing, parser, {
            beginRun() {}, endRun() {}, accept() {},
          });
          events.projectChanged.emit({ path: "/test-project" });
          const connection = new LiveConnection(
            session, events, bridge, { path: "/test-project", valid: true }, stream, viewing, parser,
          );
          assert.equal(await connection.connect(), true);
          assert.equal(await stream.start(), true);
          assert.deepEqual(requests[0], { resume: null });
          // Even with refresh Off, the receipt anchor already knows 70040ms.
          assert.equal(session.timestampResume().timestampMs, 70_040);
          session.socket.receive("[POSE],999999999,NaN,NaN,0,0,0");
          session.socket.receive("[WATCH],999999999,INFO,7,Battery,\"unterminated");
          session.socket.receive("[LOG],999999999,INFO,");
          session.socket.receive("[WPOINT],999999999,INVALID,4,Target");
          assert.equal(session.timestampResume().timestampMs, 70_040,
            "malformed console records must not change the resume anchor");
          // A quiet period before Stop must count too; flushing is not receipt.
          const quietBeforeStop = Math.floor(gap / 2);
          now += quietBeforeStop;
          if (end === "stop") await stream.stop();
          else if (end === "terminal") {
            session.socket.receive("[INTERNAL] terminal closed");
            await stream.remoteExit();
          } else {
            session.socket.close();
            // Wait for the actual close handler's asynchronous state update.
            await stream.connectionClosed();
            await Promise.resolve();
            assert.equal(await connection.connect(), true);
          }
          assert.deepEqual([...viewing.data.poses].map(({ t }) => t), [70_000, 70_040]);
          now += gap - quietBeforeStop;
          const resumed = 70_040 + gap;
          next = [
            ["watch", resumed], ["log", resumed + 1],
            ["reached", resumed + 2], ["pose", resumed + 3],
          ];
          // A no-device/failed start must retain the same continuation anchor.
          fail = true;
          assert.equal(await stream.start(), false);
          fail = false;
          assert.equal(await stream.start(), true);
          assert.deepEqual(requests.at(-1), { resume: { timestampMs: 70_040, elapsedMs: gap } });
          if (interval === 500) for (const callback of [...timers]) callback();
          await stream.stop(); // Off must include resumed records in the final drain.
          assert.deepEqual([...viewing.data.poses].map(({ t }) => t), [70_000, 70_040, resumed + 3]);
          assert.deepEqual(viewing.projection.timeRange(), { start: 70_000, end: resumed + 3 });
          assert.equal(viewing.data.watches.at(-1).t, resumed);
          assert.equal(viewing.data.logs.at(-1).t, resumed + 1);
          assert.equal(viewing.data.waypoints[0].events.at(-1).t, resumed + 2);
          assert.equal(viewing.data.waypoints[0].events.at(-1).type, "REACHED");
          assert.deepEqual([...viewing.exportData().poses].map(({ t }) => t), [70_000, 70_040, resumed + 3]);
          assert.equal(viewing.projection.interpolatePose(resumed + 3)?.x, 2);

          // START, even in a freshly seeded decoder, replaces all prior data.
          next = [["start", 0], ["pose", 10], ["watch", 11], ["log", 12], ["created", 13]];
          assert.equal(await stream.start(), true);
          await stream.stop();
          assert.deepEqual([...viewing.data.poses].map(({ t }) => t), [10]);
          assert.deepEqual(viewing.data.watches.map(({ t }) => t), [11]);
          assert.deepEqual(viewing.data.logs.map(({ t }) => t), [12]);
          assert.equal(viewing.data.waypoints.length, 1);
          assert.equal(viewing.data.waypoints[0].events[0].t, 13);
          assert.equal(session.timestampResume().timestampMs, 13);

          // Missing/mis-epoch poses cannot corrupt the store's sorted order.
          next = [];
          assert.equal(await stream.start(), true);
          session.socket.receive("[POSE],9,999,999,0,0,0");
          await stream.stop();
          assert.deepEqual([...viewing.data.poses].map(({ t }) => t), [10]);
          events.projectChanged.emit({ path: "/other-project" });
          assert.equal(session.timestampResume(), null);
          session.observeTimestamp(100);
          viewing.load({ poses: [{ t: 2, x: 1, y: 1 }] });
          assert.equal(session.timestampResume(), null);
          session.observeTimestamp(100);
          stream.loadCapture("[POSE],1,1,1,0,0,0");
          assert.equal(session.timestampResume(), null);
          session.observeTimestamp(100);
          stream.reset();
          assert.equal(session.timestampResume(), null);
          await connection.disconnect();
          assert.equal(timers.size, 0);
          scenarios++;
        }
      }
    }
    console.log(`Live continuation regressions passed (${scenarios} fresh-decoder lifecycle scenarios).`);
  } finally {
    globalThis.WebSocket = originals.WebSocket;
    Date.now = originals.now;
    globalThis.setInterval = originals.setInterval;
    globalThis.clearInterval = originals.clearInterval;
  }
}

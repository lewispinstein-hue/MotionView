import assert from "node:assert/strict";
import { createServer } from "vite";

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
        "[START],0",
        "[POSE],0,2,3,0,0,0",
        "[WATCH],20,INFO,1,Fresh,3000",
      ],
      startIndex: 0,
      endIndex: 4,
    }, viewing.data, 70_000);

    assert.equal(parsed.startsNewRun, true);
    assert.equal(parsed.batch.poses?.[0]?.t, 0);
    assert.deepEqual(parsed.batch.watches?.map((watch) => watch.t), [20]);
    viewing.loadParsedBatch(parsed.batch);
    assert.deepEqual([...viewing.data.poses].map((pose) => pose.t), [0]);
    assert.deepEqual(viewing.data.watches.map((watch) => watch.label), ["Fresh"]);

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

  console.log("Live-stream regression tests passed.");
} finally {
  if (originalRequestAnimationFrame) globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  else delete globalThis.requestAnimationFrame;
  await server.close();
}

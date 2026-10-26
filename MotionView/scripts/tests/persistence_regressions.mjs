import assert from "node:assert/strict";

const field = (value = "") => ({ value, disabled: false, hidden: false, textContent: "", querySelector: () => null });
const settle = () => new Promise(setImmediate);

export async function runPersistenceRegressions(server) {
  const { MotionViewApp } = await server.ssrLoadModule("/app/MotionViewApp.ts");
  const { ExportDialog } = await server.ssrLoadModule("/app/export/ExportDialog.ts");
  const { ExportService } = await server.ssrLoadModule("/app/export/ExportService.ts");
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const { SettingsFeature } = await server.ssrLoadModule("/app/settings/SettingsFeature.ts");
  const { SessionPersistence } = await server.ssrLoadModule("/app/persistence/SessionPersistence.ts");
  const { AppBootstrap } = await server.ssrLoadModule("/app/lifecycle/AppBootstrap.ts");
  const { AppShutdown } = await server.ssrLoadModule("/app/lifecycle/AppShutdown.ts");
  const originalWindow = globalThis.window;
  const originalAddListener = globalThis.addEventListener;
  const originalConsoleError = console.error;
  try {
    // A recognized collision, successful confirmation, cancellation, and the
    // two independent stored choices all go through the real export service.
    for (const scenario of [
      { name: "new file", exists: false, expected: [false] },
      { name: "cancel replacement", exists: true, confirmed: false, dontShowAgain: true, expected: [false] },
      { name: "confirm replacement", exists: true, confirmed: true, expected: [false, true] },
      { name: "remember JSON only", exists: true, confirmed: true, dontShowAgain: true, expected: [false, true] },
      { name: "planning skip does not skip JSON", exists: true, planningSkip: true, confirmed: true, expected: [false, true] },
      { name: "JSON skip does not change planning", exists: true, jsonSkip: true, expected: [true] },
    ]) {
      const app = new MotionViewApp();
      app.settings.update({ skipPlanningCodeExportOverwriteConfirmation: !!scenario.planningSkip, skipMotionViewJsonExportOverwriteConfirmation: !!scenario.jsonSkip });
      app.viewing.load({ poses: [{ t: 1, x: 4, y: 5 }] });
      const dom = Object.fromEntries(["pathName", "filename", "filenameHint", "location", "type", "customWrap", "customPath", "customHint", "confirm", "validation", "success"].map((key) => [key, field()]));
      Object.assign(dom.pathName, { value: "Capture" }); dom.filename.value = "capture"; dom.location.value = "downloads"; dom.type.value = "viewing";
      const attempts = []; const confirmations = []; const savedSettings = [];
      globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
        if (command === "write_settings") { savedSettings.push(JSON.parse(args.contents)); return; }
        assert.equal(command, "export_motionview_json");
        attempts.push(args.overwrite);
        assert.equal(JSON.parse(args.jsonContents).poses[0].x, 4);
        if (scenario.exists && !args.overwrite) throw { code: "exists", path: "/Downloads/capture.json", message: "Already exists" };
        return { path: "/Downloads/capture.json" };
      } } };
      const dialog = new ExportDialog(app, dom, new ExportService(app, new MotionViewDocumentSerializer(app)), {
        confirmWithResult: async (options) => {
          confirmations.push(options);
          assert.match(options.message, /\/Downloads\/capture\.json/);
          assert.equal(options.showDontShowAgain, true);
          return { confirmed: !!scenario.confirmed, dontShowAgain: !!scenario.dontShowAgain };
        },
      });
      await dialog.submit();
      assert.deepEqual(attempts, scenario.expected, scenario.name);
      assert.equal(confirmations.length, scenario.exists && !scenario.jsonSkip ? 1 : 0);
      assert.equal(app.settings.current.skipPlanningCodeExportOverwriteConfirmation, !!scenario.planningSkip);
      assert.equal(app.settings.current.skipMotionViewJsonExportOverwriteConfirmation, !!scenario.jsonSkip || !!(scenario.confirmed && scenario.dontShowAgain));
      assert.equal(savedSettings.length, scenario.confirmed && scenario.dontShowAgain ? 1 : 0);
      assert.equal(dom.confirm.disabled, false, "cancel and completion leave Export usable");
      if (scenario.name !== "cancel replacement") assert.equal(dom.success.textContent, "Exported to /Downloads/capture.json.");
    }

    {
      const app = new MotionViewApp(); app.viewing.load({ poses: [{ x: 1, y: 2 }] });
      const dom = Object.fromEntries(["pathName", "filename", "filenameHint", "location", "type", "customWrap", "customPath", "customHint", "confirm", "validation", "success"].map((key) => [key, field()]));
      dom.pathName.value = "Capture"; dom.filename.value = "capture"; dom.location.value = "downloads"; dom.type.value = "viewing";
      let resolveConfirmation; let attempts = 0;
      const service = { export: async () => { attempts += 1; throw { code: "exists", path: "/capture.json" }; } };
      const dialog = new ExportDialog(app, dom, service, { confirmWithResult: () => new Promise((resolve) => { resolveConfirmation = resolve; }) });
      const pending = dialog.submit(); await settle();
      dialog.render(); assert.equal(dom.confirm.disabled, true);
      await dialog.submit(); assert.equal(attempts, 1, "a pending confirmation cannot submit twice");
      resolveConfirmation({ confirmed: false, dontShowAgain: false }); await pending;
      console.error = () => {};
      const failing = new ExportDialog(app, dom, { export: async () => { throw { code: "exportFailed", message: "Disk is full" }; } }, {});
      await failing.submit();
      assert.equal(dom.validation.textContent, "Failed to export file: Disk is full");
      console.error = originalConsoleError;
    }

    // Writes must finish in order, including a latest-state save queued while
    // an older save is waiting for native I/O.
    {
      const writes = []; let finishFirst;
      globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
        assert.equal(command, "write_settings"); writes.push(JSON.parse(args.contents));
        if (writes.length === 1) await new Promise((resolve) => { finishFirst = resolve; });
      } } };
      const settings = new SettingsFeature(); settings.update({ robotW: "10" });
      const first = settings.saveNow(); await settle();
      settings.update({ robotW: "20" }); const second = settings.saveNow(); await settle();
      assert.equal(writes.length, 1); finishFirst(); await Promise.all([first, second]);
      assert.deepEqual(writes.map((item) => item.robotW), ["10", "20"]);
    }
    {
      let current = 1; const writes = []; let finishFirst;
      globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
        assert.equal(command, "write_saved_paths"); writes.push(JSON.parse(args.contents));
        if (writes.length === 1) await new Promise((resolve) => { finishFirst = resolve; });
      } } };
      const persistence = new SessionPersistence({}, { savedPaths: () => JSON.stringify({ "robot-path": [{ x: current, y: 0 }] }) });
      const first = persistence.saveNow(); await settle(); current = 2;
      const second = persistence.saveNow(); await settle();
      assert.equal(writes.length, 1); finishFirst(); await Promise.all([first, second]);
      assert.deepEqual(writes.map((item) => item["robot-path"][0].x), [1, 2]);
    }

    // The final native quit receives a current UI snapshot; a failed checkpoint
    // leaves the app open and permits retry with the latest snapshot.
    {
      const app = new MotionViewApp(); app.viewing.load({ poses: [{ t: 1, x: 9, y: 8 }] });
      app.settings.update({ skipMotionViewJsonExportOverwriteConfirmation: true });
      app.start = async () => {};
      app.core.telemetry = { appTelemetry: { exiting: async () => {} }, telemetryClient: { flush: async () => {} } };
      const checkpoints = []; let fail = true;
      globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
        assert.equal(command, "finalize_app_quit"); checkpoints.push(args.checkpoint);
        if (fail) throw new Error("Checkpoint write failed");
      } } };
      app.beginExit("keyboard");
      await assert.rejects(app.finalizeExit(), /Checkpoint write failed/);
      assert.notEqual(app.lifecycle, "exited"); fail = false;
      app.viewing.load({ poses: [{ t: 2, x: 19, y: 18 }] });
      assert.equal(app.beginExit("keyboard"), true); await app.finalizeExit();
      assert.equal(app.lifecycle, "exited");
      assert.equal(JSON.parse(checkpoints[0].savedPathsContents)["robot-path"][0].x, 9);
      assert.equal(JSON.parse(checkpoints[1].savedPathsContents)["robot-path"][0].x, 19);
      assert.equal(JSON.parse(checkpoints[1].settingsContents).skipMotionViewJsonExportOverwriteConfirmation, true);
    }

    {
      const notices = ["Preferences restored.", "Paths and recordings restored."]; const shown = [];
      const app = { settings: { load: async () => {} }, start: async () => {}, markReady: async () => {},
        live: { initialize: async () => {} }, planning: { route: [] }, core: { mode: { setMode() {} }, tauri: { isTauriRuntime: () => true, takePersistenceNotices: async () => notices } } };
      const binding = { bind() {}, applyAll() {}, apply() {} };
      const bootstrap = new AppBootstrap(app, { updateFieldLayout() {}, loadRobotImage() {} }, { render() {} },
        binding, binding, binding, binding, binding, binding, { restore: async () => true }, {}, { activate() {} },
        { confirm: async (options) => { shown.push(options); return true; } });
      await bootstrap.start();
      assert.equal(shown.length, 1); assert.equal(shown[0].title, "Saved Data Recovered");
      assert.equal(shown[0].message, notices.join("\n\n")); assert.equal(shown[0].hideCancel, true);
    }

    {
      const handlers = new Map(); const callbacks = new Map(); let callbackId = 0; let exits = 0; let registered = false;
      globalThis.window = { __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" } },
        transformCallback: (callback) => { callbacks.set(++callbackId, callback); return callbackId; },
        invoke: async (command, args) => {
          if (command === "plugin:event|listen") { handlers.set(args.event, callbacks.get(args.handler)); return callbackId; }
          assert.equal(command, "register_app_quit_handler"); registered = true;
        },
      } };
      globalThis.addEventListener = () => {};
      const shutdown = new AppShutdown({ core: { tauri: { isTauriRuntime: () => true }, status: { setStatus() {} } },
        beginExit: () => { exits += 1; return false; } }, {}, {});
      await shutdown.bind();
      handlers.get("tauri://close-requested")({}); assert.equal(exits, 0, "do not snapshot defaults while startup is loading");
      await shutdown.ready(); assert.equal(registered, true);
      handlers.get("tauri://close-requested")({}); assert.equal(exits, 1);
      handlers.get("motionview://app-quit-requested")({}); assert.equal(exits, 2);
    }
    console.log("Persistence/export regressions passed (confirmation choices, cancellation, concurrent saves, recovery notice, shutdown snapshot/retry/readiness).");
  } finally {
    console.error = originalConsoleError;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalAddListener === undefined) delete globalThis.addEventListener; else globalThis.addEventListener = originalAddListener;
  }
}

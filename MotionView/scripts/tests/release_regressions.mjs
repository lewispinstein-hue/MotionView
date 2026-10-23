import assert from "node:assert/strict";

const field = (value = "") => ({
  value,
  textContent: "",
  hidden: false,
  disabled: false,
  style: {},
  dataset: {},
  focus() {},
  classList: {
    add() {},
    remove() {},
    contains() {
      return false;
    },
  },
});

export async function runReleaseRegressions(server) {
  const { ViewingFeature } = await server.ssrLoadModule("/viewing/ViewingFeature.ts");
  const { formatNumber, watchGraphKey, watchKey } = await server.ssrLoadModule("/viewing/viewingPresentation.ts");
  const { WatchGraphView } = await server.ssrLoadModule("/viewing/render/WatchGraphView.ts");
  const { FieldRenderer } = await server.ssrLoadModule("/render/field/FieldRenderer.ts");
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { PlanningCodeExportDialog } = await server.ssrLoadModule("/planning/PlanningCodeExportDialog.ts");
  const { PlanningInput } = await server.ssrLoadModule("/planning/PlanningInput.ts");
  const { AppInput } = await server.ssrLoadModule("/app/input/AppInput.ts");
  const { LiveInput } = await server.ssrLoadModule("/live/LiveInput.ts");
  const { ViewingInput } = await server.ssrLoadModule("/viewing/ViewingInput.ts");
  const { SettingsView } = await server.ssrLoadModule("/app/settings/SettingsView.ts");
  const { WindowController } = await server.ssrLoadModule("/app/window/WindowController.ts");
  const { getMode, setMode } = await server.ssrLoadModule("/app/modeController.ts");

  for (const value of [null, undefined, "", "  ", NaN, Infinity, -Infinity])
    assert.equal(formatNumber(value), "—");

  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber("0"), "0");
  assert.equal(formatNumber(1.25), "1.25");
  assert.equal(formatNumber(null, 3, "Unavailable"), "Unavailable");

  {
    const viewing = new ViewingFeature();
    viewing.load({
      watches: [
        { t: 1, id: null, label: "A", value: "1" },
        { t: 2, label: "B", value: "2" },
        { t: 3, id: 0, label: "Zero", value: "3" },
        { t: 4, label: "A", value: "4" },
      ],
    });
    const [a, b, zero, laterA] = viewing.data.watches;
    assert.notEqual(watchKey(a), watchKey(b));
    assert.notEqual(watchGraphKey(a), watchGraphKey(b));
    assert.equal(
      watchGraphKey(a),
      watchGraphKey(laterA),
      "legacy graph samples still group by label",
    );
    assert.equal(watchKey(zero), "id:0");
    viewing.setWatchVisibility(a, false);
    assert.equal(a.visible, false);
    assert.equal(b.visible, true);
    assert.equal(zero.visible, true);
  }
  {
    const originalAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    try {
      for (const playing of [true, false]) {
        const viewing = new ViewingFeature();
        viewing.load({
          poses: [
            { t: 0, x: 1, y: 1 },
            { t: 1000, x: 10, y: 10 },
          ],
        });
        viewing.playback.play();
        viewing.playback.tick(0);
        viewing.playback.tick(500);
        if (!playing) viewing.playback.pause();
        viewing.load({
          poses: [
            { t: 2000, x: 100, y: 100 },
            { t: 3000, x: 200, y: 200 },
          ],
        });
        assert.equal(viewing.playback.isPlaying, false);
        assert.equal(viewing.playback.currentDisplayPose().x, 100);
        assert.equal(viewing.navigation.trackLockPose, null);
        viewing.playback.play();
        viewing.playback.tick(0);
        assert.equal(viewing.playback.currentDisplayPose().t, 2000);
        viewing.clear();
        assert.equal(viewing.playback.currentDisplayPose(), null);
        assert.equal(viewing.playback.timeMs, null);
      }
    } finally {
      globalThis.requestAnimationFrame = originalAnimationFrame;
      globalThis.cancelAnimationFrame = originalCancelFrame;
    }
  }
  {
    const viewing = new ViewingFeature();
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);
    try {
      for (let batch = 0; batch < 16; batch++) {
        viewing.appendLiveBatch({
          watches: Array.from({ length: 10_000 }, (_, index) => ({
            t: batch * 10_000 + index,
            id: 7,
            label: "Large",
            value: String(batch * 10_000 + index),
          })),
        });
      }
    } finally {
      console.error = originalError;
    }
    assert.equal(errors.length, 0);
    assert.equal(viewing.data.watches.length, 160_000);
    assert.equal(viewing.projection.watchMarkers.length, 160_000);
    assert.equal(viewing.projection.watchMarkersByTime.length, 160_000);
    const dom = Object.fromEntries(
      [
        "count",
        "average",
        "minimum",
        "maximum",
        "compareCount",
        "compareAverage",
        "compareMinimum",
        "compareMaximum",
        "latest",
        "compareLatest",
      ].map((name) => [name, field()]),
    );
    const graph = new WatchGraphView(viewing, dom);
    graph.renderStats(viewing.projection.watchMarkers, []);
    assert.equal(dom.count.textContent, "160000");
    assert.equal(dom.minimum.textContent, "0");
    assert.equal(dom.maximum.textContent, "159999");
    assert.equal(dom.average.textContent, "79999.5");
  }
  {
    const renderer = new FieldRenderer({ getContext: () => ({}) });
    for (const alpha of [0, 0.01, 0.5, 1]) {
      renderer.setRobotImageTransform({ alpha });
      assert.equal(renderer.getRobotImageTransform().alpha, alpha);
    }
    renderer.setRobotImageTransform({ alpha: NaN });
    assert.equal(renderer.getRobotImageTransform().alpha, 1);
  }

  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    const commands = [];
    let fullscreen = true;
    let keydown;
    globalThis.window = {
      addEventListener: (type, listener) => { if (type === "keydown") keydown = listener; },
      __TAURI_INTERNALS__: {
        invoke: async (command, args) => {
          commands.push(command);
          if (command === "get_window_fullscreen_state") return fullscreen;
          if (command === "set_windows_fullscreen") return fullscreen = args.enable;
          if (command === "reset_window_layout") { fullscreen = false; return; }
          throw new Error(`Unexpected window command: ${command}`);
        },
      },
    };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Windows" } });
    const controller = new WindowController();
    controller.bind();
    await new Promise(setImmediate);
    const dom = { resetWindowLayoutButton: field(), windowLayoutStatus: field() };
    const view = new SettingsView({}, dom, () => controller.resetLayout());
    await view.resetWindowLayout();
    assert(commands.includes("reset_window_layout"));
    assert.equal(dom.windowLayoutStatus.textContent, "Window centered at its default size.");
    assert.equal(dom.resetWindowLayoutButton.disabled, false);
    keydown({ key: "F11", preventDefault() {} });
    await new Promise(setImmediate);
    assert.equal(fullscreen, true, "F11 must enter fullscreen after resetting a fullscreen window");
    const failure = new SettingsView({}, dom, async () => { throw new Error("Window access failed"); });
    await failure.resetWindowLayout();
    assert.equal(dom.windowLayoutStatus.textContent, "Could not reset window: Window access failed");
    assert.equal(dom.resetWindowLayoutButton.disabled, false, "a failed reset remains retryable");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  }

  try {
    const planning = new PlanningFeature("move(${x}, ${y});");
    planning.load({
      "planned-path": [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ],
    });
    const dom = Object.fromEntries(
      [
        "codeExportHeader",
        "codeExportFooter",
        "codeExportPath",
        "codeExportTarget",
        "codeExportValidation",
        "codeExportSuccess",
        "codeExportConfirm",
      ].map((name) => [name, field()]),
    );
    dom.codeExportTarget.querySelector = () => ({ disabled: false });
    const writes = [];
    globalThis.window = {
      __TAURI_INTERNALS__: {
        invoke: async (command, args) => {
          if (command === "resolve_export_directory")
            return args.projectPath ?? "/Downloads";
          writes.push(args.path);
          return { path: args.path };
        },
      },
    };
    const dialog = new PlanningCodeExportDialog(
      planning,
      dom,
      {},
      { current: {} },
    );
    dom.codeExportTarget.value = "project";
    dom.codeExportPath.value = "/old-project/src/custom.cpp";
    dialog.setProjectPath("/new-project");
    assert.equal(dom.codeExportPath.value, "/new-project/src/custom.cpp");
    await dialog.export();
    assert.deepEqual(writes, ["/new-project/src/custom.cpp"]);
    dialog.applySettings({
      target: "project",
      path: "/stale-project/src/restored.cpp",
    });
    assert.equal(dom.codeExportPath.value, "/new-project/src/restored.cpp");
    dom.codeExportTarget.value = "custom";
    dom.codeExportPath.value = "/my/location/chosen.cpp";
    dialog.setProjectPath("/third-project");
    assert.equal(dom.codeExportPath.value, "/my/location/chosen.cpp");
    dom.codeExportTarget.value = "project";
    dialog.setProjectPath("C:\\robot");
    assert.equal(dom.codeExportPath.value, "C:\\robot\\src\\chosen.cpp");
    dom.codeExportTarget.value = "downloads";
    let resolveDirectory;
    window.__TAURI_INTERNALS__.invoke = () =>
      new Promise((resolve) => {
        resolveDirectory = resolve;
      });
    const filling = dialog.fillTargetPath();
    dom.codeExportTarget.value = "project";
    dialog.setProjectPath("/latest-project");
    resolveDirectory("/Downloads");
    await filling;
    assert.equal(
      dom.codeExportPath.value,
      "/latest-project/src/chosen.cpp",
      "an old directory response must not replace the current project's destination",
    );
    dialog.setProjectPath("");
    assert.equal(dom.codeExportPath.value, "");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
  {
    const originalDocument = globalThis.document;
    const previousMode = getMode();
    globalThis.document = {
      querySelectorAll: () => [
        {
          isConnected: true,
          closest: () => null,
          style: {},
          getClientRects: () => [{}],
        },
      ],
    };
    try {
      const fail = () => {
        throw new Error("a background command ran through a modal");
      };
      const commands = new Proxy({}, { get: () => fail });
      const event = {
        key: "Delete",
        target: null,
        defaultPrevented: false,
        preventDefault: fail,
      };
      setMode("planning");
      assert.equal(new PlanningInput({}, {}, {}).handleKeydown(event), false);
      assert.equal(new AppInput(commands).handleKeydown(event), false);
      setMode("viewing");
      assert.equal(new ViewingInput({}, {}).handleKeydown(event), false);
      assert.equal(new LiveInput({}).handleKeydown(event), false);
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      setMode(previousMode);
    }
  }
  console.log(
    "Release regression checks passed (large watches, imports/playback, identities, formatting, opacity, export targets, modal guards, window reset).",
  );
}

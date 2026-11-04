import assert from "node:assert/strict";

export async function runPlanningInputTests(server) {
  const { PlanningFeature } = await server.ssrLoadModule(
    "/planning/PlanningFeature.ts",
  );
  const { PlanningInput } = await server.ssrLoadModule(
    "/planning/PlanningInput.ts",
  );
  const { getMode, setMode } = await server.ssrLoadModule(
    "/app/modeController.ts",
  );
  const { getCurrentUnits, setCurrentUnits } =
    await server.ssrLoadModule("/shared/units.ts");
  const keys = ["document", "HTMLElement", "requestAnimationFrame"];
  const globals = Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const previousMode = getMode(),
    previousUnits = getCurrentUnits();
  const moveStep = { value: "0.5" };
  let rotation = 0;
  try {
    globalThis.HTMLElement = class {};
    globalThis.document = {
      querySelectorAll: () => [],
      getElementById: () => moveStep,
    };
    globalThis.requestAnimationFrame = () => 1;
    setMode("planning");
    setCurrentUnits("in");
    const planning = new PlanningFeature();
    const input = new PlanningInput(
      planning,
      { getFieldRotationDeg: () => rotation },
      {},
    );
    const reset = (x = 10, y = -10) => {
      planning.load({
        "planned-segment-export": true,
        "planned-path": [{ x, y, theta: 7, speed: 80 }],
      });
      planning.selection.selectWaypoint(0);
    };
    const press = (key, shiftKey = false) => {
      const event = {
        key,
        code: key,
        shiftKey,
        target: null,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      assert.equal(input.handleKeydown(event), true);
      assert.equal(event.defaultPrevented, true);
    };
    const near = (actual, expected) =>
      assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `${actual} differs from ${expected}`,
      );
    planning.projection.configure({
      positionSnap: 1,
      thetaSnap: 15,
      limitBounds: true,
    });

    // A half-grid move previously rounded Left/Down to zero and Right/Up to a full grid step.
    for (const [key, dx, dy] of [
      ["ArrowLeft", -1, 0],
      ["ArrowRight", 1, 0],
      ["ArrowDown", 0, -1],
      ["ArrowUp", 0, 1],
    ]) {
      for (const shift of [false, true]) {
        reset();
        const before = structuredClone(planning.route.waypoints[0]);
        press(key, shift);
        const distance = shift ? 2.5 : 0.5;
        near(planning.route.waypoints[0].x, 10 + dx * distance);
        near(planning.route.waypoints[0].y, -10 + dy * distance);
        assert.equal(
          planning.route.waypoints[0].theta,
          7,
          "position nudges preserve the heading",
        );
        const after = structuredClone(planning.route.waypoints[0]);
        assert.equal(planning.history.undo(), true);
        assert.deepEqual(planning.route.waypoints[0], before);
        assert.equal(planning.history.redo(), true);
        assert.deepEqual(planning.route.waypoints[0], after);
      }
    }
    reset();
    for (const key of [
      "ArrowLeft",
      "ArrowLeft",
      "ArrowRight",
      "ArrowRight",
      "ArrowDown",
      "ArrowUp",
    ])
      press(key);
    near(planning.route.waypoints[0].x, 10);
    near(planning.route.waypoints[0].y, -10);

    reset(71.9, -71.9);
    press("ArrowRight");
    press("ArrowDown");
    near(planning.route.waypoints[0].x, 72);
    near(planning.route.waypoints[0].y, -72);

    rotation = 90;
    reset();
    press("ArrowLeft");
    near(planning.route.waypoints[0].x, 10);
    near(planning.route.waypoints[0].y, -10.5);

    rotation = 0;
    setCurrentUnits("cm");
    moveStep.value = "2.54";
    reset();
    press("ArrowDown");
    near(planning.route.waypoints[0].y, -11);

    // Pointer placement and dragging retain the configured grid/heading snapping.
    const snapped = planning.projection.constrain({
      x: 10.4,
      y: -10.4,
      theta: 7,
    });
    assert.deepEqual(snapped, { x: 10, y: -10, theta: 0 });
  } finally {
    setMode(previousMode);
    setCurrentUnits(previousUnits);
    for (const [key, descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

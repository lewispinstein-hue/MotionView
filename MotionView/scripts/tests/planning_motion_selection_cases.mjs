import assert from "node:assert/strict";

export async function runPlanningMotionSelectionTests(server) {
  const { PlanningMotionSelection } = await server.ssrLoadModule("/planning/planningMotionSelection.ts");
  const { normalizeWaypointMotions } = await server.ssrLoadModule("/planning/planningMotions.ts");
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { generatePlanningCode } = await server.ssrLoadModule("/planning/planningCode.ts");
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const templates = { forward: "move(@x,@y,@fwd);", rotate: "turn(${theta});", swing: "swing(@th);", boomerang: "pose(@x,@y,@th);" };
  const selection = new PlanningMotionSelection(undefined, templates);
  const straightId = selection.motions[0].id;
  assert.deepEqual(selection.result, [{ id: straightId, type: "forward" }]);
  assert.equal(selection.swap(), false, "one motion cannot be swapped");
  assert.equal(selection.toggle("forward"), false, "at least one motion stays selected");
  assert.equal(selection.isSelected("forward"), true);
  assert.equal(selection.isSelected("rotate"), false);
  const customMove = "customMove(@x,@y);\nwait(@spd);";
  selection.updateCode(straightId, customMove);
  assert.equal(selection.toggle("boomerang"), true, "Boomerang replaces Straight when one motion is selected");
  assert.deepEqual(selection.motions.map(motion => motion.type), ["boomerang"]);
  assert.equal(selection.motions[0].code, templates.boomerang);
  assert.equal(selection.toggle("forward"), true);
  assert.deepEqual(selection.result, [{ id: straightId, type: "forward", overrideCode: customMove }],
    "switching back restores the original draft code and ID");
  assert.equal(selection.toggle("rotate"), true);
  const turnId = selection.motions[1].id;
  const customTurn = "customTurn(@th);";
  selection.updateCode(turnId, customTurn);
  assert.equal(selection.toggle("swing"), false, "unselected types are disabled while two motions are selected");
  assert.equal(selection.toggle("boomerang"), false);
  assert.equal(selection.swap(), true);
  assert.deepEqual(selection.result, [
    { id: turnId, type: "rotate", overrideCode: customTurn },
    { id: straightId, type: "forward", overrideCode: customMove },
  ]);
  assert.equal(selection.toggle("rotate"), true);
  assert.equal(selection.toggle("forward"), false);
  assert.equal(selection.toggle("rotate"), true);
  assert.equal(selection.result[1].id, turnId, "reselecting restores the same draft and code");
  assert.equal(selection.result[1].overrideCode, customTurn);
  selection.updateCode(turnId, templates.rotate);
  assert.equal(Object.hasOwn(selection.result[1], "overrideCode"), false, "matching the template restores linking");
  selection.updateCode(turnId, "");
  assert.equal(selection.result[1].overrideCode, "", "intentionally empty code remains an override");

  for (const input of [undefined, null, [], [{ type: "invalid" }]]) {
    assert.equal(normalizeWaypointMotions(input)[0].type, "forward", "missing or malformed motions default to Straight");
  }
  const normalized = normalizeWaypointMotions([
    { id: "same", type: "rotate", overrideCode: "first(@th);" },
    { id: "duplicate-type", type: "rotate", overrideCode: "mustNotAppear();" },
    { id: "same", type: "forward", overrideCode: "" },
    { id: "third", type: "swing" },
  ]);
  assert.deepEqual(normalized.map((motion) => motion.type), ["rotate", "forward"]);
  assert.equal(normalized[0].overrideCode, "first(@th);");
  assert.equal(normalized[1].overrideCode, "");
  assert.notEqual(normalized[0].id, normalized[1].id, "IDs are still repaired across distinct types");
  for (const types of [["rotate", "swing", "forward"], ["swing", "rotate", "boomerang"], ["forward", "boomerang", "rotate"], ["boomerang", "forward", "swing"]]) {
    assert.deepEqual(normalizeWaypointMotions(types.map((type, index) => ({ id: String(index), type }))).map(motion => motion.type),
      [types[0], types[2]], "normalization keeps the first motion in each group and preserves order");
  }
  const single = new PlanningMotionSelection([{ id: "only-turn", type: "rotate" }], templates);
  single.updateCode("only-turn", "customTurn(@th);");
  assert.equal(single.toggle("swing"), true);
  assert.deepEqual(single.motions.map(motion => motion.type), ["swing"]);
  const swingId = single.motions[0].id;
  single.updateCode(swingId, "customSwing(@th);");
  single.setLockedDriveSide(swingId, "right");
  assert.equal(single.toggle("rotate"), true);
  assert.deepEqual(single.result, [{ id: "only-turn", type: "rotate", overrideCode: "customTurn(@th);" }]);
  assert.equal(single.toggle("swing"), true);
  assert.deepEqual(single.result, [{ id: swingId, type: "swing", overrideCode: "customSwing(@th);", lockedDriveSide: "right" }]);
  assert.equal(single.toggle("swing"), false, "replacing the only motion does not permit an empty selection");

  // Reopening/Cancel never mutates the supplied data, and Swap preserves IDs.
  const saved = [{ id: "saved-turn", type: "rotate", overrideCode: "saved(@th);" }, { id: "saved-move", type: "forward" }];
  const original = structuredClone(saved);
  const reopened = new PlanningMotionSelection(saved, templates);
  reopened.updateCode("saved-turn", "draftOnly();");
  reopened.swap();
  reopened.toggle("forward");
  assert.deepEqual(saved, original);
  assert.deepEqual(new PlanningMotionSelection(saved, templates).result, original);

  const planning = new PlanningFeature();
  planning.load({
    "planned-segment-export": true,
    "planned-motion-templates": templates,
    "planned-path": [
      { x: 0, y: 0, theta: 0, speed: 70 },
      { x: 10, y: 20, theta: 90, speed: 80 },
    ],
  });
  const before = generatePlanningCode(planning);
  selection.updateCode(turnId, customTurn);
  selection.swap();
  planning.route.updateMotions(0, selection.result);
  assert.equal(generatePlanningCode(planning), "customTurn(90);\ncustomMove(10,20);\nwait(70);");
  assert.equal(planning.history.undo(), true);
  assert.equal(generatePlanningCode(planning), before);
  assert.equal(planning.history.redo(), true);
  assert.deepEqual(planning.route.waypoints[0].motions, selection.result);
  const serializer = new MotionViewDocumentSerializer({
    planning, viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } }, version: "test",
  });
  for (const document of [JSON.parse(serializer.savedPaths()), serializer.exportPayload("planning", "Selector Route", {})]) {
    const restored = new PlanningFeature();
    restored.load(document);
    assert.deepEqual(restored.route.waypoints[0].motions, selection.result);
    assert.equal(generatePlanningCode(restored), generatePlanningCode(planning));
  }
  await runVerticalReorderAnimationTests(server);
}

async function runVerticalReorderAnimationTests(server) {
  const original = Object.fromEntries(["window", "requestAnimationFrame"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let reducedMotion = false;
  const frames = [];
  globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  try {
    const { captureVerticalPositions, animateVerticalReorder } = await server.ssrLoadModule("/planning/render/verticalReorderAnimation.ts");
    const row = (id, top) => ({
      dataset: { methodId: id }, animations: [],
      getBoundingClientRect: () => ({ top }),
      animate(keyframes, options) { this.animations.push({ keyframes, options }); },
    });
    const positions = captureVerticalPositions([row("first", 10), row("second", 40), row("still", 70)], "methodId");
    let items = [];
    animateVerticalReorder(() => items, "methodId", positions);
    assert.equal(frames.length, 1);
    items = [row("second", 10), row("first", 40), row("still", 70.2), row("new", 100)];
    frames.shift()();
    assert.deepEqual(items[0].animations, [{
      keyframes: [{ transform: "translateY(30px)" }, { transform: "translateY(0)" }],
      options: { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    }]);
    assert.equal(items[1].animations[0].keyframes[0].transform, "translateY(-30px)");
    assert.equal(items[2].animations.length, 0);
    assert.equal(items[3].animations.length, 0);
    reducedMotion = true;
    animateVerticalReorder(() => items, "methodId", positions);
    assert.equal(frames.length, 0, "method reordering still respects reduced motion");
  } finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

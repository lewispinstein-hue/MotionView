import assert from "node:assert/strict";

export async function runPlanningMotionTests(server) {
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { generatePlanningCode } = await server.ssrLoadModule("/planning/planningCode.ts");
  const { normalizeWaypointMotions, waypointMotionsForEditing } = await server.ssrLoadModule("/planning/planningMotions.ts");
  const { createMotionCodeDocument, applyMotionCodeEdit } = await server.ssrLoadModule("/planning/planningMotionCode.ts");
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const points = [
    { x: 0, y: 0, theta: 0, speed: 50 },
    { x: 10, y: 20, theta: 90, speed: 70 },
    { x: 20, y: 30, theta: 180, speed: 100 },
  ];
  const legacy = { ...points[0], indicatorIcons: ["swing", "rotate"], overrideCode: "oldMove(@x);\noldTurn(@th);" };
  const legacyMotions = waypointMotionsForEditing(legacy);
  assert.equal(legacyMotions.length, 1);
  assert.equal(legacyMotions[0].type, "forward");
  assert.equal(legacyMotions[0].overrideCode, legacy.overrideCode);
  assert.deepEqual(waypointMotionsForEditing({ ...points[0], motions: [] }), []);

  const planning = new PlanningFeature("legacy(@x);");
  planning.load({ "planned-segment-export": true, "planned-path": points });
  assert.equal(generatePlanningCode(planning), "legacy(10);\nlegacy(20);");
  planning.setMotionTemplates({
    forward: "move(@x,@y,@th,@dist,@iter,@spd,@fwd);",
    rotate: "turn(${theta});",
    swing: "swing(@th);",
    boomerang: "pose(${x},${y},${theta});",
  });
  const customCode = "customTurn(@th);\nwait(@spd);";
  const motions = [
    { id: "linear", type: "forward" },
    { id: "edited", type: "rotate", overrideCode: customCode },
    { id: "silent", type: "rotate", overrideCode: "" },
    { id: "pivot", type: "swing" },
  ];
  planning.route.updateMotions(0, motions);
  assert.equal(generatePlanningCode(planning), [
    "move(10,20,90,22.361,0,50,true);",
    "customTurn(90);", "wait(50);", "", "swing(90);",
    "move(20,30,180,14.142,1,70,true);",
  ].join("\n"));
  assert.equal(Object.hasOwn(planning.route.waypoints[0], "overrideCode"), false);

  planning.route.updateMotions(0, [...motions].reverse());
  assert.deepEqual(planning.route.waypoints[0].motions.map((motion) => motion.id), ["pivot", "silent", "edited", "linear"]);
  assert.equal(planning.route.waypoints[0].motions.find((motion) => motion.id === "edited").overrideCode, customCode);
  assert.ok(generatePlanningCode(planning).startsWith("swing(90);\n\ncustomTurn(90);\nwait(50);\nmove("));
  planning.route.updateMotions(0, planning.route.waypoints[0].motions.filter((motion) => motion.id !== "silent"));
  planning.route.updateMotions(0, [...planning.route.waypoints[0].motions, { id: "pose", type: "boomerang" }]);
  assert.equal(planning.route.waypoints[0].motions.find((motion) => motion.id === "edited").overrideCode, customCode);
  assert.ok(generatePlanningCode(planning).includes("pose(10,20,90);"));

  // Only linked instances follow template changes, not edited instances of that type.
  planning.setMotionTemplates({ ...planning.motionTemplates, rotate: "newTurn(@th);", forward: "newMove(@x);" });
  assert.ok(generatePlanningCode(planning).includes("customTurn(90);\nwait(50);\nnewMove(10);"));
  assert.ok(!generatePlanningCode(planning).includes("newTurn("));
  planning.route.updateMotions(0, [{ id: "linked", type: "rotate", overrideCode: "newTurn(@th);" }]);
  assert.equal(Object.hasOwn(planning.route.waypoints[0].motions[0], "overrideCode"), false);
  planning.setMotionTemplates({ ...planning.motionTemplates, rotate: "changedAgain(@th);" });
  assert.ok(generatePlanningCode(planning).startsWith("changedAgain(90);"));
  assert.equal(planning.history.undo(), true);
  assert.equal(planning.motionTemplates.rotate, "newTurn(@th);");
  assert.equal(planning.history.redo(), true);
  assert.equal(planning.motionTemplates.rotate, "changedAgain(@th);");

  const empty = new PlanningFeature("default(@x);");
  empty.load({ "planned-segment-export": true, "planned-path": points.slice(0, 2) });
  empty.route.updateMotions(0, []);
  assert.equal(generatePlanningCode(empty), "");
  empty.route.updateMotions(0, [{ id: "empty-code", type: "forward", overrideCode: "" }]);
  assert.equal(generatePlanningCode(empty), "");
  assert.equal(Object.hasOwn(empty.route.waypoints[0].motions[0], "overrideCode"), true);
  empty.route.updateMotions(1, [{ id: "final", type: "forward", overrideCode: "mustNotExport();" }]);
  assert.equal(generatePlanningCode(empty), "");

  const normalized = normalizeWaypointMotions([
    null, 1, { id: "bad", type: "unknown" },
    { id: "same", type: "forward", overrideCode: "" },
    { id: "same", type: "forward", overrideCode: "raw(@x);" },
    { type: "rotate", overrideCode: 42 },
    { id: "last", type: "swing" },
    { id: "overflow", type: "boomerang" },
  ]);
  assert.equal(normalized.length, 4);
  assert.equal(new Set(normalized.map((motion) => motion.id)).size, 4);
  assert.deepEqual(normalized.map((motion) => motion.type), ["forward", "forward", "rotate", "swing"]);
  assert.equal(normalized[0].overrideCode, "");
  assert.equal(Object.hasOwn(normalized[2], "overrideCode"), false);

  // One atomic waypoint update participates in cross-path undo and deep cloning.
  const firstPath = planning.paths.activeId;
  const secondPath = planning.paths.add();
  planning.route.replace(points.slice(0, 2));
  planning.route.updateMotions(0, []);
  planning.paths.select(firstPath);
  const beforeEdit = structuredClone(planning.route.waypoints[0]);
  planning.route.updateMotions(0, motions);
  const afterEdit = structuredClone(planning.route.waypoints[0]);
  planning.paths.select(secondPath);
  assert.equal(planning.history.undo(), true);
  assert.equal(planning.paths.activeId, firstPath);
  assert.deepEqual(planning.route.waypoints[0], beforeEdit);
  assert.equal(planning.history.redo(), true);
  assert.deepEqual(planning.route.waypoints[0], afterEdit);
  planning.paths.updateCodeExportSettings({ header: "header();", footer: "footer();", target: "custom", path: "/tmp/motions.cpp" });

  const app = {
    planning,
    viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } },
    version: "test",
  };
  const serializer = new MotionViewDocumentSerializer(app);
  const payload = serializer.exportPayload("planning", "Motion Routes", {});
  assert.equal(payload.meta.SchemaVersion, 5);
  assert.deepEqual(payload["planned-motion-templates"], planning.motionTemplates);
  assert.deepEqual(payload["planned-path"][0].motions, motions);
  assert.equal(payload["planned-paths"].length, 2);
  for (const data of [JSON.parse(JSON.stringify(payload)), JSON.parse(serializer.savedPaths())]) {
    const restored = new PlanningFeature();
    restored.load(data);
    assert.deepEqual(restored.motionTemplates, planning.motionTemplates);
    assert.deepEqual(restored.paths.items, planning.paths.items);
    assert.equal(restored.paths.activeId, planning.paths.activeId);
    assert.equal(generatePlanningCode(restored), generatePlanningCode(planning));
    assert.equal(restored.route.waypoints[0].motions[1].overrideCode, customCode);
    assert.equal(restored.paths.items.find((path) => path.id === secondPath).waypoints[0].motions.length, 0);
  }

  const derivedId = planning.paths.derive(firstPath);
  assert.ok(derivedId);
  const source = planning.paths.items.find((path) => path.id === firstPath);
  const derived = planning.paths.active;
  assert.deepEqual(derived.waypoints[0].motions.map(({ id, ...motion }) => motion), motions.map(({ id, ...motion }) => motion));
  assert.ok(derived.waypoints[0].motions.every((motion, index) => motion.id !== source.waypoints[0].motions[index].id));
  planning.route.updateMotions(0, [{ id: "copy-only", type: "swing", overrideCode: "copyOnly(@x);" }]);
  assert.deepEqual(source.waypoints[0].motions, motions);
  planning.paths.mirror("left-right");
  assert.equal(planning.route.waypoints[0].motions[0].overrideCode, "copyOnly(@x);");
  planning.setMotionTemplates({ forward: "", rotate: "", swing: "", boomerang: "" });
  const restoredEmptyTemplates = new PlanningFeature();
  restoredEmptyTemplates.load(JSON.parse(serializer.savedPaths()));
  assert.equal(restoredEmptyTemplates.exportTemplate, "");
  assert.deepEqual(restoredEmptyTemplates.motionTemplates, planning.motionTemplates);

  // UI range bookkeeping tracks IDs, even for identical repeated motion types.
  const entries = [
    { id: "first", name: "Turn", code: "turn(@th);" },
    { id: "second", name: "Turn", code: "turn(@th);" },
    { id: "third", name: "Swing", code: "" },
  ];
  let document = createMotionCodeDocument(entries);
  const second = document.ranges[1];
  const changed = "// Turn: is just code here\ncustom(@x);\nwait();";
  const edit = applyMotionCodeEdit(document, document.source.slice(0, second.start) + changed + document.source.slice(second.end), "second");
  assert.equal(edit.id, "second");
  assert.equal(edit.code, changed);
  entries[1].code = edit.code;
  document = edit.document;
  const emptyRange = document.ranges[2];
  const insert = applyMotionCodeEdit(document, document.source.slice(0, emptyRange.start) + "\n" + document.source.slice(emptyRange.end), "third");
  assert.equal(insert.id, "third");
  assert.equal(insert.code, "\n");
  assert.equal(applyMotionCodeEdit(document, "unowned replacement"), null);
  const reordered = createMotionCodeDocument([entries[1], entries[0], { id: "added", name: "Straight", code: "move();" }]);
  assert.ok(reordered.source.startsWith(`\n${changed}`));
  assert.equal(reordered.ranges[0].id, "second");
  const removed = createMotionCodeDocument([entries[0]]);
  assert.ok(!removed.source.includes("custom("));
}

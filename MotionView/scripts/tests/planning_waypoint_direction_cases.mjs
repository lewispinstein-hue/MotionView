import assert from "node:assert/strict";

export async function runPlanningWaypointDirectionTests(server) {
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { PlanningWaypointEditor } = await server.ssrLoadModule("/planning/PlanningWaypointEditor.ts");
  const { generatePlanningCode } = await server.ssrLoadModule("/planning/planningCode.ts");
  const { isSegmentForwards, PlanningSegment } = await server.ssrLoadModule("/planning/planningSegments.ts");
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const points = [{ x: 0, y: 0, theta: 0, speed: 90 }, { x: 30, y: 30, theta: 90 }];
  const planning = new PlanningFeature("move(@fwd,${forwards});");
  planning.load({ "planned-segment-export": true, "planned-path": points });
  assert.equal(generatePlanningCode(planning), "move(true,true);", "legacy plans keep inferred direction");
  assert.equal(isSegmentForwards({ ...points[0], theta: 180 }, points[1]), false);
  assert.equal(isSegmentForwards({ ...points[0], theta: 180, forwards: true }, points[1]), true);
  assert.equal(isSegmentForwards({ ...points[0], forwards: false }, points[1]), false);
  assert.equal(isSegmentForwards({ ...points[0], forwards: false }, points[0]), false);

  // Cancel never applies a draft. Confirm saves code and direction as one edit.
  let editorOptions;
  let editorResult = null;
  const editor = new PlanningWaypointEditor(planning, {
    edit: async (options) => { editorOptions = options; return editorResult; },
    confirm: async () => true,
  });
  await editor.edit(0);
  assert.equal(editorOptions.motionEditor.forwards, true);
  assert.equal(Object.hasOwn(planning.route.waypoints[0], "forwards"), false);
  assert.equal(planning.history.undo(), false, "Cancel adds no history");
  editorResult = { motions: [{ id: "travel", type: "forward", overrideCode: "custom(@fwd,${forwards});" }], forwards: false };
  const originalSegment = planning.projection.segments[0];
  await editor.edit(0);
  assert.equal(planning.route.waypoints[0].forwards, false);
  assert.equal(generatePlanningCode(planning), "custom(false,false);");
  assert.notEqual(planning.projection.segments[0], originalSegment, "direction edits invalidate geometry");
  assert.equal(planning.projection.segments[0].forwards, false);
  assert.equal(planning.history.undo(), true);
  assert.equal(Object.hasOwn(planning.route.waypoints[0], "forwards"), false);
  assert.equal(generatePlanningCode(planning), "move(true,true);");
  assert.equal(planning.history.undo(), false, "code and direction are one undo step");
  assert.equal(planning.history.redo(), true);
  await editor.edit(0);
  assert.equal(editorOptions.motionEditor.forwards, false, "reopening uses the explicit choice");
  planning.route.updateField(0, "theta", 180);
  planning.route.updateField(1, "y", -30);
  assert.equal(planning.route.waypoints[0].forwards, false, "heading and target edits cannot change intent");
  assert.equal(generatePlanningCode(planning), "custom(false,false);");
  planning.route.replace(points);
  planning.route.updateMotions(0, [{ id: "curve", type: "boomerang" }], false);
  const backwards = planning.projection.segments[0];
  assert.equal(backwards.forwards, false);
  planning.route.updateMotions(0, planning.route.waypoints[0].motions, true);
  const forwards = planning.projection.segments[0];
  assert.notEqual(forwards, backwards);
  assert.equal(forwards.forwards, true);
  assert.notDeepEqual(forwards.leadAxis, backwards.leadAxis, "reverse changes the carrot side");
  assert.notDeepEqual(forwards.samples, backwards.samples, "direction reaches the controller preview");
  const mutable = { ...points[0], lead: 0.6, forwards: true };
  const segment = new PlanningSegment(mutable, points[1], planning.simulationConfiguration);
  mutable.forwards = false;
  assert.equal(segment.matches(mutable, points[1], planning.simulationConfiguration), false);

  planning.route.updateMotions(0, [{ id: "straight", type: "forward" }], false);
  planning.route.toggleBoomerang(0);
  planning.route.toggleBoomerang(0);
  assert.equal(planning.route.waypoints[0].forwards, false, "switching motion types preserves direction");
  planning.route.mirror("left-right");
  planning.route.mirror("top-bottom");
  assert.equal(planning.route.waypoints[0].forwards, false, "reflection preserves direction");
  const originalPath = planning.paths.activeId;
  const derived = planning.paths.derive(originalPath);
  assert.equal(planning.route.waypoints[0].forwards, false);
  planning.route.updateMotions(0, planning.route.waypoints[0].motions, true);
  planning.paths.select(originalPath);
  assert.equal(planning.route.waypoints[0].forwards, false, "derived routes own their direction data");
  const serializer = new MotionViewDocumentSerializer({ planning, viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } }, version: "test" });
  for (const document of [JSON.parse(serializer.savedPaths()), serializer.exportPayload("planning", "Direction", {})]) {
    const restored = new PlanningFeature();
    restored.load(document);
    assert.equal(restored.route.waypoints[0].forwards, false, "false survives persistence");
    assert.equal(generatePlanningCode(restored), generatePlanningCode(planning));
    restored.paths.select(derived);
    assert.equal(restored.route.waypoints[0].forwards, true, "inactive routes persist direction too");
  }

  // Inherited and overridden timeline code use the same direction as waypoint code.
  const withNodes = new PlanningFeature("move(@fwd,${forwards});");
  withNodes.load({
    "planned-segment-export": true,
    "planned-path": [{ ...points[0], forwards: false }, points[1]],
    "planned-objects": [{ id: "object", name: "Object", methods: [{ id: "method", name: "Method", code: "node(@fwd,${forwards});" }] }],
    "planned-nodes": [
      { id: "start", objectId: "object", methodId: "method", beforeWaypoint: 0, index: 0 },
      { id: "after", objectId: "object", methodId: "method", beforeWaypoint: 1, index: 0, code: "override(@fwd,${forwards});" },
    ],
  });
  assert.equal(generatePlanningCode(withNodes), "node(false,false);\nmove(false,false);\noverride(false,false);");
  for (const invalid of ["false", "true", 0, 1, null, {}, []]) {
    withNodes.load({ "planned-segment-export": true, "planned-path": [{ ...points[0], forwards: invalid }, points[1]] });
    assert.equal(Object.hasOwn(withNodes.route.waypoints[0], "forwards"), false, "imports accept booleans only");
  }
}

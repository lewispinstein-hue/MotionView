import assert from "node:assert/strict";
import { runBoomerangPreviewTests } from "./planning_boomerang_preview_cases.mjs";

const near = (actual, expected, message) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-8,
    `${message ?? "value"}: ${actual} != ${expected}`,
  );

export async function runPlanningBoomerangTests(server) {
  await runBoomerangPreviewTests(server);
  const { PlanningSegment, normalizePlanningLead, waypointLead } =
    await server.ssrLoadModule("/planning/planningSegments.ts");
  const { PlanningFeature } = await server.ssrLoadModule(
    "/planning/PlanningFeature.ts",
  );
  const { generatePlanningCode } = await server.ssrLoadModule(
    "/planning/planningCode.ts",
  );
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule(
    "/app/persistence/MotionViewDocumentSerializer.ts",
  );
  const { stringifyExportJson } = await server.ssrLoadModule(
    "/app/export/exportJson.ts",
  );
  const points = [
    { x: 0, y: 0, theta: 0, speed: 90 },
    { x: 30, y: 30, theta: 90, speed: 100 },
  ];
  const straight = new PlanningSegment(...points);
  assert.equal(straight.curved, false);
  assert.ok(straight.length >= Math.hypot(30, 30) - 0.5);
  assert.deepEqual(straight.pointAt(0), { x: 0, y: 0 });
  assert.ok(
    straight.tangentAt(0).y > 0.99,
    "Straight respects starting heading while approaching its target",
  );
  const curve = new PlanningSegment({ ...points[0], lead: 0.6 }, points[1]);
  assert.equal(curve.curved, true);
  near(curve.headingAt(0), 0, "preview begins at the starting heading");
  assert.ok(
    curve.tangentAt(0).y > 0.99,
    "initial travel follows the starting heading",
  );
  assert.ok(
    Math.abs(curve.headingAt(1) - 90) < 1.5,
    "controller settles on the final heading",
  );
  assert.equal(curve.previewConverged, true);
  assert.deepEqual(curve.pointAt(0), { x: 0, y: 0 });
  assert.ok(
    curve.previewTargetError < 1,
    "nominal preview settles near, not forcibly onto, the target",
  );
  assert.ok(curve.length > straight.length);
  assert.notDeepEqual(curve.pointAt(0.5), straight.pointAt(0.5));
  near(
    curve.leadAfterDrag(0.6, 0, 50),
    0.6,
    "perpendicular handle movement is ignored",
  );
  near(curve.leadAfterDrag(0.6, -curve.chordLength * 0.1, 0), 0.7);
  assert.equal(curve.leadAfterDrag(0.6, -1000, 0), 1);
  assert.equal(curve.leadAfterDrag(0.6, 1000, 0), 0);
  const reverse = new PlanningSegment(
    { ...points[0], theta: 180, lead: 0.6 },
    { ...points[1], theta: 270 },
  );
  assert.equal(reverse.forwards, false);
  near(reverse.headingAt(0), 180);
  const firstReverseTravel = reverse.samples.find(
    (sample) => sample.distance > 0,
  );
  assert.ok(
    firstReverseTravel.y /
      Math.hypot(firstReverseTravel.x, firstReverseTravel.y) >
      0.99,
    "backwards travel starts opposite the robot heading, after any initial turn in place",
  );
  assert.ok(Math.abs(reverse.headingAt(1) - 270) < 1.5);
  for (const value of [NaN, Infinity, undefined, null, "oops"])
    assert.equal(normalizePlanningLead(value), 0.6);
  assert.equal(normalizePlanningLead(-10), 0);
  assert.equal(normalizePlanningLead(10), 1);
  assert.equal(waypointLead(points[0]), 0);
  const zero = new PlanningSegment({ ...points[0], lead: 0 }, points[1]);
  assert.notEqual(
    zero.length,
    straight.length,
    "lead=0 is still a controller motion, not a forced straight segment",
  );
  assert.ok(
    zero.previewTargetError > 1e-8,
    "retain the actual settling offset instead of snapping the preview onto its target",
  );
  const coincident = new PlanningSegment(
    { ...points[0], lead: 0.6 },
    points[0],
  );
  assert.equal(coincident.length, 0);
  assert.deepEqual(coincident.pointAt(0.5), { x: 0, y: 0 });
  assert.equal(coincident.leadAfterDrag(0.6, 10, 10), 0.6);

  const planning = new PlanningFeature("linear(@x,@y,@ld,${lead});");
  planning.load({ "planned-segment-export": true, "planned-path": points });
  planning.setMotionTemplates({
    ...planning.motionTemplates,
    boomerang: "curve(@x,@y,@th,@ld,${lead},@fwd);",
  });
  const originalCode = generatePlanningCode(planning);
  planning.route.toggleBoomerang(0);
  assert.equal(planning.route.waypoints[0].motions[0].type, "boomerang");
  assert.equal(generatePlanningCode(planning), "curve(30,30,90,0.6,0.6,true);");
  planning.history.begin("route");
  planning.route.updateLead(0, 0.4);
  planning.route.updateLead(0, 0.25);
  planning.history.commit();
  assert.equal(
    generatePlanningCode(planning),
    "curve(30,30,90,0.25,0.25,true);",
  );
  assert.equal(planning.history.undo(), true);
  near(planning.route.waypoints[0].lead, 0.6);
  assert.equal(planning.history.redo(), true);
  near(planning.route.waypoints[0].lead, 0.25);
  planning.route.toggleBoomerang(0);
  assert.equal(planning.route.waypoints[0].motions[0].type, "forward");
  assert.equal(Object.hasOwn(planning.route.waypoints[0], "lead"), false);
  assert.equal(generatePlanningCode(planning), originalCode);
  planning.history.undo();
  near(planning.route.waypoints[0].lead, 0.25);
  planning.route.updateMotions(0, [
    { id: "turn", type: "rotate", overrideCode: "turnCustom();" },
    { id: "travel", type: "boomerang", overrideCode: "myCurve(@ld);" },
  ]);
  planning.route.toggleBoomerang(0);
  assert.deepEqual(planning.route.waypoints[0].motions, [
    { id: "turn", type: "rotate", overrideCode: "turnCustom();" },
    { id: "travel", type: "forward", overrideCode: "myCurve(@ld);" },
  ]);
  planning.route.toggleBoomerang(0);
  assert.equal(generatePlanningCode(planning), "turnCustom();\nmyCurve(0.6);");
  planning.route.updateLead(0, 0.35);

  // Nodes retain the existing preceding-waypoint context, including bucket 0.
  planning.load({
    "planned-segment-export": true,
    "planned-path": planning.route.waypoints,
    "planned-motion-templates": planning.motionTemplates,
    "planned-objects": [
      {
        id: "object",
        name: "Object",
        methods: [
          {
            id: "method",
            name: "Method",
            code: "node(@ld,${lead},@ld_more,${unknown});",
          },
        ],
      },
    ],
    "planned-nodes": [
      {
        id: "initial",
        objectId: "object",
        methodId: "method",
        beforeWaypoint: 0,
        index: 0,
      },
      {
        id: "onCurve",
        objectId: "object",
        methodId: "method",
        beforeWaypoint: 1,
        index: 0,
      },
    ],
  });
  assert.equal(
    generatePlanningCode(planning),
    "node(0.35,0.35,@ld_more,${unknown});\nturnCustom();\nmyCurve(0.35);\nnode(0.35,0.35,@ld_more,${unknown});",
  );
  const placement = planning.projection.nodePlacements[0];
  const segment = planning.projection.segments[0];
  const expectedPlacement = segment.pointAt(
    segment.progressAtDistance(placement.distance),
  );
  near(placement.x, expectedPlacement.x);
  near(placement.y, expectedPlacement.y);
  const midway = planning.projection.sample(segment.length / 2);
  const expectedMidway = segment.pointAt(
    segment.progressAtDistance(segment.length / 2),
  );
  near(midway.x, expectedMidway.x);
  near(midway.y, expectedMidway.y);
  near(planning.projection.sample(0).theta, 0);
  near(
    planning.projection.sample(segment.length).theta,
    segment.headingAt(1),
    "playback retains the actual terminal heading",
  );

  // Reflection mirrors the entire curve, not just its endpoints.
  const beforeMirror = segment.pointAt(0.4);
  planning.route.mirror("left-right");
  const afterMirror = planning.projection.segments[0].pointAt(0.4);
  near(afterMirror.x, -beforeMirror.x);
  near(afterMirror.y, beforeMirror.y);
  planning.route.mirror("left-right");
  planning.route.mirror("top-bottom");
  const verticalMirror = planning.projection.segments[0].pointAt(0.4);
  near(verticalMirror.x, beforeMirror.x);
  near(verticalMirror.y, -beforeMirror.y);
  planning.route.mirror("top-bottom");

  const originalPath = planning.paths.activeId;
  const derived = planning.paths.derive(originalPath);
  near(planning.paths.active.waypoints[0].lead, 0.35);
  planning.route.updateLead(0, 0.8);
  planning.paths.select(originalPath);
  near(planning.route.waypoints[0].lead, 0.35, "deriving isolates curve data");
  const serializer = new MotionViewDocumentSerializer({
    planning,
    viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } },
    version: "test",
  });
  for (const document of [
    JSON.parse(serializer.savedPaths()),
    serializer.exportPayload("planning", "Curves", {}),
  ]) {
    const restored = new PlanningFeature();
    restored.load(document);
    near(restored.route.waypoints[0].lead, 0.35);
    assert.equal(
      generatePlanningCode(restored),
      generatePlanningCode(planning),
    );
    restored.paths.select(derived);
    near(
      restored.route.waypoints[0].lead,
      0.8,
      "inactive paths retain lead too",
    );
  }
  planning.route.updateLead(0, 0.345678);
  const rounded = new PlanningFeature();
  rounded.load(
    JSON.parse(
      stringifyExportJson(serializer.exportPayload("planning", "Curves", {})),
    ),
  );
  near(
    rounded.route.waypoints[0].lead,
    0.346,
    "file exports apply the existing three-decimal precision to lead",
  );
  planning.load({
    "planned-segment-export": true,
    "planned-path": [
      { ...points[0], lead: 100 },
      { ...points[1], lead: "bad" },
    ],
  });
  near(planning.route.waypoints[0].lead, 1);
  assert.equal(Object.hasOwn(planning.route.waypoints[1], "lead"), false);
  planning.route.updateMotions(0, [{ id: "boom", type: "boomerang" }]);
  assert.equal(planning.projection.segments[0].curved, true);
  planning.route.updateMotions(0, [{ id: "straight", type: "forward" }]);
  assert.equal(planning.projection.segments[0].curved, false);
  planning.route.toggleBoomerang(1);
  assert.equal(
    planning.route.waypoints[1].motions,
    undefined,
    "the final waypoint cannot toggle a non-existent segment",
  );
  planning.route.updateMotions(0, [
    { id: "turn", type: "rotate", overrideCode: "keepTurn();" },
  ]);
  const turn = structuredClone(planning.route.waypoints[0].motions[0]);
  assert.equal(
    planning.route.toggleBoomerang(0),
    true,
    "a segment toggle can add movement beside an angular motion",
  );
  assert.deepEqual(
    planning.route.waypoints[0].motions.map((motion) => motion.type),
    ["boomerang", "rotate"],
  );
  assert.deepEqual(planning.route.waypoints[0].motions[1], turn);
  planning.route.updateMotions(0, [{ id: "boom", type: "boomerang" }]);
  near(
    planning.route.waypoints[0].lead,
    0.6,
    "choosing Boomerang in the modal enables the default curve",
  );
  assert.ok(
    generatePlanningCode(planning).includes(".lead = 0.6"),
    "new default Boomerang code includes lead",
  );

  await runFieldInteractionTests(server, PlanningFeature, points);
}

async function runFieldInteractionTests(server, PlanningFeature, points) {
  const { PlanningFieldView } = await server.ssrLoadModule(
    "/planning/render/PlanningFieldView.ts",
  );
  const { PlanningSegmentsView } = await server.ssrLoadModule(
    "/planning/render/PlanningSegmentsView.ts",
  );
  const { setMode } = await server.ssrLoadModule("/app/modeController.ts");
  const keys = ["document", "HTMLInputElement", "requestAnimationFrame"];
  const globals = Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const listeners = new Map();
  const canvas = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const dots = [];
  const labels = [];
  const context = new Proxy(
    {
      arc(x, y) {
        dots.push({ x, y });
      },
      fillText(text) {
        labels.push({ text, color: this.fillStyle });
      },
    },
    { get: (target, key) => target[key] ?? (() => {}) },
  );
  const field = {
    ctx: context,
    sizes: { screen: (size) => size },
    worldToScreen: (x, y) => ({ x: 100 + x * 10, y: 500 - y * 10 }),
    screenToWorld: (x, y) => ({ x: (x - 100) / 10, y: (500 - y) / 10 }),
    getFieldRotationDeg: () => 0,
    getBounds: () => ({ minX: -72, maxX: 72, minY: -72, maxY: 72 }),
    beginPan() {},
    movePan() {},
    endPan: () => false,
  };
  try {
    globalThis.document = { activeElement: null };
    globalThis.HTMLInputElement = class {};
    globalThis.requestAnimationFrame = () => 1;
    setMode("planning");
    const planning = new PlanningFeature();
    planning.load({ "planned-segment-export": true, "planned-path": points });
    const view = new PlanningFieldView(
      planning,
      field,
      { canvas, cursorPill: {} },
      {},
      {},
      {},
    );
    view.bind();
    const send = (type, point, button = 0) =>
      listeners.get(type)({
        type,
        pointerId: 1,
        clientX: point.x,
        clientY: point.y,
        button,
        preventDefault() {},
      });
    const click = (point, button = 0) => {
      send("pointerdown", point, button);
      send("pointerup", point, button);
    };
    planning.selection.selectWaypoint(0);
    click(field.worldToScreen(-80, 0));
    assert.equal(
      planning.selection.waypointIndices.size,
      0,
      "clicking outside field bounds deselects a waypoint without adding one",
    );
    assert.equal(planning.route.length, 2);
    planning.selection.setWaypoints([0, 1]);
    click(field.worldToScreen(0, 80));
    assert.equal(
      planning.selection.waypointIndices.size,
      0,
      "clicking outside field bounds clears multiple selected waypoints",
    );
    click(
      field.worldToScreen(
        ...Object.values(planning.projection.segments[0].pointAt(0.5)),
      ),
    );
    assert.equal(
      planning.route.length,
      2,
      "clicking a segment toggles it instead of appending a waypoint",
    );
    assert.equal(planning.projection.segments[0].curved, true);
    assert.equal(planning.selection.primaryWaypointIndex, 0);
    const segmentView = new PlanningSegmentsView(planning, field);
    segmentView.drawSelectionHandles([0]);
    assert.equal(
      dots.length,
      1,
      "exactly one lead dot is drawn for the selected segment",
    );
    const handle = dots[0];
    send("pointerdown", handle);
    send("pointermove", { x: handle.x, y: handle.y - 70 });
    near(
      planning.route.waypoints[0].lead,
      0.6,
      "off-axis pointer motion doesn't change lead",
    );
    send("pointermove", { x: handle.x - 40, y: handle.y - 70 });
    send("pointerup", { x: handle.x - 40, y: handle.y - 70 });
    const draggedLead = planning.route.waypoints[0].lead;
    assert.ok(draggedLead > 0.6);
    planning.history.undo();
    near(
      planning.route.waypoints[0].lead,
      0.6,
      "the entire handle drag is one undo step",
    );
    planning.history.redo();
    near(planning.route.waypoints[0].lead, draggedLead);
    dots.length = 0;
    segmentView.drawSelectionHandles([0]);
    send("pointerdown", dots[0]);
    send("pointermove", { x: dots[0].x + 40, y: dots[0].y });
    send("pointercancel", dots[0]);
    near(
      planning.route.waypoints[0].lead,
      draggedLead,
      "pointer cancellation restores the curve",
    );
    let curve = planning.projection.segments[0];
    let midpoint = curve.pointAt(curve.progressAtDistance(curve.length / 2));
    let screenMidpoint = field.worldToScreen(midpoint.x, midpoint.y);
    click(screenMidpoint);
    assert.equal(
      planning.projection.segments[0].curved,
      false,
      "clicking the actual curve switches back to Straight",
    );
    send("pointerdown", field.worldToScreen(15, 15));
    send("pointermove", field.worldToScreen(18, 18));
    send("pointerup", field.worldToScreen(18, 18));
    assert.equal(
      planning.projection.segments[0].curved,
      false,
      "dragging over a segment doesn't toggle it",
    );
    click(
      field.worldToScreen(
        ...Object.values(planning.projection.segments[0].pointAt(0.5)),
      ),
    );
    curve = planning.projection.segments[0];
    midpoint = curve.pointAt(curve.progressAtDistance(curve.length / 2));
    screenMidpoint = field.worldToScreen(midpoint.x, midpoint.y);
    click(screenMidpoint, 2);
    assert.equal(
      planning.route.length,
      3,
      "right-click still inserts a waypoint on a curved segment",
    );
    near(planning.route.waypoints[1].x, midpoint.x);
    near(planning.route.waypoints[1].y, midpoint.y);
    planning.route.replace([
      {
        x: 0,
        y: 0,
        theta: 0,
        lead: 1,
        motions: [{ id: "stalled", type: "boomerang" }],
      },
      { x: 0, y: 30, theta: 0 },
    ]);
    planning.selection.clear();
    assert.equal(planning.projection.segments[0].previewConverged, false);
    click(field.worldToScreen(0, 15));
    assert.equal(
      planning.route.length,
      3,
      "the removed target connector is not a hit-testable driven path",
    );
    labels.length = 0;
    segmentView.drawSelectionLabels([0]);
    const warningColor = labels.find(({ text }) => text.startsWith("Stalled")).color;
    const chainStart = {
      x: 0, y: 0, theta: 0, minSpeed: 1, lead: .6,
      motions: [{ id: "drive", type: "boomerang" }],
    };
    planning.route.replace([chainStart, { x: 0, y: 24, theta: 0 }]);
    labels.length = 0;
    segmentView.drawSelectionLabels([0]);
    assert.match(labels[0].text, /^Minimum speed chaining · .+ from position target$/);
    assert.notEqual(labels[0].color, warningColor);

    planning.setSimulationConfiguration({ angularPID: { kP: 0, kI: 0, kD: 0 } });
    planning.route.replace([
      {
        ...chainStart,
        motions: [...chainStart.motions, { id: "turn", type: "rotate" }],
      },
      { x: 0, y: 24, theta: 2.5 },
    ]);
    labels.length = 0;
    segmentView.drawSelectionLabels([0]);
    assert.deepEqual(labels.slice(0, 2), [
      { text: "Completed with offset · 2.5° from heading target", color: warningColor },
      { text: "Controller met its settling rule", color: warningColor },
    ], "a turn miss takes priority over the preceding chain and uses the stall warning color");

    planning.route.replace([
      { x: 0, y: 0, theta: 0 },
      { x: 0.5, y: 0, theta: 90 },
    ]);
    planning.selection.selectWaypoint(0);
    assert.equal(
      view.hitWaypoint(...Object.values(field.worldToScreen(0.5, 0))),
      0,
      "an overlapping background waypoint cannot take clicks from the selected foreground waypoint",
    );
    planning.selection.setWaypoints([0, 1]);
    assert.equal(
      view.hitWaypoint(...Object.values(field.worldToScreen(0.5, 0))),
      0,
      "the primary selection stays above other selected waypoints",
    );
  } finally {
    setMode("viewing");
    for (const [key, descriptor] of Object.entries(globals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

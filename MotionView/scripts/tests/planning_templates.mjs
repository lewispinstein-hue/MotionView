import assert from "node:assert/strict";
import { createServer } from "vite";

function format(value, decimals = 3) {
  const fixed = Number(value).toFixed(decimals);
  return decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
}

const server = await createServer({
  configFile: "vite.config.js",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});

try {
  const { buildPlanExportCode } = await server.ssrLoadModule("/planning/planningTemplate.ts");
  const { generatePlanningCode } = await server.ssrLoadModule("/planning/planningCode.ts");
  const { roundExportNumber, stringifyExportJson } = await server.ssrLoadModule("/app/export/exportJson.ts");
  const { getWaypointIndicatorTooltip } = await server.ssrLoadModule("/planning/planningIndicators.ts");
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  assert.equal(getWaypointIndicatorTooltip("forward"), "moveToPoint • Linear Motion");
  assert.equal(roundExportNumber(-0.0004), 0);
  const { getPlanMethodTooltipName } = await server.ssrLoadModule("/planning/planningObjects.ts");
  const { constrainTimelineTooltipPosition, latestTimelineNodeAtProgress } = await server.ssrLoadModule("/planning/render/PlanningTimelineView.ts");
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const waypoints = [
    { x: 0, y: 0, theta: 0, speed: 11 },
    { x: 0, y: 5, theta: 270, speed: 22, overrideCode: "segment(${iteration},${x},${y},${theta},${distance},${speed},${forwards});" },
    { x: 5, y: 5, theta: 90, speed: 33 },
  ];
  const objects = [{
    id: "object",
    name: "Object",
    color: "#ffffff",
    latestMethod: "method",
    methods: [{
      id: "method",
      name: "Method",
      code: "node(${iteration},${x},${y},${theta},${distance},${speed},${forwards});",
    }],
  }];
  const nodes = [
    { id: "start", objectId: "object", methodId: "method", beforeWaypoint: 0, index: 0 },
    { id: "middle", objectId: "object", methodId: "method", beforeWaypoint: 1, index: 0 },
    { id: "override", objectId: "object", methodId: "method", beforeWaypoint: 2, index: 0, code: "override(${iteration},${x},${y},${theta},${distance},${speed},${forwards},${unknown});" },
    { id: "end", objectId: "object", methodId: "method", beforeWaypoint: 3, index: 0 },
  ];
  const options = {
    template: "waypoint(${iteration},${x},${y},${theta},${distance},${speed},${forwards});",
    waypoints,
    nodes,
    objects,
    readPlanSpeed: (value, fallback = 127) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    formatTemplateNumber: format,
    planThetaDegAt: (index) => Number(waypoints[index]?.theta) || 0,
    getSortedPlanNodes: () => [...nodes].sort((left, right) => left.beforeWaypoint - right.beforeWaypoint || left.index - right.index),
  };

  assert.equal(buildPlanExportCode(options), [
    "node(0,0,0,0,0,11,true);",
    "waypoint(0,0,5,270,5,11,true);",
    "node(0,0,0,0,0,11,true);",
    "segment(1,5,5,90,5,22,false);",
    "override(1,0,5,270,5,22,false,${unknown});",
  ].join("\n"));

  const shorthandOptions = {
    ...options,
    template: "short(@x,@y,@dist,@spd,@th,@iter,@fwd,${x},${y},${distance},${speed},${theta},${iteration},${forwards});",
    waypoints: waypoints.map(({ overrideCode: _overrideCode, ...waypoint }) => waypoint),
    nodes: [],
    getSortedPlanNodes: () => [],
  };
  assert.equal(buildPlanExportCode(shorthandOptions), [
    "short(0,5,5,11,270,0,true,0,5,5,11,270,0,true);",
    "short(5,5,5,22,90,1,false,5,5,5,22,90,1,false);",
  ].join("\n"));

  const legacyOptions = {
    ...options,
    template: "move();",
    waypoints: waypoints.map(({ overrideCode: _overrideCode, ...waypoint }) => waypoint),
    getSortedPlanNodes: () => [{ id: "legacy", objectId: "object", methodId: "method", beforeWaypoint: 0, index: 0, code: "act();" }],
  };
  assert.equal(buildPlanExportCode(legacyOptions), "act();\nmove();\nmove();");

  const routeStartNodeOptions = {
    ...options,
    template: "move();",
    waypoints: [
      { x: 12.5, y: -4.25, theta: 90, speed: 84 },
      { x: 17.5, y: -4.25, theta: 90, speed: 84 },
    ],
    nodes: [{ id: "route-start", objectId: "object", methodId: "method", beforeWaypoint: 0, index: 0 }],
    getSortedPlanNodes: () => [{ id: "route-start", objectId: "object", methodId: "method", beforeWaypoint: 0, index: 0 }],
    planThetaDegAt: (index) => [90, 90][index] ?? 0,
  };
  assert.equal(buildPlanExportCode(routeStartNodeOptions), [
    "node(0,12.5,-4.25,90,0,84,true);",
    "move();",
  ].join("\n"));

  const wholeNumberSpeedPlanning = new PlanningFeature("move(${speed});");
  wholeNumberSpeedPlanning.load({
    "planned-segment-export": true,
    "planned-path": [
      { x: 0, y: 0, theta: 0, speed: 50 },
      { x: 0, y: 5, theta: 0, speed: 127 },
    ],
  });
  assert.equal(generatePlanningCode(wholeNumberSpeedPlanning), "move(50);");

  const namedLegacyPathPlanning = new PlanningFeature();
  namedLegacyPathPlanning.load({
    meta: { SchemaVersion: 4, PathName: "Qualifying Route" },
    "planned-segment-export": true,
    "planned-path": [
      { x: 0, y: 0, theta: 0, speed: 127 },
      { x: 12, y: 0, theta: 0, speed: 127 },
    ],
  });
  assert.equal(namedLegacyPathPlanning.paths.active.name, "Qualifying Route");

  const multiPathPlanning = new PlanningFeature();
  multiPathPlanning.load({
    "planned-segment-export": true,
    "planned-objects": objects,
    "planned-paths": [
      {
        id: "path-a",
        name: "Match Route",
        "planned-path": [
          { x: 10, y: 20, theta: 30, speed: 127 },
          { x: 30, y: 20, theta: 30, speed: 127 },
        ],
        "planned-nodes": [{ id: "path-a-node", objectId: "object", methodId: "method", beforeWaypoint: 1, index: 0 }],
        "planned-code-export": { header: "// A", footer: "// end A", target: "custom", path: "/tmp/a.cpp" },
      },
      {
        id: "path-b",
        name: "Skills Route",
        "planned-path": [
          { x: -12, y: 6, theta: 270, speed: 100 },
          { x: -12, y: 30, theta: 270, speed: 100 },
        ],
        "planned-code-export": { header: "// B", footer: "// end B", target: "downloads", path: "" },
      },
    ],
    "planned-active-path-id": "path-a",
  });
  assert.equal(multiPathPlanning.paths.items.length, 2);
  assert.equal(multiPathPlanning.paths.active.name, "Match Route");
  assert.equal(multiPathPlanning.paths.codeExportSettings.header, "// A");
  const routeSerializer = new MotionViewDocumentSerializer({
    planning: multiPathPlanning,
    viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } },
    version: "test",
  });
  const exportedMultiPathRoute = routeSerializer.exportPayload(
    "planning",
    "Exported Route",
    {},
  );
  assert.equal(exportedMultiPathRoute["planned-paths"]?.length, 2);
  assert.equal(exportedMultiPathRoute["planned-active-path-id"], "path-a");
  const reimportedMultiPathPlanning = new PlanningFeature();
  reimportedMultiPathPlanning.load(exportedMultiPathRoute);
  assert.deepEqual(
    reimportedMultiPathPlanning.paths.items.map((path) => path.name),
    ["Match Route", "Skills Route"],
  );
  multiPathPlanning.route.updateField(0, "x", 11);
  multiPathPlanning.paths.select("path-b");
  assert.equal(multiPathPlanning.paths.active.name, "Skills Route");
  assert.equal(multiPathPlanning.paths.codeExportSettings.header, "// B");
  assert.equal(multiPathPlanning.history.undo(), true);
  assert.equal(multiPathPlanning.paths.activeId, "path-a");
  assert.equal(multiPathPlanning.route.waypoints[0]?.x, 10);
  assert.equal(multiPathPlanning.history.redo(), true);
  assert.equal(multiPathPlanning.paths.activeId, "path-a");
  assert.equal(multiPathPlanning.route.waypoints[0]?.x, 11);
  assert.equal(multiPathPlanning.paths.mirror("left-right"), true);
  assert.deepEqual(
    multiPathPlanning.route.waypoints.map((point) => [point.x, point.y, point.theta]),
    [[-11, 20, 330], [-30, 20, 330]],
  );
  assert.equal(multiPathPlanning.paths.mirror("left-right"), true);
  assert.equal(multiPathPlanning.paths.mirror("top-bottom"), true);
  assert.deepEqual(
    multiPathPlanning.route.waypoints.map((point) => [point.x, point.y, point.theta]),
    [[11, -20, 150], [30, -20, 150]],
  );
  multiPathPlanning.paths.select("path-b");
  assert.equal(multiPathPlanning.timeline.nodes.length, 0);
  const newPathId = multiPathPlanning.paths.add();
  assert.equal(newPathId.startsWith("plan-path-"), true);
  assert.equal(multiPathPlanning.paths.active.name, "Path 1");
  assert.equal(multiPathPlanning.history.undo(), true);
  assert.equal(multiPathPlanning.paths.activeId, "path-b");
  assert.equal(multiPathPlanning.paths.items.length, 2);
  assert.equal(multiPathPlanning.history.redo(), true);
  assert.equal(multiPathPlanning.paths.activeId, newPathId);
  assert.equal(multiPathPlanning.paths.items.length, 3);

  const derivedPathPlanning = new PlanningFeature();
  derivedPathPlanning.load(exportedMultiPathRoute);
  derivedPathPlanning.route.updateContent(0, "", ["rotate", "forward"]);
  derivedPathPlanning.timeline.setCodeOverride("path-a-node", "copied(@x);");
  const sourcePath = structuredClone(derivedPathPlanning.paths.active);
  const sourceCode = generatePlanningCode(derivedPathPlanning);
  derivedPathPlanning.paths.select("path-b");
  const derivedId = derivedPathPlanning.paths.derive("path-a");
  assert.ok(derivedId);
  assert.notEqual(derivedId, "path-a");
  assert.equal(derivedPathPlanning.paths.activeId, derivedId);
  assert.equal(derivedPathPlanning.paths.active.name, "Match Route (Copy)");
  assert.deepEqual(derivedPathPlanning.route.waypoints, sourcePath.waypoints);
  assert.deepEqual(derivedPathPlanning.paths.codeExportSettings, sourcePath.codeExport);
  assert.equal(generatePlanningCode(derivedPathPlanning), sourceCode);
  assert.notEqual(derivedPathPlanning.timeline.nodes[0]?.id, sourcePath.nodes[0].id);
  assert.deepEqual(
    derivedPathPlanning.timeline.nodes.map(({ id: _id, ...node }) => node),
    sourcePath.nodes.map(({ id: _id, ...node }) => node),
  );
  assert.deepEqual(derivedPathPlanning.objects.items, objects);
  assert.equal(derivedPathPlanning.history.undo(), true);
  assert.equal(derivedPathPlanning.paths.activeId, "path-b");
  assert.equal(derivedPathPlanning.paths.items.length, 2);
  assert.equal(derivedPathPlanning.history.redo(), true);
  assert.equal(derivedPathPlanning.paths.activeId, derivedId);

  derivedPathPlanning.route.updateContent(0, "derived();", ["forward"]);
  derivedPathPlanning.route.updateField(0, "x", 42);
  derivedPathPlanning.timeline.setCodeOverride(derivedPathPlanning.timeline.nodes[0].id, "derivedNode();");
  derivedPathPlanning.paths.updateCodeExportSettings({ header: "// copy" });
  assert.deepEqual(
    derivedPathPlanning.paths.items.find((path) => path.id === "path-a"),
    sourcePath,
  );
  const secondDerivedId = derivedPathPlanning.paths.derive("path-a");
  assert.ok(secondDerivedId);
  assert.equal(derivedPathPlanning.paths.active.name, "Match Route (Copy 2)");
  assert.equal(derivedPathPlanning.paths.derive("missing-path"), null);
  assert.equal(derivedPathPlanning.paths.activeId, secondDerivedId);
  assert.equal(derivedPathPlanning.paths.items.length, 4);

  const derivedPathSerializer = new MotionViewDocumentSerializer({
    planning: derivedPathPlanning,
    viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } },
    version: "test",
  });
  const reimportedDerivedPaths = new PlanningFeature();
  reimportedDerivedPaths.load(derivedPathSerializer.exportPayload("planning", "Derived Routes", {}));
  assert.deepEqual(reimportedDerivedPaths.paths.items, derivedPathPlanning.paths.items);
  assert.equal(reimportedDerivedPaths.paths.activeId, secondDerivedId);

  const methodOrderPlanning = new PlanningFeature();
  methodOrderPlanning.load({
    "planned-objects": [{
      id: "order-object",
      name: "Order Object",
      color: "#ffffff",
      latestMethod: "",
      methods: [
        { id: "first", name: "First", code: "first();" },
        { id: "second", name: "Second", code: "second();" },
        { id: "third", name: "Third", code: "third();" },
      ],
    }],
  });
  assert.equal(
    methodOrderPlanning.objects.moveMethod("order-object", "third", 0),
    true,
  );
  assert.deepEqual(
    methodOrderPlanning.objects.get("order-object")?.methods.map(
      (method) => method.id,
    ),
    ["third", "first", "second"],
  );
  assert.equal(
    methodOrderPlanning.objects.moveMethod("order-object", "third", 0),
    false,
  );

  const backwardsSegmentOptions = {
    ...options,
    template: "move(${x}, ${forwards});",
    waypoints: [
      { x: 62, y: -0.5, theta: 270, speed: 127 },
      { x: 23, y: 0, theta: 20, speed: 127 },
      { x: 58.5, y: 25.5, theta: 180, speed: 127 },
      { x: 58.5, y: 55, theta: 180, speed: 127 },
    ],
    nodes: [],
    getSortedPlanNodes: () => [],
    planThetaDegAt: (index) => [270, 20, 180, 180][index] ?? 0,
  };
  assert.equal(buildPlanExportCode(backwardsSegmentOptions), [
    "move(23, true);",
    "move(58.5, true);",
    "move(58.5, false);",
  ].join("\n"));

  const terminalNodePlanning = new PlanningFeature();
  terminalNodePlanning.load({
    "planned-segment-export": true,
    "planned-path": waypoints,
    "planned-objects": objects,
    "planned-nodes": [{ id: "terminal", objectId: "object", methodId: "method", beforeWaypoint: 3, index: 0 }],
  });
  assert.equal(terminalNodePlanning.timeline.nodes[0]?.beforeWaypoint, 2);
  assert.equal(terminalNodePlanning.timeline.insert("object", "method", 3, 0)?.beforeWaypoint, 2);

  const latestNodePlanning = new PlanningFeature();
  latestNodePlanning.load({
    "planned-segment-export": true,
    "planned-path": [
      { x: 0, y: 0, theta: 0, speed: 127 },
      { x: 12, y: 0, theta: 0, speed: 127 },
      { x: 24, y: 0, theta: 0, speed: 127 },
    ],
    "planned-objects": objects,
    "planned-nodes": [
      { id: "start-first", objectId: "object", methodId: "method", beforeWaypoint: 0, index: 0 },
      { id: "start-last", objectId: "object", methodId: "method", beforeWaypoint: 0, index: 1 },
      { id: "later", objectId: "object", methodId: "method", beforeWaypoint: 1, index: 0 },
    ],
  });
  assert.equal(latestNodePlanning.latestExecutedNode()?.id, "start-last");
  assert.equal(latestNodePlanning.latestExecutedNode("object")?.id, "start-last");
  latestNodePlanning.playback.setDistance(6);
  assert.equal(latestNodePlanning.latestExecutedNode()?.id, "later");

  const insertionPlanning = new PlanningFeature();
  insertionPlanning.load({
    "planned-segment-export": true,
    "planned-path": [
      { x: 0, y: 0, theta: 0, speed: 50, indicatorIcons: ["forward"], overrideCode: "move(${x});" },
      { x: 10, y: 0, theta: 0, speed: 60 },
      { x: 20, y: 0, theta: 0, speed: 70 },
    ],
    "planned-objects": objects,
    "planned-nodes": [
      { id: "first-bucket", objectId: "object", methodId: "method", beforeWaypoint: 1, index: 0 },
      { id: "second-bucket", objectId: "object", methodId: "method", beforeWaypoint: 2, index: 0 },
    ],
  });
  const sourceWaypoint = insertionPlanning.route.waypoints[0];
  insertionPlanning.route.add({ ...sourceWaypoint, x: 5, y: 0 }, 1);
  assert.deepEqual(insertionPlanning.timeline.nodes.map((node) => node.beforeWaypoint), [1, 3]);
  assert.deepEqual(insertionPlanning.route.waypoints[1]?.indicatorIcons, ["forward"]);
  assert.equal(insertionPlanning.route.waypoints[1]?.overrideCode, "move(${x});");

  assert.equal(getPlanMethodTooltipName("123456789012345678901234"), "123456789012345678901234");
  assert.equal(getPlanMethodTooltipName("1234567890123456789012345"), "123456789012345678901234…");
  assert.deepEqual(
    constrainTimelineTooltipPosition(4, 4, 180, 40, 300, 200),
    { left: 16, top: 16 },
  );
  assert.deepEqual(
    constrainTimelineTooltipPosition(295, 195, 180, 40, 300, 200),
    { left: 112, top: 152 },
  );
  const timelineProgressNodes = [
    { node: { id: "early", objectId: "object", methodId: "method", beforeWaypoint: 1, index: 0 }, x: 40 },
    { node: { id: "middle", objectId: "object", methodId: "method", beforeWaypoint: 1, index: 1 }, x: 80 },
    { node: { id: "late", objectId: "object", methodId: "method", beforeWaypoint: 2, index: 0 }, x: 120 },
  ];
  assert.equal(latestTimelineNodeAtProgress(timelineProgressNodes, 39), null);
  assert.equal(latestTimelineNodeAtProgress(timelineProgressNodes, 95)?.id, "middle");
  assert.equal(latestTimelineNodeAtProgress(timelineProgressNodes, 120)?.id, "late");

  const legacyPlanning = new PlanningFeature();
  legacyPlanning.load({
    meta: { SchemaVersion: 3 },
    "planned-path": [
      { x: 0, y: 0, theta: 0, speed: 11, indicatorIcons: ["forward"], overrideCode: "" },
      { x: 0, y: 5, theta: 270, speed: 22, indicatorIcons: ["rotate"], overrideCode: "move(${x});" },
    ],
  });
  const migratedWaypoints = legacyPlanning.exportData().waypoints;
  assert.equal(migratedWaypoints[0]?.speed, 22);
  assert.equal(migratedWaypoints[0]?.overrideCode, "move(${x});");
  assert.deepEqual(migratedWaypoints[0]?.indicatorIcons, ["rotate"]);
  assert.equal(Object.hasOwn(migratedWaypoints[1] ?? {}, "overrideCode"), false);
  assert.equal(Object.hasOwn(migratedWaypoints[1] ?? {}, "indicatorIcons"), false);

  console.log("Planning template regression tests passed.");
} finally {
  await server.close();
}

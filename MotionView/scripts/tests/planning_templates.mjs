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
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
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

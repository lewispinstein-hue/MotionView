import assert from "node:assert/strict";
import { createServer } from "vite";

function format(value, decimals = 3) {
  return Number(value).toFixed(decimals).replace(/\.?0+$/, "");
}

const server = await createServer({
  configFile: "vite.config.js",
  logLevel: "error",
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});

try {
  const { buildPlanExportCode } = await server.ssrLoadModule("/planning/planningTemplate.ts");
  const waypoints = [
    { x: 0, y: 0, theta: 0, speed: 11 },
    { x: 0, y: 5, theta: 270, speed: 22 },
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
    "node(0,0,0,0,0,0,true);",
    "waypoint(0,0,0,0,0,11,true);",
    "node(0,0,0,0,0,11,true);",
    "waypoint(1,0,5,270,5,22,false);",
    "override(1,0,5,270,5,22,false,${unknown});",
    "waypoint(2,5,5,90,5,33,true);",
    "node(2,5,5,90,5,33,true);",
  ].join("\n"));

  const legacyOptions = {
    ...options,
    template: "move();",
    getSortedPlanNodes: () => [{ id: "legacy", objectId: "object", methodId: "method", beforeWaypoint: 0, index: 0, code: "act();" }],
  };
  assert.equal(buildPlanExportCode(legacyOptions), "act();\nmove();\nmove();\nmove();");

  console.log("Planning template regression tests passed.");
} finally {
  await server.close();
}

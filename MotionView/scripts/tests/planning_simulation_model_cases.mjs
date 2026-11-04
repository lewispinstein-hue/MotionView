import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function runPlanningSimulationModelTests(server) {
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { PlanningMotionController } = await server.ssrLoadModule("/planning/planningSimulationControllers.ts");
  const { PlanningLemLibSettling } = await server.ssrLoadModule("/planning/planningLemLibSettling.ts");
  const { PlanningPreviewDrivetrain } = await server.ssrLoadModule("/planning/planningPreviewDrivetrain.ts");
  const { normalizePlanningSimulationConfiguration: normalize, applyPlanningLibraryPreset: preset } = await server.ssrLoadModule("/planning/planningSimulationConfiguration.ts");
  const { simulatePlanningRoute: simulate } = await server.ssrLoadModule("/planning/planningSimulation.ts");
  const defaults = normalize();

  // Enter close range with a nonzero angular error history and nonzero kD.
  // The robot can coast while settling; the controller must issue no turn.
  for (const library of ["lemlib", "custom"]) {
    const config = normalize({ library, previewModel: "lemlib" });
    const drive = new PlanningPreviewDrivetrain(config);
    const controller = new PlanningMotionController(
      { id: "point", type: "forward" }, { x: 10, y: 10, theta: 0 }, 0, true, 127,
      config, { x: 0, y: 0, theta: 0 }, drive,
    );
    const before = controller.update({ x: 0, y: 0, theta: 0 }, drive);
    assert.notEqual(before.left, before.right);
    const close = controller.update({ x: 6, y: 6, theta: .4 }, drive);
    assert.equal(close.left, close.right, "settling gates angular output rather than resetting PID error");
    const stillClose = controller.update({ x: 6.5, y: 6.5, theta: .45 }, drive);
    assert.equal(stillClose.left, stillClose.right);
  }

  // The exit windows require time, reset while outside their range, and latch.
  const settling = new PlanningLemLibSettling();
  for (let tick = 0; tick < 10; tick++) assert.equal(settling.update("forward", .5, 0, true), false);
  assert.equal(settling.update("forward", .5, 0, true), true);
  assert.equal(settling.update("forward", 4, 0, true), true);
  const outside = new PlanningLemLibSettling();
  for (let tick = 0; tick < 9; tick++) outside.update("forward", .5, 0, true);
  outside.update("forward", 4, 0, true);
  for (let tick = 0; tick < 10; tick++) assert.equal(outside.update("forward", .5, 0, true), false);
  assert.equal(outside.update("forward", .5, 0, true), true);
  const large = new PlanningLemLibSettling();
  for (let tick = 0; tick < 50; tick++) assert.equal(large.update("forward", 2, 0, true), false);
  assert.equal(large.update("forward", 2, 0, true), true);
  const distant = new PlanningLemLibSettling();
  for (let tick = 0; tick < 200; tick++) assert.equal(distant.update("forward", 0, 0, false), false,
    "a perpendicular projected error cannot finish a distant approach before close range");
  const poseSettling = new PlanningLemLibSettling();
  for (let tick = 0; tick < 50; tick++) assert.equal(poseSettling.update("boomerang", .5, .5, true), false,
    "Boomerang waits for both lateral windows, even when its heading is settled");
  assert.equal(poseSettling.update("boomerang", .5, .5, true), true);

  const fixture = JSON.parse(await readFile(new URL("./fixtures/planning_legacy_auton_comp_right.json", import.meta.url)));
  const planning = new PlanningFeature(); planning.load(fixture);
  const points = planning.route.waypoints;
  assert.equal(points.length, 19);
  const routes = {
    supplied: points,
    ordered: points.map((point, index) => ({ ...point, motions: [
      { id: `straight-${index}`, type: "forward" }, { id: `turn-${index}`, type: "rotate" },
    ] })),
  };
  // Captured before this change. Covers all samples, velocities, controller
  // boundaries, outcomes and drivetrain state; excludes only configuration keys.
  const ezBefore = {
    supplied: "511bcfaf99ab18894e74858cfde91195114a921800b29f9f8d28e506b0876f01",
    ordered: "faf9848e847a05a14845a138cd2b9c9c3ec3ce808359b956d9ad37c696ac248e",
  };
  for (const [name, waypoints] of Object.entries(routes)) {
    const result = simulate({ waypoints, configuration: defaults });
    assert.equal(result.complete, true);
    assert.equal(result.sections.length, 18);
    assert.ok(result.sections.every(section => ["reached", "completed"].includes(section.outcome)));
    assert.ok(result.sections.some(section => section.outcome === "completed" && section.motions.some(m => m.targetError > 1)),
      "a controller can complete while preserving a real target offset");
    for (let index = 1; index < result.sections.length; index++)
      assert.deepEqual(result.sections[index].samples[0], result.sections[index - 1].samples.at(-1),
        "completed motions hand their actual pose and velocity to the next motion");
    for (const library of ["ez-template", "custom"]) {
      const configuration = normalize({ ...preset("ez-template", defaults), library, previewModel: "ez-template" });
      const ez = simulate({ waypoints, configuration });
      const stable = { ...ez, sections: ez.sections.map(({ key, ...section }) => section) };
      const hash = createHash("sha256").update(JSON.stringify(stable)).digest("hex");
      assert.equal(hash, ezBefore[name], `${library}/EZ remains identical to its pre-fix simulation`);
    }
  }

  const custom = normalize({ library: "custom", previewModel: "custom" });
  const route = type => [
    { x: 0, y: 0, theta: 0, forwards: true, lead: .6, motions: [{ id: type, type }] },
    { x: 60, y: 60, theta: 90 },
  ];
  const run = (type, changes = {}) => simulate({ waypoints: route(type), configuration: normalize(changes, custom) });
  for (const type of ["forward", "rotate", "swing", "boomerang"]) {
    const result = run(type);
    assert.equal(result.complete, true);
    assert.equal(result.sections[0].outcome, "reached", `Custom ${type} completes an ordinary approach`);
    assert.ok(result.sections[0].samples.every(sample => Object.values(sample).every(Number.isFinite)));
  }
  for (const forwards of [true, false]) {
    const result = simulate({ configuration: custom, waypoints: [
      { ...route("boomerang")[0], theta: forwards ? 0 : 180, forwards },
      { x: 30, y: 30, theta: forwards ? 90 : 270 },
    ] });
    const last = result.sections[0].samples.at(-1);
    const targetTheta = (forwards ? 90 : 270) * Math.PI / 180;
    assert.equal(result.sections[0].outcome, "reached");
    assert.ok(Math.abs(Math.atan2(Math.sin(last.theta - targetTheta), Math.cos(last.theta - targetTheta))) < Math.PI / 90,
      "Custom Boomerang settles toward the requested robot heading in either travel direction");
    assert.ok(Math.hypot(last.x - 30, last.y - 30) < 1);
  }
  for (const [key, value, type] of [
    ["horizontalDrift", 2, "boomerang"], ["lateralSlew", 2, "forward"],
    ["ezSlewDistance", 12, "forward"], ["maxCarrotDistance", 4, "boomerang"],
    ["lookAheadDistance", 14, "boomerang"], ["turnBias", 1.5, "forward"],
  ]) assert.notDeepEqual(run(type, { [key]: value }).sections[0].samples, run(type).sections[0].samples,
    `${key} affects Custom trajectories rather than just enabling a field`);
  for (const [role, type] of [
    ["lateralPID", "forward"], ["angularPID", "forward"], ["pointSteeringPID", "forward"],
    ["boomerangSteeringPID", "boomerang"], ["turnPID", "rotate"], ["swingPID", "swing"],
  ]) for (const [gain, value] of [["kP", custom[role].kP + 1], ["kI", .1], ["kD", custom[role].kD + 2]])
    assert.notDeepEqual(run(type, { [role]: { [gain]: value } }).sections[0].samples, run(type).sections[0].samples,
      `Custom uses ${role}.${gain}`);
}

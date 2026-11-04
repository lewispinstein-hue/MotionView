import assert from "node:assert/strict";

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

export async function runBoomerangPreviewTests(server) {
  const { boomerangGuidance, previewBoomerangMotion } =
    await server.ssrLoadModule("/planning/planningBoomerangPreview.ts");
  const {
    DEFAULT_PLANNING_SIMULATION_CONFIGURATION: defaults,
    normalizePlanningSimulationConfiguration,
  } = await server.ssrLoadModule(
    "/planning/planningSimulationConfiguration.ts",
  );
  const { PlanningPreviewPID } = await server.ssrLoadModule(
    "/planning/planningPreviewPID.ts",
  );
  const { PlanningSegment } = await server.ssrLoadModule(
    "/planning/planningSegments.ts",
  );
  const { PlanningFeature } = await server.ssrLoadModule(
    "/planning/PlanningFeature.ts",
  );
  const { generatePlanningCode } = await server.ssrLoadModule(
    "/planning/planningCode.ts",
  );
  const { createDefaultMotionTemplates, normalizeMotionTemplates } =
    await server.ssrLoadModule("/planning/planningMotions.ts");
  const start = { x: 0, y: 0, theta: 0 };
  const target = { x: 30, y: 30, theta: Math.PI / 2 };

  // Direct checks against LemLib stable's moving-carrot equations. This is
  // independent of the nominal drive/PID model used to draw a trajectory.
  const initial = boomerangGuidance(start, target, 0.6, true);
  near(initial.carrot.x, 30 - Math.hypot(30, 30) * 0.6);
  near(initial.carrot.y, 30);
  const later = boomerangGuidance(
    { x: 10, y: 15, theta: 0 },
    target,
    0.6,
    true,
  );
  near(later.carrot.x, 15);
  near(later.carrot.y, 30);
  assert.notEqual(
    initial.carrot.x,
    later.carrot.x,
    "carrot offset shrinks with CURRENT distance",
  );
  const reverse = boomerangGuidance(start, target, 0.6, false);
  near(reverse.carrot.x, 30 + Math.hypot(30, 30) * 0.6);
  const atBoundary = boomerangGuidance(
    { x: 22.5, y: 30, theta: 0 },
    target,
    0.6,
    true,
  );
  assert.equal(
    atBoundary.settling,
    false,
    "LemLib uses strictly less than the settling distance",
  );
  const close = boomerangGuidance(
    { x: 30, y: 23, theta: 0 },
    target,
    0.6,
    true,
  );
  assert.equal(close.settling, true);
  assert.deepEqual(close.carrot, { x: 30, y: 30 });
  near(
    close.angularError,
    Math.PI / 2,
    "settling targets final heading instead of carrot bearing",
  );
  assert.deepEqual(
    boomerangGuidance(start, target, 0.6, true, true).carrot,
    { x: 30, y: 30 },
    "settling stays latched",
  );
  assert.deepEqual(boomerangGuidance(start, target, 0, true).carrot, {
    x: 30,
    y: 30,
  });
  assert.equal(
    boomerangGuidance({ x: 23, y: 30, theta: 0 }, target, 0.6, true, false, 5)
      .settling,
    false,
    "settling threshold is configurable",
  );

  const pid = new PlanningPreviewPID({
    kP: 10,
    kI: 0.5,
    kD: 3,
    windupRange: 0,
    signFlipReset: false,
  });
  near(pid.update(2), 27);
  near(pid.update(1), 8.5);
  const windup = new PlanningPreviewPID({
    kP: 0,
    kI: 1,
    kD: 0,
    windupRange: 1,
    signFlipReset: false,
  });
  near(windup.update(0.5), 0.5);
  near(windup.update(2), 0);
  const reset = new PlanningPreviewPID({
    kP: 0,
    kI: 1,
    kD: 0,
    windupRange: 0,
    signFlipReset: true,
  });
  near(reset.update(1), 0);
  near(reset.update(1), 1);
  near(reset.update(-1), 0);
  const sanitized = normalizePlanningSimulationConfiguration({
    trackWidth: 0,
    timeStepSeconds: NaN,
    maxDurationSeconds: Infinity,
    lateralPID: { kP: 12 },
  });
  assert.ok(sanitized.trackWidth > 0);
  assert.equal(sanitized.lateralPID.kP, 12);
  assert.equal(sanitized.lateralPID.kD, defaults.lateralPID.kD);

  const stalled = previewBoomerangMotion(
    start,
    { x: 0, y: 30, theta: 0 },
    1,
    true,
    90,
  );
  assert.equal(
    stalled.converged,
    false,
    "lead=1 can stall the carrot on the current pose",
  );
  assert.deepEqual(
    stalled.poses.at(-1),
    start,
    "a failed preview must not invent a connection to the target",
  );
  assert.ok(stalled.poses.length < 40, "idle requests terminate promptly");
  const previousDefault =
    "moveToPose(${x}, ${y}, ${theta}, 4000, {.lead = ${lead}});";
  const fixedDefault = createDefaultMotionTemplates("").boomerang;
  assert.ok(fixedDefault.includes(".forwards = ${forwards}"));
  assert.ok(fixedDefault.includes(".maxSpeed = ${speed}"));
  assert.equal(
    normalizeMotionTemplates(
      { boomerang: previousDefault },
      createDefaultMotionTemplates(""),
      true,
    ).boomerang,
    fixedDefault,
  );
  assert.equal(
    normalizeMotionTemplates(
      { boomerang: previousDefault },
      createDefaultMotionTemplates(""),
    ).boomerang,
    previousDefault,
    "explicit editor input is not silently rewritten",
  );
  const customTemplate = "myPose(@x,@y,@ld);";
  assert.equal(
    normalizeMotionTemplates(
      { boomerang: customTemplate },
      createDefaultMotionTemplates(""),
    ).boomerang,
    customTemplate,
  );
  const planning = new PlanningFeature();
  planning.load({
    "planned-segment-export": true,
    "planned-motion-templates": { boomerang: previousDefault },
    "planned-path": [
      {
        x: 0,
        y: 0,
        theta: 180,
        speed: 90,
        lead: 0.6,
        motions: [{ id: "boom", type: "boomerang" }],
      },
      { x: 30, y: 30, theta: 270 },
    ],
  });
  assert.equal(
    generatePlanningCode(planning),
    "moveToPose(30, 30, 270, 4000, {.forwards = false, .lead = 0.6, .maxSpeed = 90});",
  );
  const codeBeforeTuning = generatePlanningCode(planning);
  const segmentBeforeTuning = planning.projection.segments[0];
  planning.projection.configureSimulation({
    angularPID: { kP: 1.2, kD: 0.5 },
    trackWidth: 14,
  });
  const segmentAfterTuning = planning.projection.segments[0];
  assert.notEqual(
    segmentBeforeTuning,
    segmentAfterTuning,
    "changing model settings invalidates cached geometry",
  );
  assert.notEqual(
    segmentBeforeTuning.length,
    segmentAfterTuning.length,
    "PID/drive settings affect the preview",
  );
  assert.equal(planning.projection.configuration.simulation.angularPID.kP, 1.2);
  assert.equal(planning.projection.configuration.simulation.angularPID.kD, 0.5);
  assert.equal(
    planning.projection.configuration.simulation.lateralPID.kP,
    defaults.lateralPID.kP,
  );
  assert.equal(
    generatePlanningCode(planning),
    codeBeforeTuning,
    "preview-only tuning does not rewrite generated code",
  );
  planning.route.add({ x: 60, y: 60, theta: 90, speed: 90 });
  const unaffected = planning.projection.segments[1];
  planning.route.updateLead(0, 0.7);
  assert.notEqual(
    planning.projection.segments[1],
    unaffected,
    "a changed preceding motion invalidates downstream state",
  );

  // These bounded, deterministic nominal models should settle over ordinary
  // heading combinations, but their final XY may differ from the target.
  for (const theta of [0, 90, 180, 270])
    for (const endTheta of [0, 90, 180, 270]) {
      const segment = new PlanningSegment(
        { x: 0, y: 0, theta, lead: 0.6, speed: 90 },
        { x: 30, y: 30, theta: endTheta },
      );
      assert.ok(
        ["reached", "completed", "missed", "stalled", "incomplete"].includes(
          segment.outcome,
        ),
      );
      assert.ok(Number.isFinite(segment.length));
      assert.ok(
        segment.samples.every(
          (sample) => Number.isFinite(sample.x) && Number.isFinite(sample.y),
        ),
      );
    }
}

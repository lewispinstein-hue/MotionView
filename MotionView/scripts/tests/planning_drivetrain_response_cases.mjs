import assert from "node:assert/strict";

export async function runPlanningDrivetrainResponseTests(server) {
  const { normalizePlanningSimulationConfiguration: normalize } =
    await server.ssrLoadModule("/planning/planningSimulationConfiguration.ts");
  const { PlanningPreviewDrivetrain } =
    await server.ssrLoadModule("/planning/planningPreviewDrivetrain.ts");
  const { simulatePlanningRoute: simulate } =
    await server.ssrLoadModule("/planning/planningSimulation.ts");

  const measuredRobot = normalize({
    library: "lemlib", motorWatts: 55, robotWeightPounds: 10,
    maxSpeedInchesPerSecond: 57.7, trackWidth: 10.75, horizontalDrift: 2,
    lateralPID: { kP: 11.75, kD: 8 }, angularPID: { kP: 3.5, kD: 20 },
  });
  assert.deepEqual(normalize({ ...measuredRobot, drivetrainProfile: "calibrated-omni" }), measuredRobot,
    "documents with the retired profile use the standard drivetrain and retain robot tuning");

  const slowRoute = [
    { x: 0, y: 0, theta: 0, speed: 35, motions: [{ id: "drive", type: "forward" }] },
    { x: 0, y: 120, theta: 0 },
  ];
  const request = { configuration: measuredRobot, templateLibrary: "lemlib", waypoints: slowRoute };
  const timed = simulate(request);
  assert.equal(timed.sections[0].motions[0].outcome, "missed");
  assert.ok(Math.abs(timed.sections[0].motions[0].endTime - 4) < 1e-8);
  const edited = structuredClone(slowRoute);
  edited[0].motions[0].overrideCode = "driveToPoint(120);";
  assert.ok(simulate({ ...request, waypoints: edited }, timed).sections[0].motions[0].endTime > 4,
    "editing the motion invalidates the cached preset timeout");

  const motions = (...types) => types.map(type => ({ id: type, type }));
  const oscillatingRoute = [
    { x: 0, y: 0, theta: 0, lead: .638, forwards: true, motions: motions("boomerang", "rotate") },
    { x: 37, y: 40.5, theta: 110, lead: .465, forwards: false, minSpeed: 20, motions: motions("boomerang") },
    { x: 11.5, y: 34, theta: 35, lead: .519, forwards: false, minSpeed: 20, motions: motions("boomerang", "rotate") },
    { x: 9.5, y: 5, theta: 330, lead: 1, forwards: false, minSpeed: 20, motions: motions("boomerang", "rotate") },
    { x: 23, y: -1, theta: 50, lead: .147, forwards: false, minSpeed: 100, motions: motions("boomerang", "rotate") },
    { x: 0, y: 0, theta: 5 },
  ];
  // Use the same LemLib controller with a custom template, so a timeout
  // cannot hide an oscillating approach in this regression.
  const preview = simulate({ ...request, templateLibrary: "custom", waypoints: oscillatingRoute });
  assert.equal(preview.complete, true);
  assert.equal(preview.sections.length, oscillatingRoute.length - 1);
  const boomerang = preview.sections[3].motions[0];
  assert.equal(boomerang.outcome, "completed");
  assert.ok(boomerang.targetError < 7.5, "the boomerang enters LemLib's settling range");
  const nearTarget = preview.sections[3].samples.filter(sample =>
    sample.time >= boomerang.startTime + 1.2 && sample.time <= boomerang.endTime);
  assert.ok(nearTarget.length > 0);
  assert.ok(!(nearTarget.some(sample => sample.angularVelocity > Math.PI) &&
    nearTarget.some(sample => sample.angularVelocity < -Math.PI)),
    "the chassis does not reverse into a second high-speed turn near the target");
  const before = preview.sections[3].samples.at(-1);
  const after = preview.sections[4].samples[0];
  assert.deepEqual(after, before, "the next section continues from the simulated pose and velocity");

  const specifications = { maxSpeedInchesPerSecond: 57.7, robotWeightPounds: 15 };
  const response = (changes) => {
    const configuration = normalize({ ...specifications, ...changes });
    const drive = new PlanningPreviewDrivetrain(configuration);
    let previous = 0, peakAcceleration = 0, timeToSpeed = Infinity;
    for (let tick = 1; tick <= 300; tick++) {
      drive.step(127, 127);
      peakAcceleration = Math.max(peakAcceleration, (drive.linearVelocity - previous) / .01);
      previous = drive.linearVelocity;
      if (timeToSpeed === Infinity && previous >= configuration.maxSpeedInchesPerSecond * .9)
        timeToSpeed = tick * .01;
    }
    return { peakAcceleration, timeToSpeed, speed: drive.linearVelocity };
  };

  // Top speed represents gearing, not an independent source of extra power.
  const weak = response({ motorWatts: 22 });
  const strong = response({ motorWatts: 55 });
  assert.ok(strong.peakAcceleration > weak.peakAcceleration * 1.5);
  assert.ok(strong.timeToSpeed < weak.timeToSpeed);
  for (const loadedSpeed of [weak.speed, strong.speed]) {
    assert.ok(loadedSpeed > specifications.maxSpeedInchesPerSecond * .9 &&
      loadedSpeed <= specifications.maxSpeedInchesPerSecond + .01,
    "both loaded drivetrains approach the same theoretical speed without exceeding it");
  }
  const lowGear = response({ motorWatts: 22, maxSpeedInchesPerSecond: 30 });
  const highGear = response({ motorWatts: 22, maxSpeedInchesPerSecond: 90 });
  assert.ok(lowGear.peakAcceleration > weak.peakAcceleration);
  assert.ok(weak.peakAcceleration > highGear.peakAcceleration);
  assert.ok(lowGear.timeToSpeed < weak.timeToSpeed && weak.timeToSpeed < highGear.timeToSpeed);
  assert.ok(highGear.speed > lowGear.speed, "faster gearing trades launch force for top speed");

  const run = (type, amount, changes = {}, forwards = true) => simulate({
    configuration: normalize({ ...specifications, library: "vexcode", ...changes }),
    waypoints: [
      { x: 0, y: 0, theta: 0, speed: 127, forwards, motions: [{ id: "motion", type }] },
      { x: 0, y: type === "forward" ? amount * (forwards ? 1 : -1) : 0,
        theta: type === "rotate" ? amount : 0 },
    ],
  });

  // Regression: fixed velocity gains made a 55 W/57.7 in/s/15 lb robot
  // take longer than its 22 W counterpart because of artificial settling.
  // Include traction-limited low gearing and faster, torque-limited gearing.
  for (const maxSpeedInchesPerSecond of [30, 57.7, 90]) {
    for (const forwards of [true, false]) {
      for (const distance of [6, 24, 60, 120]) {
        let previous = Infinity;
        for (const motorWatts of [22, 33, 44, 55, 66, 88]) {
          const result = run("forward", distance, { motorWatts, maxSpeedInchesPerSecond }, forwards);
          assert.equal(result.sections[0].outcome, "reached");
          assert.ok(result.duration <= previous + .011,
            `extra power should not add a settling penalty: ${motorWatts} W, ${maxSpeedInchesPerSecond} in/s, ${distance} in`);
          previous = result.duration;
          const last = result.sections[0].samples.at(-1);
          const target = distance * (forwards ? 1 : -1);
          assert.ok(Math.abs(last.y - target) <= .25, "arrives within the existing distance tolerance");
          assert.ok(Math.abs(last.linearVelocity) < .01);
          assert.ok(result.sections[0].samples.every(p => Math.abs(p.y) <= distance + .25),
            "braking accounts for tracking delay instead of overshooting and reversing");
        }
      }
    }
    for (const angle of [15, -90, 179]) {
      let previous = Infinity;
      for (const motorWatts of [22, 33, 44, 55, 66, 88]) {
        const result = run("rotate", angle, { motorWatts, maxSpeedInchesPerSecond });
        assert.equal(result.sections[0].outcome, "reached");
        assert.ok(result.duration <= previous + .011, "extra power should not penalize turn settling");
        previous = result.duration;
        assert.ok(result.sections[0].samples.every(p => p.x === 0 && p.y === 0));
      }
    }
  }

  // Stronger gearing can win a short movement, while higher top speed wins a
  // sufficiently long movement. Do not make higher gearing accelerate faster.
  assert.ok(run("forward", 6, { motorWatts: 55, maxSpeedInchesPerSecond: 30 }).duration <
    run("forward", 6, { motorWatts: 55, maxSpeedInchesPerSecond: 90 }).duration);
  assert.ok(run("forward", 120, { motorWatts: 55, maxSpeedInchesPerSecond: 90 }).duration <
    run("forward", 120, { motorWatts: 55, maxSpeedInchesPerSecond: 30 }).duration);
  assert.ok(run("forward", 60, { motorWatts: 55, robotWeightPounds: 25 }).duration >
    run("forward", 60, { motorWatts: 55, robotWeightPounds: 10 }).duration);
  assert.deepEqual(run("forward", 60).sections[0].samples,
    run("forward", 60, { library: "custom", previewModel: "vexcode" }).sections[0].samples);
}

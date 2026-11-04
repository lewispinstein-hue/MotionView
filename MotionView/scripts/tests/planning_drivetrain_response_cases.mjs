import assert from "node:assert/strict";

export async function runPlanningDrivetrainResponseTests(server) {
  const { normalizePlanningSimulationConfiguration: normalize } =
    await server.ssrLoadModule("/planning/planningSimulationConfiguration.ts");
  const { PlanningPreviewDrivetrain } =
    await server.ssrLoadModule("/planning/planningPreviewDrivetrain.ts");
  const { simulatePlanningRoute: simulate } =
    await server.ssrLoadModule("/planning/planningSimulation.ts");

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
  assert.ok(Math.abs(weak.speed - strong.speed) < .01, "both drivetrains have the same geared speed");
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

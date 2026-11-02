import assert from "node:assert/strict";

export async function runBoomerangConfigurationTests(server) {
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const { generatePlanningCode } = await server.ssrLoadModule("/planning/planningCode.ts");
  const { normalizeBoomerangPreviewConfiguration: normalize, normalizeBoomerangMotorWatts, applyBoomerangLibraryPreset: preset } = await server.ssrLoadModule("/planning/planningBoomerangConfiguration.ts");
  const { boomerangInputUnit, boomerangInputNumber } = await server.ssrLoadModule("/planning/render/planningBoomerangInputUnits.ts");
  const { inferPlanningDriveMotors, PlanningPreviewDrivetrain } = await server.ssrLoadModule("/planning/planningPreviewDrivetrain.ts");
  const { PlanningSegment } = await server.ssrLoadModule("/planning/planningSegments.ts");
  assert.deepEqual(inferPlanningDriveMotors(66), { elevenWatt: 6, fivePointFiveWatt: 0 });
  assert.deepEqual(inferPlanningDriveMotors(55), { elevenWatt: 4, fivePointFiveWatt: 2 });
  assert.deepEqual(inferPlanningDriveMotors(27.5), { elevenWatt: 2, fivePointFiveWatt: 1 });
  for (let watts = 22; watts <= 88; watts += 5.5) {
    const motors = inferPlanningDriveMotors(watts);
    assert.equal(normalizeBoomerangMotorWatts(watts), watts);
    assert.equal(motors.elevenWatt * 11 + motors.fivePointFiveWatt * 5.5, watts);
    assert.equal(normalize({ motorWatts: watts }).motorWatts, watts);
  }
  assert.equal(normalizeBoomerangMotorWatts(-10), 22);
  assert.equal(normalizeBoomerangMotorWatts(0), 22);
  assert.equal(normalizeBoomerangMotorWatts(880), 88);
  assert.equal(normalizeBoomerangMotorWatts(29), 27.5);
  assert.equal(normalizeBoomerangMotorWatts(NaN), 66);
  for (const [units, factor, speed, width] of [
    ["in", 1, "60", "12"],
    ["cm", 1 / 2.54, "152.4", "30.48"],
    ["ft", 12, "5", "1"],
    ["tiles", 24, "2.5", "0.5"],
  ]) {
    const distance = boomerangInputUnit("distance", units);
    const velocity = boomerangInputUnit("speed", units);
    assert.equal(distance.suffix, units);
    assert.equal(velocity.suffix, `${units}/s`);
    assert.equal(distance.factor, factor);
    assert.equal(boomerangInputNumber(60 / velocity.factor), speed);
    assert.equal(boomerangInputNumber(12 / distance.factor), width);
    const mass = boomerangInputUnit("weight", units);
    assert.equal(mass.suffix, units === "cm" ? "kg" : "lb");
    assert.ok(Math.abs(15 / mass.factor - (units === "cm" ? 6.80388555 : 15)) < 1e-10);
  }
  const defaults = normalize(undefined);
  assert.ok(defaults.lateralPID.kP > 0 && defaults.angularPID.kP > 0);
  for (const malformed of [null, false, 8, [], "bad", { lateralPID: null, angularPID: "bad", library: "unknown", motorWatts: Infinity }])
    assert.deepEqual(normalize(malformed), defaults);
  assert.equal(normalize({ motorWatts: 54 }).motorWatts, 55);
  const invalid = normalize({ robotWeightPounds: 0, maxSpeedInchesPerSecond: -1, trackWidth: 0, turnBias: 0 });
  assert.ok(invalid.robotWeightPounds > 0 && invalid.maxSpeedInchesPerSecond > 0 && invalid.trackWidth > 0 && invalid.turnBias > 0);

  const tuned = normalize({ motorWatts: 55, robotWeightPounds: 18, maxSpeedInchesPerSecond: 75, lateralPID: { kP: 9 }, angularPID: { kP: 3 } });
  const ez = preset("ez-template", tuned);
  assert.equal(ez.library, "ez-template");
  for (const key of ["motorWatts", "robotWeightPounds", "maxSpeedInchesPerSecond", "lateralPID", "angularPID"])
    assert.deepEqual(ez[key], tuned[key], `presets preserve robot field ${key}`);
  assert.equal(ez.maxCarrotDistance, 12);
  assert.equal(ez.lookAheadDistance, 7);
  assert.equal(ez.turnBias, 1.375);
  assert.equal(ez.settlingDistance, ez.lookAheadDistance / 2);
  assert.equal(ez.settlingMinSpeed, 0, "EZ has no LemLib settling power floor");
  assert.equal(ez.horizontalDrift, 0, "EZ has no LemLib curvature/drift restriction");
  const lemlib = preset("lemlib", ez);
  assert.equal(lemlib.settlingDistance, 7.5);
  assert.equal(lemlib.settlingMinSpeed, 60);
  assert.equal(lemlib.maxCarrotDistance, 0, "LemLib does not cap the carrot distance");
  assert.equal(lemlib.turnBias, 1, "LemLib does not use EZ turn bias");
  assert.notDeepEqual(lemlib, ez, "presets differ in constants, not just their model/name");
  for (const key of ["motorWatts", "robotWeightPounds", "maxSpeedInchesPerSecond", "trackWidth", "lateralPID", "angularPID"])
    assert.deepEqual(lemlib[key], tuned[key], `switching back preserves robot field ${key}`);
  assert.deepEqual(preset("ez-template", lemlib), ez, "round-trip preset switching restores EZ defaults");
  assert.deepEqual(normalize({ library: "ez-template" }), preset("ez-template", defaults),
    "missing saved fields use the selected library defaults");
  const editedEZ = normalize({ ...ez, maxCarrotDistance: 18, lookAheadDistance: 9, turnBias: 1.8, horizontalDrift: 6, settlingDistance: 5 });
  const custom = preset("custom", editedEZ);
  assert.deepEqual(custom, { ...editedEZ, library: "custom" }, "Custom preserves every current setting and preview model");
  assert.equal(custom.previewModel, "ez-template");
  assert.equal(normalize({ library: "ez-template" }).previewModel, "ez-template", "older presets retain their model when no previewModel was saved");
  assert.equal(normalize({ ...custom, previewModel: "invalid" }).previewModel, "lemlib", "malformed custom models normalize safely");
  assert.equal(preset("lemlib", custom).previewModel, "lemlib");
  assert.equal(preset("lemlib", custom).settlingDistance, defaults.settlingDistance);

  // Each physical input has an observable effect; none are decoration.
  const firstTravel = (values) => new PlanningPreviewDrivetrain(normalize(values)).step(10, 10).travel;
  assert.ok(firstTravel({ motorWatts: 66 }) > firstTravel({ motorWatts: 22 }));
  assert.ok(firstTravel({ robotWeightPounds: 10 }) > firstTravel({ robotWeightPounds: 20 }));
  assert.notEqual(firstTravel({ maxSpeedInchesPerSecond: 40 }), firstTravel({ maxSpeedInchesPerSecond: 80 }));
  for (const library of ["lemlib", "ez-template"]) {
    const config = preset(library, defaults);
    const segment = new PlanningSegment({ x: 0, y: 0, theta: 0, lead: 0.6, speed: 90 }, { x: 30, y: 30, theta: 90 }, config);
    assert.ok(segment.previewConverged, `${library} nominal preview settles`);
    assert.ok(segment.samples.every(({ x, y, theta }) => [x, y, theta].every(Number.isFinite)));
  }
  const ezSamples = (values) => new PlanningSegment(
    { x: 0, y: 0, theta: 0, lead: 0.6, speed: 90 },
    { x: 60, y: 60, theta: 90 },
    normalize({ ...ez, ...values }),
  ).samples;
  assert.notDeepEqual(ezSamples({ maxCarrotDistance: 12 }), ezSamples({ maxCarrotDistance: 30 }));
  assert.notDeepEqual(ezSamples({ lookAheadDistance: 7 }), ezSamples({ lookAheadDistance: 14 }));
  assert.notDeepEqual(ezSamples({ turnBias: 1 }), ezSamples({ turnBias: 2 }));

  const planning = new PlanningFeature();
  planning.load({ "planned-segment-export": true, "planned-path": [{ x: 0, y: 0, theta: 0, lead: 0.6 }, { x: 30, y: 30, theta: 90 }] });
  const originalTemplates = structuredClone(planning.motionTemplates);
  const originalCode = generatePlanningCode(planning);
  const originalGeometry = planning.projection.segments[0];
  planning.setBoomerangConfiguration(ez);
  assert.equal(planning.boomerangConfiguration.library, "ez-template");
  assert.equal(planning.projection.configuration.boomerang, planning.boomerangConfiguration);
  assert.notEqual(planning.projection.segments[0], originalGeometry);
  assert.equal(generatePlanningCode(planning), originalCode, "preview tuning never rewrites export code");
  assert.deepEqual(planning.motionTemplates, originalTemplates, "settings save independently from template text");
  planning.setMotionTemplates({ ...originalTemplates, rotate: "newTurn(@th);" });
  assert.equal(planning.history.undo(), true);
  assert.deepEqual(planning.boomerangConfiguration, ez, "undoing a later template edit does not discard saved settings");
  assert.deepEqual(planning.motionTemplates, originalTemplates);
  assert.equal(planning.history.undo(), true);
  assert.deepEqual(planning.boomerangConfiguration, defaults);
  assert.equal(planning.history.canUndo, false);
  assert.equal(planning.history.redo(), true);
  const path = planning.paths.activeId;
  planning.paths.add();
  assert.deepEqual(planning.boomerangConfiguration, ez, "settings are shared across paths");
  planning.paths.select(path);

  const serializer = new MotionViewDocumentSerializer({ planning, viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } }, version: "test" });
  const exported = serializer.exportPayload("planning", "Config round trip", {});
  assert.deepEqual(exported["planned-boomerang-configuration"], ez);
  for (const data of [JSON.parse(JSON.stringify(exported)), JSON.parse(serializer.savedPaths())]) {
    const restored = new PlanningFeature();
    restored.load(data);
    assert.deepEqual(restored.boomerangConfiguration, ez, "JSON exports and restart autosaves restore settings");
    assert.deepEqual(restored.projection.segments[0].samples, planning.projection.segments[0].samples);
    assert.equal(generatePlanningCode(restored), originalCode);
  }
  for (const previewModel of ["lemlib", "ez-template"]) {
    const profile = normalize({ ...custom, previewModel });
    planning.setBoomerangConfiguration(profile);
    const modelOnly = normalize({ ...profile, library: previewModel });
    const segment = new PlanningSegment(planning.route.waypoints[0], planning.route.waypoints[1], modelOnly);
    assert.deepEqual(planning.projection.segments[0].samples, segment.samples, "Custom follows its explicit model, not a library-name fallthrough");
    const customExport = serializer.exportPayload("planning", "Custom profile", {});
    for (const data of [JSON.parse(JSON.stringify(customExport)), JSON.parse(serializer.savedPaths())]) {
      const restored = new PlanningFeature();
      restored.load(data);
      assert.deepEqual(restored.boomerangConfiguration, profile, "Custom and its model survive JSON export and restart autosave");
      assert.equal(generatePlanningCode(restored), originalCode);
    }
    assert.equal(planning.history.undo(), true);
    assert.equal(planning.boomerangConfiguration.library, "ez-template");
    assert.equal(planning.history.redo(), true);
    assert.deepEqual(planning.boomerangConfiguration, profile);
    planning.setBoomerangConfiguration(ez);
  }
  planning.load({});
  assert.deepEqual(planning.boomerangConfiguration, defaults, "legacy import does not inherit another document's settings");
  planning.setBoomerangConfiguration(ez);
  planning.clear();
  assert.deepEqual(planning.boomerangConfiguration, defaults);
  planning.load({ "planned-boomerang-configuration": { motorWatts: 60.5 } });
  assert.equal(planning.boomerangConfiguration.motorWatts, 60.5, "half-step watts survive imports");
}

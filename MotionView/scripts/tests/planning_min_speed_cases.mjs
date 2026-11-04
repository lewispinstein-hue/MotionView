import assert from "node:assert/strict";

export async function runPlanningMinSpeedTests(server) {
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { PlanningMotionController } = await server.ssrLoadModule("/planning/planningSimulationControllers.ts");
  const { PlanningPreviewDrivetrain } = await server.ssrLoadModule("/planning/planningPreviewDrivetrain.ts");
  const { normalizePlanningSimulationConfiguration: normalize } = await server.ssrLoadModule("/planning/planningSimulationConfiguration.ts");
  const { createPlanningTemplateConfiguration, normalizePlanningTemplateConfiguration } = await server.ssrLoadModule("/planning/planningTemplatePresets.ts");
  const { generatePlanningCode } = await server.ssrLoadModule("/planning/planningCode.ts");
  const { simulatePlanningRoute: simulate } = await server.ssrLoadModule("/planning/planningSimulation.ts");
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const { supportsPlanningMinSpeed } = await server.ssrLoadModule("/planning/planningTemplateCapabilities.ts");
  const planning = new PlanningFeature();
  const configuration = { ...createPlanningTemplateConfiguration(), library: "lemlib" };
  planning.setTemplateConfiguration(configuration);
  planning.route.replace([{ x: 5, y: 0, speed: 80 }, { x: 5, y: 24 }]);
  const legacyCode = generatePlanningCode(planning);
  assert.ok(legacyCode.includes(".minSpeed = 0"));
  planning.route.updateField(0, "minSpeed", 25);
  const pathA = planning.paths.activeId;
  planning.paths.add();
  assert.equal(planning.history.undo(), true); // New path.
  assert.equal(planning.history.undo(), true); // Minimum speed edit.
  assert.equal(planning.route.waypoints[0].minSpeed ?? 0, 0);
  assert.equal(planning.history.redo(), true);
  assert.equal(planning.route.waypoints[0].minSpeed, 25);
  assert.equal(planning.paths.activeId, pathA);
  planning.route.updateField(0, "minSpeed", 200);
  assert.equal(planning.route.waypoints[0].minSpeed, 80, "minimum cannot exceed the maximum");
  planning.route.updateField(0, "speed", 20);
  assert.equal(planning.route.waypoints[0].minSpeed, 20, "lowering Speed also constrains Min Speed");
  planning.route.updateField(0, "minSpeed", -5);
  assert.equal(planning.route.waypoints[0].minSpeed, 0);
  planning.route.updateField(0, "speed", 80);
  planning.route.updateField(0, "minSpeed", 25);
  for (const type of ["forward", "rotate", "swing", "boomerang"]) {
    planning.route.updateMotions(0, [{ id: type, type }]);
    assert.ok(generatePlanningCode(planning).includes(".minSpeed = 25"), `${type} exports its minimum`);
  }
  const oldPreset = structuredClone(configuration);
  for (const type of Object.keys(oldPreset.templates.lemlib))
    oldPreset.templates.lemlib[type] = oldPreset.templates.lemlib[type].replace(", .minSpeed = @minspd", "");
  assert.equal(normalizePlanningTemplateConfiguration(oldPreset).library, "lemlib", "older untouched presets upgrade as presets");

  const jar = createPlanningTemplateConfiguration(); jar.library = "jar-template";
  planning.setTemplateConfiguration(jar);
  for (const type of ["forward", "boomerang"]) {
    planning.route.updateMotions(0, [{ id: type, type }]);
    assert.ok(generatePlanningCode(planning).includes("25 * 12.0 / 127.0, 80 * 12.0 / 127.0"),
      `JAR ${type} converts both minimum and maximum power to volts`);
  }
  const previousJar = structuredClone(jar);
  for (const type of ["forward", "boomerang"])
    previousJar.templates["jar-template"][type] = previousJar.templates["jar-template"][type]
      .replace("@minspd * 12.0 / 127.0", "chassis.drive_min_voltage");
  assert.equal(normalizePlanningTemplateConfiguration(previousJar).library, "jar-template");
  for (const library of ["lemlib", "custom", "ez-template", "jar-template", "vexcode-cpp", "vexcode-python"]) {
    for (const type of ["forward", "rotate", "swing", "boomerang"]) {
      assert.equal(supportsPlanningMinSpeed(library, type),
        library === "lemlib" || library === "custom" ||
          library === "jar-template" && ["forward", "boomerang"].includes(type));
    }
  }

  planning.setMotionTemplates({ ...planning.motionTemplates, forward: "move(@minspd,${minSpeed});" });
  planning.route.updateMotions(0, [{ id: "override", type: "forward", overrideCode: "override(@minspd,${minSpeed});" }]);
  const objectId = planning.objects.add({ name: "Robot" });
  const methodId = planning.objects.addMethod(objectId, { name: "Before", code: "node(@minspd,${minSpeed});" });
  planning.timeline.insert(objectId, methodId, 0, 0);
  assert.equal(generatePlanningCode(planning), "node(25,25);\noverride(25,25);");
  const derived = planning.paths.derive(pathA);
  assert.ok(derived);
  planning.paths.mirror("left-right");
  assert.equal(planning.route.waypoints[0].minSpeed, 25);
  const serializer = new MotionViewDocumentSerializer({
    planning, viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } }, version: "test",
  });
  for (const document of [serializer.exportPayload("planning", "Min Speed", {}), JSON.parse(serializer.savedPaths())]) {
    assert.equal(document["planned-path"][0].minSpeed, 25);
    assert.ok(document["planned-paths"].every(path => path["planned-path"][0].minSpeed === 25));
    const restored = new PlanningFeature(); restored.load(document);
    assert.equal(restored.route.waypoints[0].minSpeed, 25);
    assert.equal(generatePlanningCode(restored), generatePlanningCode(planning));
    assert.deepEqual(restored.paths.items, planning.paths.items);
  }

  const config = normalize();
  for (const type of ["forward", "rotate", "swing"]) {
    for (const forwards of [true, false]) {
      const drive = new PlanningPreviewDrivetrain(config);
      const target = type === "forward" ? { x: 0, y: forwards ? .25 : -.25, theta: 0 }
        : { x: 0, y: 0, theta: .25 * Math.PI / 180 };
      const controller = new PlanningMotionController({ id: type, type }, target, 0, forwards, 80,
        config, { x: 0, y: 0, theta: 0 }, drive, 20);
      const output = controller.update({ x: 0, y: 0, theta: 0 }, drive);
      assert.equal(Math.max(Math.abs(output.left), Math.abs(output.right)), 20, `${type} applies its minimum output`);
      const crossed = controller.update(type === "forward"
        ? { x: 0, y: forwards ? .5 : -.5, theta: 0 }
        : { x: 0, y: 0, theta: .5 * Math.PI / 180 }, drive);
      assert.equal(crossed.chained, true, `${type} chains at crossing instead of oscillating with a power floor`);
    }
  }
  const drive = new PlanningPreviewDrivetrain(config);
  const boom = new PlanningMotionController({ id: "boom", type: "boomerang" }, { x: 0, y: 20, theta: 0 },
    .6, true, 80, config, { x: 0, y: 0, theta: 0 }, drive, 20);
  boom.update({ x: 0, y: 0, theta: 0 }, drive);
  assert.equal(boom.update({ x: 0, y: 13, theta: 0 }, drive).chained, true,
    "LemLib Boomerang follows the library's close-range carrot-side chaining test");

  const waypoints = [
    { x: 0, y: 0, theta: 0, speed: 80, motions: [{ id: "first", type: "forward" }] },
    { x: 0, y: 24, theta: 0, speed: 80, motions: [{ id: "second", type: "forward" }] },
    { x: 0, y: 48, theta: 0 },
  ];
  const before = simulate({ waypoints, configuration: config });
  const changed = waypoints.map((p, i) => i === 1 ? { ...p, minSpeed: 30 } : p);
  const after = simulate({ waypoints: changed, configuration: config }, before);
  assert.equal(after.complete, true);
  assert.equal(after.sections[0], before.sections[0], "earlier cached sections remain reusable");
  assert.notEqual(after.sections[1], before.sections[1], "editing the minimum invalidates the affected suffix");
  assert.notEqual(after.duration, before.duration);
  for (const templateLibrary of ["custom", "ez-template", "vexcode-cpp", "vexcode-python"]) {
    const ez = normalize({ library: "ez-template" });
    const a = simulate({ waypoints, configuration: ez, templateLibrary });
    const b = simulate({ waypoints: changed, configuration: ez, templateLibrary });
    assert.deepEqual(a.sections.map(s => s.samples), b.sections.map(s => s.samples),
      "presets without a minimum-power parameter retain their existing simulation");
  }
  for (const type of ["rotate", "swing"]) {
    const points = [{ x: 0, y: 0, theta: 0, motions: [{ id: type, type }] }, { x: 0, y: 24, theta: 90 }];
    const withMinimum = [{ ...points[0], minSpeed: 60 }, points[1]];
    const a = simulate({ waypoints: points, configuration: config, templateLibrary: "jar-template" });
    const b = simulate({ waypoints: withMinimum, configuration: config, templateLibrary: "jar-template" });
    assert.deepEqual(a.sections.map(s => s.samples), b.sections.map(s => s.samples),
      `JAR ${type} does not simulate a minimum absent from its exported code`);
  }
}

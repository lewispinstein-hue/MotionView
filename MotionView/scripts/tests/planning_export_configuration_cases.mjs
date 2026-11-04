import assert from "node:assert/strict";

export async function runPlanningExportConfigurationTests(server) {
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { createPlanningTemplateConfiguration, PLANNING_TEMPLATE_LIBRARIES } =
    await server.ssrLoadModule("/planning/planningTemplatePresets.ts");
  const { generatePlanningCode } = await server.ssrLoadModule("/planning/planningCode.ts");
  const { MotionViewDocumentSerializer } =
    await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const documents = planning => {
    const data = { poses: [], watches: [], logs: [], waypoints: [] };
    const serializer = new MotionViewDocumentSerializer({
      planning, viewing: { data, exportData: () => data }, version: "test",
    });
    return [JSON.parse(serializer.savedPaths()),
      serializer.exportPayload("planning", "Compact templates", {}),
      serializer.exportPayload("both", "Compact templates", {})];
  };
  const defaults = createPlanningTemplateConfiguration();
  for (const { id: library } of PLANNING_TEMPLATE_LIBRARIES) {
    const planning = new PlanningFeature();
    planning.setTemplateConfiguration({ ...defaults, library });
    planning.route.replace([{ x: 0, y: 0 }, { x: 12, y: 24, theta: 90 }]);
    for (const document of documents(planning)) {
      assert.deepEqual(document["planned-template-configuration"], { library },
        "unchanged presets and blank Custom need only the selection ID");
      assert.equal(Object.hasOwn(document, "planned-motion-templates"), false);
      assert.equal(Object.hasOwn(document, "planned-export-template"), false);
      const restored = new PlanningFeature(); restored.load(document);
      assert.deepEqual(restored.templateConfiguration, planning.templateConfiguration);
      assert.equal(generatePlanningCode(restored), generatePlanningCode(planning));
    }
  }

  // An inactive Custom bank, its language and side mappings survive switching
  // presets, export/import and restart, including deliberately blank motions.
  const custom = { forward: "drive(@x, @fwd)", rotate: "", swing: "swing(@side)", boomerang: "pose(@ld)" };
  for (const { id: library } of PLANNING_TEMPLATE_LIBRARIES) {
    const planning = new PlanningFeature();
    const configuration = createPlanningTemplateConfiguration();
    Object.assign(configuration, { library, customLanguage: "python" });
    configuration.templates.custom = { ...custom };
    configuration.swingDriveSides.custom = { left: "LOCK_LEFT", right: "" };
    planning.setTemplateConfiguration(configuration);
    planning.route.replace([{ x: 0, y: 0 }, { x: 12, y: 24, theta: 90 }]);
    for (const document of documents(planning)) {
      const saved = document["planned-template-configuration"];
      assert.deepEqual(saved.templates, { custom });
      assert.deepEqual(saved.swingDriveSides, { custom: configuration.swingDriveSides.custom });
      assert.equal(saved.library, library);
      assert.equal(saved.customLanguage, "python");
      const restored = new PlanningFeature(); restored.load(document);
      assert.deepEqual(restored.templateConfiguration, planning.templateConfiguration);
      assert.equal(generatePlanningCode(restored), generatePlanningCode(planning));
      restored.setTemplateConfiguration({ ...restored.templateConfiguration, library: "custom" });
      assert.deepEqual(restored.motionTemplates, custom);
    }
  }

  const planning = new PlanningFeature();
  planning.setTemplateConfiguration({ ...defaults, library: "lemlib" });
  const templates = planning.motionTemplates;
  planning.route.replace([
    { x: 0, y: 0, motions: [
      { id: "linked", type: "forward", overrideCode: templates.forward },
      { id: "edited", type: "rotate", overrideCode: "editedTurn(@th);" },
    ] },
    { x: 0, y: 12, motions: [{ id: "empty", type: "forward", overrideCode: "" }] },
    { x: 12, y: 12, overrideCode: templates.forward },
    { x: 24, y: 12, overrideCode: "legacyEdited(@x);" },
    { x: 24, y: 24, lead: .6, overrideCode: templates.boomerang },
    { x: 12, y: 24, overrideCode: "ignored();", motions: [
      { id: "own-motion", type: "forward", overrideCode: defaults.templates["ez-template"].forward },
    ] },
    { x: 0, y: 24 },
  ]);
  const firstPath = planning.paths.activeId;
  planning.paths.derive(firstPath);
  const before = structuredClone(planning.paths.items);
  const expectedCode = generatePlanningCode(planning);
  for (const document of documents(planning)) {
    for (const points of [document["planned-path"], ...document["planned-paths"].map(path => path["planned-path"])]) {
      assert.equal(Object.hasOwn(points[0].motions[0], "overrideCode"), false);
      assert.equal(points[0].motions[1].overrideCode, "editedTurn(@th);");
      assert.equal(points[1].motions[0].overrideCode, "", "an empty override still suppresses template code");
      assert.equal(Object.hasOwn(points[2], "overrideCode"), false);
      assert.equal(points[3].overrideCode, "legacyEdited(@x);");
      assert.equal(Object.hasOwn(points[4], "overrideCode"), false);
      assert.equal(Object.hasOwn(points[5], "overrideCode"), false, "motion code supersedes unused waypoint code");
      assert.equal(points[5].motions[0].overrideCode, defaults.templates["ez-template"].forward,
        "matching another preset is still a real override of the selected preset");
    }
    const restored = new PlanningFeature(); restored.load(document);
    for (const path of planning.paths.items) {
      planning.paths.select(path.id); restored.paths.select(path.id);
      assert.equal(generatePlanningCode(restored), generatePlanningCode(planning));
    }
  }
  assert.deepEqual(planning.paths.items, before, "serializing never mutates live code or history");
  assert.equal(generatePlanningCode(planning), expectedCode);

  // VEXcode's temporary motion mapping must not discard original overrides.
  const vex = new PlanningFeature();
  vex.setTemplateConfiguration({ ...defaults, library: "vexcode-cpp" });
  vex.route.replace([
    { x: 0, y: 0, lead: .6, motions: [{ id: "hidden-original", type: "boomerang", overrideCode: "" }] },
    { x: 0, y: 12 },
  ]);
  for (const document of documents(vex)) {
    assert.equal(document["planned-path"][0].motions[0].overrideCode, "");
    const restored = new PlanningFeature(); restored.load(document);
    restored.setTemplateConfiguration({ ...restored.templateConfiguration, library: "lemlib" });
    assert.equal(generatePlanningCode(restored), "");
  }
}

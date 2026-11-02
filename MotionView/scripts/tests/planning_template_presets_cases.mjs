import assert from "node:assert/strict";

export async function runPlanningTemplatePresetTests(server) {
  const { createPlanningTemplateConfiguration, normalizePlanningTemplateConfiguration, editPlanningMotionTemplate } = await server.ssrLoadModule("/planning/planningTemplatePresets.ts");
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { generatePlanningCode } = await server.ssrLoadModule("/planning/planningCode.ts");
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const blank = { forward: "", rotate: "", swing: "", boomerang: "" };
  const planning = new PlanningFeature();
  assert.equal(planning.templateConfiguration.library, "custom");
  assert.deepEqual(planning.motionTemplates, blank, "all four initial Custom templates are blank");
  const defaults = createPlanningTemplateConfiguration();
  for (const invalid of [null, false, [], 1, "bad", { library: "unknown", templates: { custom: false } }])
    assert.deepEqual(normalizePlanningTemplateConfiguration(invalid), defaults);
  const draft = normalizePlanningTemplateConfiguration(planning.templateConfiguration);
  draft.templates.custom = { forward: "custom(@x);", rotate: "turnCustom(@th);", swing: "", boomerang: "myBoom(@ld);" };
  planning.setTemplateConfiguration(draft);
  const custom = structuredClone(planning.motionTemplates);
  for (const library of ["lemlib", "ez-template", "jar-template"]) {
    for (const type of ["forward", "rotate", "swing", "boomerang"]) {
      const configuration = normalizePlanningTemplateConfiguration(defaults);
      configuration.library = library;
      configuration.templates.custom = { ...custom };
      editPlanningMotionTemplate(configuration, type, defaults.templates[library][type]);
      assert.equal(configuration.library, library, "unchanged input keeps its preset");
      assert.deepEqual(configuration.templates.custom, custom);
      editPlanningMotionTemplate(configuration, type, "editedPreset(@x);");
      assert.equal(configuration.library, "custom", "editing a preset immediately selects Custom");
      assert.deepEqual(configuration.templates.custom, { ...defaults.templates[library], [type]: "editedPreset(@x);" },
        "the complete preset is copied before applying the edit");
      assert.deepEqual(configuration.templates[library], defaults.templates[library], "built-in presets are never edited");
      assert.ok(Object.isFrozen(configuration.templates[library]));
      configuration.library = library;
      assert.deepEqual(configuration.templates[library], defaults.templates[library], "reselecting the preset restores the original code");
      configuration.library = "custom";
      assert.equal(configuration.templates.custom[type], "editedPreset(@x);");
    }
  }
  planning.route.replace([{ x: 0, y: 0, theta: 0, speed: 80 }, { x: 12, y: 24, theta: 90, speed: 90 }]);
  assert.equal(generatePlanningCode(planning), "custom(12);");
  const firstPath = planning.paths.activeId;
  const otherPath = planning.paths.add();
  for (const library of ["lemlib", "ez-template", "jar-template", "custom"]) {
    const next = normalizePlanningTemplateConfiguration(planning.templateConfiguration);
    next.library = library;
    planning.setTemplateConfiguration(next);
    assert.deepEqual(planning.motionTemplates, library === "custom" ? custom : defaults.templates[library]);
    assert.deepEqual(planning.templateConfiguration.templates.custom, custom, "changing presets never overwrites Custom");
    assert.equal(planning.history.undo(), true);
    assert.equal(planning.paths.activeId, otherPath);
    assert.equal(planning.history.redo(), true);
    assert.equal(planning.templateConfiguration.library, library);
  }

  // Template banks are document-wide; undo from another path returns to the edit.
  planning.paths.select(firstPath);
  const edited = normalizePlanningTemplateConfiguration(planning.templateConfiguration);
  edited.library = "lemlib";
  editPlanningMotionTemplate(edited, "rotate", "editedLemTurn(@th);");
  planning.setTemplateConfiguration(edited);
  planning.paths.select(otherPath);
  assert.equal(planning.history.undo(), true);
  assert.equal(planning.paths.activeId, firstPath);
  assert.equal(planning.templateConfiguration.library, "custom");
  assert.deepEqual(planning.motionTemplates, custom);
  assert.equal(planning.history.redo(), true);
  assert.equal(planning.motionTemplates.rotate, "editedLemTurn(@th);");
  planning.setExportTemplate(planning.exportTemplate);
  assert.deepEqual(planning.templateConfiguration.templates.custom, edited.templates.custom, "legacy settings synchronization leaves Custom alone");

  // Custom edits and the selected library survive export and restart.
  const serializer = new MotionViewDocumentSerializer({ planning, viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } }, version: "test" });
  for (const data of [JSON.parse(serializer.savedPaths()), serializer.exportPayload("planning", "Template banks", {})]) {
    const restored = new PlanningFeature();
    restored.load(data);
    assert.deepEqual(restored.templateConfiguration, planning.templateConfiguration);
    assert.deepEqual(restored.paths.items, planning.paths.items);
    assert.deepEqual(restored.templateConfiguration.templates.custom, edited.templates.custom);
    assert.equal(generatePlanningCode(restored), generatePlanningCode(planning));
    restored.setTemplateConfiguration({ ...restored.templateConfiguration, library: "custom" });
    assert.deepEqual(restored.motionTemplates, edited.templates.custom);
  }
  const oldEditedPreset = structuredClone(defaults);
  oldEditedPreset.library = "lemlib";
  oldEditedPreset.templates.lemlib.rotate = "savedBeforeFix();";
  planning.load({ "planned-template-configuration": oldEditedPreset });
  assert.equal(planning.templateConfiguration.library, "custom", "previously saved preset edits become Custom");
  assert.equal(planning.motionTemplates.rotate, "savedBeforeFix();");
  assert.deepEqual(planning.templateConfiguration.templates.lemlib, defaults.templates.lemlib);
  planning.setTemplateConfiguration({ ...defaults, library: "lemlib" });
  planning.setMotionTemplates({ ...planning.motionTemplates, swing: "apiEdit();" });
  assert.equal(planning.templateConfiguration.library, "custom", "domain template edits also leave presets immutable");
  assert.equal(planning.motionTemplates.swing, "apiEdit();");
  assert.deepEqual(planning.templateConfiguration.templates.lemlib, defaults.templates.lemlib);
  // A template from an earlier document is retained as Custom, including empty code.
  planning.load({ "planned-motion-templates": custom });
  assert.equal(planning.templateConfiguration.library, "custom");
  assert.deepEqual(planning.motionTemplates, custom);
  planning.load({ "planned-export-template": "legacy(@x);" });
  assert.equal(planning.motionTemplates.forward, "legacy(@x);");
  planning.load({});
  assert.deepEqual(planning.motionTemplates, blank, "a new document does not inherit the previous template");
  planning.setTemplateConfiguration(edited);
  planning.clear();
  assert.deepEqual(planning.templateConfiguration, defaults);

  // All preset motions render with the existing variables, without parser changes.
  const expectedCalls = {
    lemlib: ["chassis.moveToPoint(12, 24", "chassis.turnToHeading(90", "chassis.swingToHeading(90", "chassis.moveToPose(12, 24, 90"],
    "ez-template": ["chassis.pid_odom_set(ez::odom{{12, 24}", "chassis.pid_turn_set(90", "chassis.pid_swing_set(ez::RIGHT_SWING, 90", "chassis.odom_boomerang_dlead_set(0.7)"],
    "jar-template": ["chassis.drive_to_point(12, 24", "chassis.turn_to_angle(90", "chassis.right_swing_to_angle(90", "chassis.drive_to_pose(12, 24, 90, 0.7"],
  };
  planning.route.replace([{ x: 0, y: 0, theta: 0, speed: 80 }, { x: 12, y: 24, theta: 90 }]);
  for (const [library, calls] of Object.entries(expectedCalls)) {
    planning.setTemplateConfiguration({ ...defaults, library });
    for (const [index, type] of ["forward", "rotate", "swing", "boomerang"].entries()) {
      planning.route.updateMotions(0, [{ id: type, type }], false);
      if (type === "boomerang") planning.route.updateLead(0, 0.7);
      const code = generatePlanningCode(planning);
      assert.ok(code.startsWith(calls[index]), `${library} ${type} uses the verified API`);
      assert.ok(!/\$\{|@[a-z]/i.test(code), `${library} ${type} expands every variable`);
      if (library === "ez-template") assert.ok(code.endsWith("chassis.pid_wait();"));
      if (library === "lemlib") assert.ok(code.endsWith(", false);"));
    }
  }
}

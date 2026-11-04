import assert from "node:assert/strict";

export async function runPlanningSwingTemplateTests(server) {
  const { PlanningFeature } = await server.ssrLoadModule(
    "/planning/PlanningFeature.ts",
  );
  const {
    createPlanningTemplateConfiguration,
    normalizePlanningTemplateConfiguration,
    editPlanningMotionTemplate,
    editPlanningSwingDriveSide,
  } = await server.ssrLoadModule("/planning/planningTemplatePresets.ts");
  const { generatePlanningCode } = await server.ssrLoadModule(
    "/planning/planningCode.ts",
  );
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule(
    "/app/persistence/MotionViewDocumentSerializer.ts",
  );
  const defaults = createPlanningTemplateConfiguration();
  const planning = new PlanningFeature();
  const points = [
    { x: 0, y: 0, theta: 0, speed: 80 },
    { x: 12, y: 24, theta: 90 },
  ];
  planning.route.replace(points);
  const expected = {
    lemlib: {
      left: "chassis.swingToHeading(90, lemlib::DriveSide::LEFT",
      right: "chassis.swingToHeading(90, lemlib::DriveSide::RIGHT",
    },
    "ez-template": {
      left: "chassis.pid_swing_set(ez::RIGHT_SWING, 90",
      right: "chassis.pid_swing_set(ez::LEFT_SWING, 90",
    },
    "jar-template": {
      left: "chassis.right_swing_to_angle(90,",
      right: "chassis.left_swing_to_angle(90,",
    },
  };
  for (const [library, sides] of Object.entries(expected)) {
    planning.setTemplateConfiguration({ ...defaults, library });
    for (const side of ["left", "right"]) {
      planning.route.updateMotions(0, [
        { id: "swing", type: "swing", lockedDriveSide: side },
      ]);
      assert.ok(
        library === "jar-template" ? generatePlanningCode(planning).includes(sides[side])
          : generatePlanningCode(planning).startsWith(sides[side]),
        `${library} exports the correct locked ${side} side`,
      );
    }
    const derived = normalizePlanningTemplateConfiguration(
      planning.templateConfiguration,
    );
    editPlanningSwingDriveSide(
      derived,
      "left",
      derived.swingDriveSides[library].left,
    );
    assert.equal(
      derived.library,
      library,
      "unchanged field input retains the preset",
    );
    editPlanningSwingDriveSide(derived, "left", "myLockedLeft");
    assert.equal(
      derived.library,
      "custom",
      "editing a preset side value derives Custom",
    );
    assert.deepEqual(derived.templates.custom, defaults.templates[library]);
    assert.deepEqual(derived.swingDriveSides.custom, {
      ...defaults.swingDriveSides[library],
      left: "myLockedLeft",
    });
    assert.ok(Object.isFrozen(derived.swingDriveSides[library]));
    assert.deepEqual(
      derived.swingDriveSides[library],
      defaults.swingDriveSides[library],
      "preset side values stay immutable",
    );
    const codeEdit = normalizePlanningTemplateConfiguration(
      planning.templateConfiguration,
    );
    editPlanningMotionTemplate(codeEdit, "swing", "edited(@side);");
    assert.deepEqual(
      codeEdit.swingDriveSides.custom,
      defaults.swingDriveSides[library],
      "code edits copy the side values into Custom too",
    );
  }

  const custom = createPlanningTemplateConfiguration();
  custom.templates.custom.swing = "swing(${lockedDriveSide},@side,@th);";
  custom.swingDriveSides.custom = {
    left: "MyDrive::LEFT",
    right: "MyDrive::RIGHT",
  };
  planning.setTemplateConfiguration(custom);
  planning.route.updateMotions(0, [{ id: "swing", type: "swing" }]);
  assert.equal(
    generatePlanningCode(planning),
    "swing(MyDrive::LEFT,MyDrive::LEFT,90);",
    "an absent side defaults to locked Left",
  );
  planning.route.updateMotions(0, [
    {
      id: "swing",
      type: "swing",
      lockedDriveSide: "right",
      overrideCode: "override(@side,${lockedDriveSide});",
    },
  ]);
  assert.equal(
    generatePlanningCode(planning),
    "override(MyDrive::RIGHT,MyDrive::RIGHT);",
    "overrides expand both forms identically",
  );
  planning.paths.mirror("left-right");
  assert.equal(
    generatePlanningCode(planning),
    "override(MyDrive::LEFT,MyDrive::LEFT);",
    "reflection changes the exported locked side",
  );
  planning.history.undo();
  assert.equal(
    generatePlanningCode(planning),
    "override(MyDrive::RIGHT,MyDrive::RIGHT);",
  );

  const pathA = planning.paths.activeId;
  const pathB = planning.paths.add();
  planning.paths.select(pathA);
  const changed = normalizePlanningTemplateConfiguration(
    planning.templateConfiguration,
  );
  editPlanningSwingDriveSide(changed, "right", "OtherDrive::RIGHT");
  planning.setTemplateConfiguration(changed);
  planning.paths.select(pathB);
  assert.equal(planning.history.undo(), true);
  assert.equal(planning.paths.activeId, pathA);
  assert.equal(
    generatePlanningCode(planning),
    "override(MyDrive::RIGHT,MyDrive::RIGHT);",
  );
  assert.equal(planning.history.redo(), true);
  assert.equal(
    generatePlanningCode(planning),
    "override(OtherDrive::RIGHT,OtherDrive::RIGHT);",
  );
  planning.setTemplateConfiguration({
    ...planning.templateConfiguration,
    library: "lemlib",
  });
  const serializer = new MotionViewDocumentSerializer({
    planning,
    viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } },
    version: "test",
  });
  for (const data of [
    JSON.parse(serializer.savedPaths()),
    serializer.exportPayload("planning", "Swing sides", {}),
  ]) {
    const restored = new PlanningFeature();
    restored.load(data);
    assert.deepEqual(
      restored.templateConfiguration,
      planning.templateConfiguration,
    );
    restored.setTemplateConfiguration({
      ...restored.templateConfiguration,
      library: "custom",
    });
    assert.equal(
      generatePlanningCode(restored),
      "override(OtherDrive::RIGHT,OtherDrive::RIGHT);",
      "inactive Custom side values survive export/restart",
    );
  }

  // Side values are literal code snippets, with intentionally empty values retained.
  const literal = normalizePlanningTemplateConfiguration(custom);
  literal.swingDriveSides.custom.right = "@x ${x}";
  planning.setTemplateConfiguration(literal);
  assert.equal(generatePlanningCode(planning), "override(@x ${x},@x ${x});");
  literal.swingDriveSides.custom.right = "";
  planning.setTemplateConfiguration(literal);
  assert.equal(generatePlanningCode(planning), "override(,);");
  assert.deepEqual(
    normalizePlanningTemplateConfiguration({
      swingDriveSides: { custom: { left: 42, right: null } },
    }).swingDriveSides.custom,
    defaults.swingDriveSides.custom,
    "malformed saved values normalize safely",
  );

  const previous = structuredClone(defaults);
  delete previous.swingDriveSides;
  previous.library = "lemlib";
  previous.templates.lemlib.swing =
    "chassis.swingToHeading(@th, lemlib::DriveSide::LEFT, 2000, {.maxSpeed = @spd}, false);";
  const upgraded = normalizePlanningTemplateConfiguration(previous);
  assert.equal(upgraded.library, "lemlib");
  assert.deepEqual(
    upgraded.templates.lemlib,
    defaults.templates.lemlib,
    "former fixed-side presets upgrade to the new variable",
  );

  // Timeline nodes use the locked side from their existing waypoint context.
  const methodCode = "node(@side,${lockedDriveSide});";
  planning.load({
    "planned-segment-export": true,
    "planned-template-configuration": custom,
    "planned-path": [
      {
        ...points[0],
        motions: [{ id: "swing", type: "swing", lockedDriveSide: "right" }],
      },
      points[1],
    ],
    "planned-objects": [
      {
        id: "object",
        name: "Object",
        methods: [{ id: "method", name: "Method", code: methodCode }],
      },
    ],
    "planned-nodes": [
      {
        id: "before",
        objectId: "object",
        methodId: "method",
        beforeWaypoint: 0,
        index: 0,
      },
      {
        id: "after",
        objectId: "object",
        methodId: "method",
        beforeWaypoint: 1,
        index: 0,
        code: "after(@side);",
      },
    ],
  });
  assert.equal(
    generatePlanningCode(planning),
    "node(MyDrive::RIGHT,MyDrive::RIGHT);\nswing(MyDrive::RIGHT,MyDrive::RIGHT,90);\nafter(MyDrive::RIGHT);",
  );
  assert.equal(planning.objects.items[0].methods[0].code, methodCode);
  assert.equal(planning.timeline.nodes[1].code, "after(@side);");
}

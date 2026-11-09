import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export async function runPlanningVexcodeTests(server) {
  const { PlanningFeature } = await server.ssrLoadModule(
    "/planning/PlanningFeature.ts",
  );
  const { PlanningWaypointEditor } = await server.ssrLoadModule(
    "/planning/PlanningWaypointEditor.ts",
  );
  const { PlanningMotionSelection } = await server.ssrLoadModule(
    "/planning/planningMotionSelection.ts",
  );
  const {
    createPlanningTemplateConfiguration,
    editPlanningMotionTemplate,
    normalizePlanningTemplateConfiguration,
  } = await server.ssrLoadModule("/planning/planningTemplatePresets.ts");
  const { planningMotionsForLibrary } = await server.ssrLoadModule(
    "/planning/planningTemplateCapabilities.ts",
  );
  const { generatePlanningCode } = await server.ssrLoadModule(
    "/planning/planningCode.ts",
  );
  const { simulatePlanningRoute } = await server.ssrLoadModule(
    "/planning/planningSimulation.ts",
  );
  const { segmentDriveHeading } = await server.ssrLoadModule(
    "/planning/planningMotionContext.ts",
  );
  const { buildPlanExportCode } = await server.ssrLoadModule(
    "/planning/planningTemplate.ts",
  );
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule(
    "/app/persistence/MotionViewDocumentSerializer.ts",
  );
  const defaults = createPlanningTemplateConfiguration();
  for (const [end, forwards, expected] of [
    [{ x: 0, y: 24 }, true, 0],
    [{ x: 24, y: 0 }, true, 90],
    [{ x: 0, y: -24 }, true, 180],
    [{ x: -24, y: 0 }, true, 270],
    [{ x: 24, y: 24 }, false, 225],
    [{ x: -24, y: 24 }, false, 135],
    [{ x: 0, y: 0 }, false, 355],
  ])
    assert.equal(
      segmentDriveHeading({ x: 0, y: 0, theta: -5, forwards }, end),
      expected,
    );

  // Reopening an existing VEXcode plan adopts the corrected built-in preset.
  for (const [library, forward] of [
    [
      "vexcode-cpp",
      "Drivetrain.driveFor((@fwd ? forward : reverse), @dist, inches);",
    ],
    [
      "vexcode-cpp",
      "Drivetrain.driveFor((@fwd ? forward : backward), @dist, inches);",
    ],
    [
      "vexcode-python",
      "drivetrain.drive_for(FORWARD if @fwd else REVERSE, @dist, INCHES)",
    ],
  ]) {
    const old = structuredClone(defaults);
    old.library = library;
    old.templates[library].forward = forward;
    old.templates.custom.forward = "myCustom(@dist);";
    const restored = normalizePlanningTemplateConfiguration(old);
    assert.equal(restored.library, library);
    assert.equal(
      restored.templates[library].forward,
      defaults.templates[library].forward,
    );
    assert.equal(
      restored.templates.custom.forward,
      "myCustom(@dist);",
      "upgrading a built-in leaves Custom alone",
    );
    old.templates[library].forward += "\nmyEdit();";
    assert.equal(
      normalizePlanningTemplateConfiguration(old).templates.custom.forward,
      old.templates[library].forward,
      "edited code is never silently rewritten",
    );
  }
  const originalMotions = [
    { id: "curve", type: "boomerang", overrideCode: "originalCurve(@ld);" },
    {
      id: "pivot",
      type: "swing",
      lockedDriveSide: "right",
      overrideCode: "originalSwing(@side);",
    },
  ];
  const planning = new PlanningFeature();
  planning.route.replace([
    {
      x: 0,
      y: 0,
      theta: 0,
      speed: 90,
      lead: 0.6,
      forwards: false,
      motions: originalMotions,
    },
    { x: 30, y: 30, theta: 90 },
  ]);
  const raw = structuredClone(planning.route.waypoints);
  planning.setTemplateConfiguration({ ...defaults, library: "lemlib" });
  const originalCode = generatePlanningCode(planning);
  for (const library of ["vexcode-cpp", "vexcode-python"]) {
    planning.setTemplateConfiguration({ ...defaults, library });
    assert.equal(planning.supportsMotion("swing"), false);
    assert.equal(planning.supportsMotion("boomerang"), false);
    assert.equal(planning.supportsMotion("forward"), true);
    assert.equal(planning.supportsMotion("rotate"), true);
    const expectedCode =
      library === "vexcode-cpp"
        ? "Drivetrain.setTurnVelocity(90 * 100.0 / 127.0, percent);\nDrivetrain.turnToHeading(225, degrees);\nDrivetrain.setDriveVelocity(90 * 100.0 / 127.0, percent);\nDrivetrain.driveFor((false ? forward : reverse), 42.426, inches);\nDrivetrain.setTurnVelocity(90 * 100.0 / 127.0, percent);\nDrivetrain.turnToHeading(90, degrees);"
        : [
            "    drivetrain.set_turn_velocity(90 * 100.0 / 127.0, PERCENT)",
            "    drivetrain.turn_to_heading(225, DEGREES)",
            "    drivetrain.set_drive_velocity(90 * 100.0 / 127.0, PERCENT)",
            "    drivetrain.drive_for(FORWARD if False else REVERSE, 42.426, INCHES)",
            "    drivetrain.set_turn_velocity(90 * 100.0 / 127.0, PERCENT)",
            "    drivetrain.turn_to_heading(90, DEGREES)",
          ].join("\n");
    assert.equal(
      generatePlanningCode(planning),
      expectedCode,
      "disabled motions temporarily export their basic counterparts",
    );
    assert.deepEqual(
      planning.route.waypoints,
      raw,
      "switching presets never rewrites saved motions, lead or code",
    );
    assert.equal(planning.route.toggleBoomerang(0), false);
    planning.route.updateLead(0, 0.2);
    assert.equal(planning.route.waypoints[0].lead, 0.6);
    assert.deepEqual(
      planning.projection.simulation.sections[0].motions.map((m) => m.type),
      ["forward", "rotate"],
    );
    assert.equal(planning.projection.segments[0].curved, false);
    assert.equal(planning.projection.segments[0].lead, 0);
    const predicted = planning.projection.simulation.sections[0].samples.at(-1);
    assert.ok(
      Math.hypot(predicted.x - 30, predicted.y - 30) < 1,
      "Straight aligns before reversing toward the next waypoint",
    );
    const selection = new PlanningMotionSelection(
      originalMotions,
      planning.motionTemplates,
      library,
    );
    assert.deepEqual(
      selection.motions.map((m) => m.type),
      ["forward", "rotate"],
    );
    assert.equal(selection.toggle("swing"), false);
    assert.equal(selection.toggle("boomerang"), false);
    const single = new PlanningMotionSelection(
      undefined,
      planning.motionTemplates,
      library,
    );
    assert.equal(
      single.toggle("boomerang"),
      false,
      "unsupported motions stay disabled even with only one selection",
    );

    // Opening and confirming an unchanged basic view preserves hidden originals.
    const editor = new PlanningWaypointEditor(planning, {
      edit: async () => ({ motions: selection.result, forwards: false }),
    });
    await editor.edit(0);
    assert.deepEqual(planning.route.waypoints, raw);
    assert.equal(generatePlanningCode(planning), expectedCode);

    const serializer = new MotionViewDocumentSerializer({
      planning,
      viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } },
      version: "test",
    });
    for (const data of [
      JSON.parse(serializer.savedPaths()),
      serializer.exportPayload("planning", "VEXcode", {}),
    ]) {
      const restored = new PlanningFeature();
      restored.load(data);
      assert.equal(restored.templateConfiguration.library, library);
      assert.deepEqual(restored.route.waypoints, raw);
      assert.equal(generatePlanningCode(restored), expectedCode);
      restored.setTemplateConfiguration({
        ...restored.templateConfiguration,
        library: "lemlib",
      });
      assert.equal(
        generatePlanningCode(restored),
        originalCode,
        "switching back after restart/import restores original motion code",
      );
    }
    assert.equal(planning.history.undo(), true);
    assert.equal(planning.templateConfiguration.library, "lemlib");
    assert.equal(generatePlanningCode(planning), originalCode);
    assert.equal(planning.history.redo(), true);
    planning.setTemplateConfiguration({
      ...planning.templateConfiguration,
      library: "lemlib",
    });
    assert.equal(generatePlanningCode(planning), originalCode);
  }

  // Both controller models and cached prefixes obey the template restrictions.
  for (const previewModel of ["lemlib", "ez-template"]) {
    const configuration = {
      ...planning.simulationConfiguration,
      library: previewModel,
      previewModel,
    };
    const request = {
      waypoints: [
        {
          x: 0,
          y: 0,
          theta: 0,
          speed: 90,
          lead: 0.6,
          motions: originalMotions,
        },
        { x: 30, y: 30, theta: 90 },
      ],
      configuration,
    };
    const previous = simulatePlanningRoute(request);
    const basic = simulatePlanningRoute(
      { ...request, templateLibrary: "vexcode-cpp" },
      previous,
    );
    assert.deepEqual(
      basic.sections[0].motions.map((m) => m.type),
      ["forward", "rotate"],
    );
    assert.notEqual(basic.sections[0], previous.sections[0]);
    assert.deepEqual(
      simulatePlanningRoute(
        { ...request, templateLibrary: "vexcode-python" },
        basic,
      ),
      basic,
      "the two VEXcode languages share the same motion simulation",
    );
    const restored = simulatePlanningRoute(request, basic);
    assert.deepEqual(
      restored,
      previous,
      "switching back invalidates basic-motion cache entries",
    );

    const waypoints = [
      { x: 0, y: 0, theta: 0, forwards: true },
      { x: -18, y: 24, theta: 0, forwards: true },
      { x: 12, y: 48, theta: 0, forwards: true },
      { x: -12, y: 60, theta: 0 },
    ];
    for (const templateLibrary of ["vexcode-cpp", "vexcode-python"]) {
      const zigzag = simulatePlanningRoute({
        waypoints,
        configuration,
        templateLibrary,
      });
      assert.equal(zigzag.complete, true);
      for (const [index, section] of zigzag.sections.entries()) {
        const end = section.samples.at(-1),
          target = waypoints[index + 1];
        assert.ok(
          Math.hypot(end.x - target.x, end.y - target.y) < 2,
          "a multi-segment route follows waypoint positions despite all waypoint headings being zero",
        );
        assert.equal(
          section.motions.length,
          1,
          "alignment belongs to Straight rather than adding a selected motion",
        );
        if (index > 0)
          assert.deepEqual(
            section.samples[0],
            zigzag.sections[index - 1].samples.at(-1),
            "automatic alignment preserves actual state at section boundaries",
          );
      }
      const turnSamples = zigzag.sections[0].samples.filter(
        (sample) => Math.hypot(sample.x, sample.y) < 0.001,
      );
      assert.ok(
        turnSamples.some(
          (sample) => sample.time > 0.1 && Math.abs(sample.theta) > 0.1,
        ),
        "alignment consumes playback time while turning in place",
      );
      const straightOnly = [
        { x: 0, y: 0, theta: 90, forwards: true },
        { x: 24, y: 0, theta: 0 },
      ];
      const aligned = simulatePlanningRoute({
        waypoints: straightOnly,
        configuration,
        templateLibrary,
      });
      const misaligned = simulatePlanningRoute({
        waypoints: [{ ...straightOnly[0], theta: 0 }, straightOnly[1]],
        configuration,
        templateLibrary,
      });
      assert.ok(
        misaligned.duration > aligned.duration + 0.2,
        "a required alignment turn is included in playback duration",
      );
      const zero = simulatePlanningRoute({
        waypoints: [
          { x: 4, y: 7, theta: 355 },
          { x: 4, y: 7, theta: 90 },
        ],
        configuration,
        templateLibrary,
      });
      assert.ok(
        zero.sections[0].samples.every(
          (s) =>
            s.x === 4 &&
            s.y === 7 &&
            Math.abs(s.theta - (355 * Math.PI) / 180) < 1e-8,
        ),
        "a zero-distance Straight does not invent a turn to the target heading",
      );
      for (const types of [
        ["forward", "rotate"],
        ["rotate", "forward"],
      ]) {
        const ordered = simulatePlanningRoute({
          waypoints: [
            {
              x: 0,
              y: 0,
              theta: 0,
              forwards: true,
              motions: types.map((type) => ({ id: type, type })),
            },
            { x: 24, y: 0, theta: 180 },
          ],
          configuration,
          templateLibrary,
        });
        const last = ordered.sections[0].samples.at(-1);
        const heading = types.at(-1) === "rotate" ? Math.PI : Math.PI / 2;
        assert.ok(
          Math.abs(
            Math.atan2(
              Math.sin(last.theta - heading),
              Math.cos(last.theta - heading),
            ),
          ) < 0.025,
          "an explicit Turn retains its selected execution order around Straight alignment",
        );
      }
      const wrapped = simulatePlanningRoute({
        waypoints: [
          { x: 0, y: 0, theta: 359, forwards: true },
          {
            x: 24 * Math.sin(Math.PI / 180),
            y: 24 * Math.cos(Math.PI / 180),
            theta: 180,
          },
        ],
        configuration,
        templateLibrary,
      });
      assert.ok(
        wrapped.sections[0].samples.every(
          (s) => Math.abs(s.theta - (359 * Math.PI) / 180) < 0.1,
        ),
        "automatic alignment crosses zero using the short turn",
      );
    }
  }

  // Bearing is separate from the destination's heading, in both variable formats.
  const bearingPoints = [
    { x: 0, y: 0, theta: 0, forwards: false },
    { x: 24, y: 0, theta: 10 },
  ];
  assert.equal(
    buildPlanExportCode({
      template: "heading(@bearing,${bearing},@th,@fwd,@dist);",
      waypoints: bearingPoints,
      nodes: [],
      objects: [],
      readPlanSpeed: (value, fallback) => value ?? fallback,
      formatTemplateNumber: (value) => String(value),
      planThetaDegAt: (index) => bearingPoints[index].theta,
      getSortedPlanNodes: () => [],
    }),
    "heading(270,270,10,false,24);",
  );

  // Editing Python derives Custom without reverting its Boolean syntax to C++.
  planning.route.replace([
    { x: 0, y: 0, theta: 0, forwards: true },
    { x: 0, y: 24, theta: 90 },
  ]);
  const python = normalizePlanningTemplateConfiguration({
    ...defaults,
    library: "vexcode-python",
  });
  editPlanningMotionTemplate(
    python,
    "forward",
    python.templates[python.library].forward + "\n\nif @fwd:\n    pass",
  );
  assert.equal(python.library, "custom");
  assert.equal(python.customLanguage, "python");
  planning.setTemplateConfiguration(python);
  const generatedPython = generatePlanningCode(planning);
  assert.ok(generatedPython.includes("FORWARD if True else REVERSE"));
  assert.ok(generatedPython.endsWith("\n\n    if True:\n        pass"));
  const syntax = spawnSync(
    "python3",
    ["-c", "import ast, sys; ast.parse(sys.stdin.read())"],
    { input: `def autonomous():\n${generatedPython}`, encoding: "utf8" },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
  planning.setTemplateConfiguration({
    ...planning.templateConfiguration,
    library: "lemlib",
  });
  planning.setTemplateConfiguration({
    ...planning.templateConfiguration,
    library: "custom",
  });
  assert.equal(
    generatePlanningCode(planning),
    generatedPython,
    "Custom Python survives switching to a C++ preset and back",
  );
  planning.route.updateMotions(0, [
    {
      id: "empty",
      type: "forward",
      overrideCode: "probe(@dt,@dist,${distance});",
    },
  ]);
  assert.equal(
    generatePlanningCode(planning),
    "    probe(@dt,24,24);",
    "the mistyped @dt alias is not added",
  );

  const temporary = planningMotionsForLibrary(
    originalMotions,
    "vexcode-python",
  );
  assert.deepEqual(temporary, [
    { id: "curve", type: "forward" },
    { id: "pivot", type: "rotate" },
  ]);
  assert.deepEqual(originalMotions[1], {
    id: "pivot",
    type: "swing",
    lockedDriveSide: "right",
    overrideCode: "originalSwing(@side);",
  });
}

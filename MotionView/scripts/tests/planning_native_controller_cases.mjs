import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export async function runPlanningNativeControllerTests(server) {
  const { simulatePlanningRoute: simulate } = await server.ssrLoadModule("/planning/planningSimulation.ts");
  const { normalizePlanningSimulationConfiguration: normalize, applyPlanningLibraryPreset: preset, PLANNING_PID_ROLES } =
    await server.ssrLoadModule("/planning/planningSimulationConfiguration.ts");
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { PlanningJarController } = await server.ssrLoadModule("/planning/planningJarController.ts");
  const { PlanningPreviewDrivetrain } = await server.ssrLoadModule("/planning/planningPreviewDrivetrain.ts");
  const { createPlanningTemplateConfiguration } = await server.ssrLoadModule("/planning/planningTemplatePresets.ts");
  const { generatePlanningCode } = await server.ssrLoadModule("/planning/planningCode.ts");
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
  const route = (type, start = {}, target = {}) => [
    { x: 0, y: 0, theta: 0, speed: 90, lead: .6, forwards: true, motions: [{ id: type, type }], ...start },
    { x: 24, y: 24, theta: 90, ...target },
  ];
  const run = (model, type, start = {}, target = {}, changes = {}) =>
    simulate({ configuration: normalize(changes, normalize({ library: model })), waypoints: route(type, start, target) });
  for (const model of ["jar-template", "vexcode"]) {
    for (const type of ["forward", "rotate", "swing", "boomerang"]) {
      const result = run(model, type);
      assert.equal(result.complete, true, `${model} ${type} finishes`);
      assert.ok(["reached", "completed"].includes(result.sections[0].outcome));
      assert.ok(result.sections[0].samples.every(sample => Object.values(sample).every(Number.isFinite)));
    }
    const pure = run(model, "rotate", {}, { x: 0, y: 0 });
    assert.ok(pure.sections[0].samples.every(p => p.x === 0 && p.y === 0 && p.distance === 0));
    const wrapped = run(model, "rotate", { theta: 359 }, { x: 0, y: 0, theta: 1 });
    assert.ok(wrapped.sections[0].samples.every(p => Math.abs(p.theta - 359 * Math.PI / 180) < .1));
    const slow = run(model, "forward", { speed: 20 }, { x: 0, y: 60, theta: 0 });
    const fast = run(model, "forward", { speed: 90 }, { x: 0, y: 60, theta: 0 });
    assert.ok(slow.duration > fast.duration, `${model} keeps waypoint Speed active in playback`);
    assert.ok(Math.max(...slow.sections[0].samples.map(p => Math.abs(p.linearVelocity))) <
      Math.max(...fast.sections[0].samples.map(p => Math.abs(p.linearVelocity))));
    for (const [key, value, type] of [
      ["motorWatts", 22, "forward"], ["robotWeightPounds", 30, "forward"],
      ["maxSpeedInchesPerSecond", 40, "forward"], ["trackWidth", 18, "rotate"],
    ]) assert.notDeepEqual(run(model, type).sections[0].samples,
      run(model, type, {}, {}, { [key]: value }).sections[0].samples,
      `${model} uses ${key} in the common drivetrain model`);
    const chained = simulate({ configuration: normalize({ library: model }), waypoints: [
      ...route("forward", { theta: 45 }), { x: 48, y: 48, theta: 90 },
    ] });
    assert.equal(chained.sections.length, 2);
    assert.deepEqual(chained.sections[1].samples[0], chained.sections[0].samples.at(-1),
      `${model} inherits actual pose and velocity rather than restarting at the target`);
  }

  const jarConfig = normalize({ library: "jar-template", lateralPID: { kP: 1.5 * 127 / 12, kI: 0, kD: 0 } });
  const jarDrive = new PlanningPreviewDrivetrain(jarConfig);
  const jar = new PlanningJarController({ id: "point", type: "forward" }, { x: 0, y: 5, theta: 0 },
    .6, 127, 0, jarConfig, { x: 0, y: 0, theta: 0 });
  const volts = jar.update({ x: 0, y: 0, theta: 0 }, jarDrive);
  near(volts.left * 12 / 127, 7.5); near(volts.right * 12 / 127, 7.5);
  const settling = new PlanningJarController({ id: "point", type: "forward" }, { x: 0, y: 24, theta: 0 },
    .6, 127, 0, jarConfig, { x: 0, y: 0, theta: 0 });
  for (let i = 0; i < 30; i++) assert.equal(settling.update({ x: 0, y: 22, theta: 0 }, jarDrive).arrived, false);
  assert.equal(settling.update({ x: 0, y: 22, theta: 0 }, jarDrive).arrived, true,
    "JAR settles for >300 ms inside its 3-inch nominal odom tolerance");
  const autoReverse = run("jar-template", "forward", { forwards: true }, { x: 0, y: -24, theta: 0 });
  const reverseFlag = run("jar-template", "forward", { forwards: false }, { x: 0, y: -24, theta: 0 });
  assert.deepEqual(autoReverse.sections[0].samples, reverseFlag.sections[0].samples,
    "JAR chooses reverse itself instead of using LemLib's forwards flag");
  assert.ok(autoReverse.sections[0].samples.at(-1).y < -20);
  const left = run("jar-template", "swing", { motions: [{ id: "swing", type: "swing", lockedDriveSide: "left" }] });
  const right = run("jar-template", "swing", { motions: [{ id: "swing", type: "swing", lockedDriveSide: "right" }] });
  assert.ok(left.sections[0].samples.at(-1).x < 0 && right.sections[0].samples.at(-1).x > 0);
  assert.notDeepEqual(run("jar-template", "boomerang").sections[0].samples,
    run("jar-template", "boomerang", {}, {}, { jarSetback: 4 }).sections[0].samples);
  assert.notDeepEqual(run("jar-template", "forward").sections[0].samples,
    run("jar-template", "forward", {}, {}, { jarHeadingMaxVoltage: 4 }).sections[0].samples);

  for (const forwards of [true, false]) {
    const reversed = run("vexcode", "forward", { forwards }, { x: 24, y: 0, theta: 0 });
    const p = reversed.sections[0].samples.at(-1);
    assert.ok(Math.hypot(p.x - 24, p.y) < 1);
    assert.ok(Math.abs(Math.atan2(Math.sin(p.theta - (forwards ? Math.PI / 2 : -Math.PI / 2)),
      Math.cos(p.theta - (forwards ? Math.PI / 2 : -Math.PI / 2)))) < .025);
  }
  const inertial = run("vexcode", "forward");
  const ignoredPID = Object.fromEntries(PLANNING_PID_ROLES.map(role => [role, { kP: 100, kI: 50, kD: 70 }]));
  assert.deepEqual(inertial.sections[0].samples, run("vexcode", "forward", {}, {}, ignoredPID).sections[0].samples,
    "VEXcode does not accidentally run LemLib/EZ user PID gains");
  const zero = run("vexcode", "forward", {}, { x: 0, y: 0, theta: 90 });
  assert.ok(zero.sections[0].samples.every(p => p.x === 0 && p.y === 0 && p.theta === 0));
  assert.notEqual(run("vexcode", "rotate").duration,
    run("vexcode", "rotate", {}, {}, { vexTurnConstant: .5 }).duration);
  assert.notEqual(run("vexcode", "rotate").duration,
    run("vexcode", "rotate", {}, {}, { vexTurnThreshold: 3 }).duration);
  assert.deepEqual(run("vexcode", "swing").sections[0].motions.map(m => m.type), ["rotate"]);
  assert.deepEqual(run("vexcode", "boomerang").sections[0].motions.map(m => m.type), ["forward"]);
  const slowVelocity = run("vexcode", "forward", { speed: 20 }, { x: 0, y: 60 });
  assert.ok(Math.max(...slowVelocity.sections[0].samples.map(p => Math.abs(p.linearVelocity))) < 60 * 20 / 127 * 1.1,
    "velocity percent is a speed target, not an equivalent open-loop voltage command");

  // Models and familiar tuning are document state, while presets preserve robot/PID values.
  for (const model of ["jar-template", "vexcode"]) {
    const planning = new PlanningFeature();
    planning.route.replace(route("forward"));
    planning.setSimulationConfiguration({ motorWatts: 44, angularPID: { kP: 7 }, separatePIDsInitialized: true });
    const before = planning.simulationConfiguration;
    const profile = preset(model, before);
    for (const role of PLANNING_PID_ROLES) assert.deepEqual(profile[role], before[role]);
    assert.equal(profile.motorWatts, 44);
    planning.setSimulationConfiguration(profile);
    const path = planning.paths.activeId;
    planning.paths.add();
    assert.equal(planning.history.undo(), true);
    assert.equal(planning.history.undo(), true);
    assert.equal(planning.simulationConfiguration.previewModel, "lemlib");
    assert.equal(planning.history.redo(), true);
    assert.equal(planning.paths.activeId, path);
    assert.equal(planning.simulationConfiguration.previewModel, model);
    const serializer = new MotionViewDocumentSerializer({ planning,
      viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } }, version: "test" });
    for (const data of [JSON.parse(serializer.savedPaths()), serializer.exportPayload("planning", "Native model", {})]) {
      const restored = new PlanningFeature(); restored.load(data);
      assert.deepEqual(restored.simulationConfiguration, planning.simulationConfiguration);
      assert.equal(generatePlanningCode(restored), generatePlanningCode(planning));
    }
    planning.setSimulationConfiguration({ library: "custom", previewModel: model });
    assert.equal(planning.simulationConfiguration.previewModel, model);
  }

  // Compile generated calls against the published API signatures, including the
  // scoped JAR swing speed limit and both VEXcode velocity setters.
  const planning = new PlanningFeature();
  const defaults = createPlanningTemplateConfiguration();
  const cpp = [];
  for (const library of ["vexcode-cpp", "jar-template"]) {
    planning.setTemplateConfiguration({ ...defaults, library });
    for (const type of ["forward", "rotate", "swing", "boomerang"]) {
      planning.route.replace(route(type, { speed: 64, minSpeed: 20 }));
      const code = generatePlanningCode(planning);
      cpp.push(`void ${library === "jar-template" ? "jar" : "vex"}_${type}() {\n${code}\n}`);
      if (library === "vexcode-cpp") {
        assert.ok(code.includes("setTurnVelocity(64 * 100.0 / 127.0, percent)"));
        if (["forward", "boomerang"].includes(type)) assert.ok(code.includes("setDriveVelocity(64 * 100.0 / 127.0, percent)"));
      }
    }
  }
  const cppApi = `
  enum Unit { percent, degrees, inches }; enum Direction { forward, reverse };
  struct VexDrive { void setDriveVelocity(double, Unit); void setTurnVelocity(double, Unit);
    void driveFor(Direction, double, Unit); void turnToHeading(double, Unit); } Drivetrain;
  struct JarDrive { double heading_max_voltage, boomerang_setback, turn_max_voltage;
    double swing_settle_error, swing_settle_time, swing_timeout, swing_kp, swing_ki, swing_kd, swing_starti;
    void drive_to_point(double,double,double,double,double); void turn_to_angle(double,double);
    void drive_to_pose(double,double,double,double,double,double,double,double);
    void right_swing_to_angle(double,double,double,double,double,double,double,double,double);
    void left_swing_to_angle(double,double,double,double,double,double,double,double,double);
  } chassis;`;
  const compiled = spawnSync("c++", ["-std=c++17", "-fsyntax-only", "-x", "c++", "-"],
    { input: cppApi + cpp.join("\n"), encoding: "utf8" });
  // The app's JS-only regression suite also runs on machines without a C++ SDK.
  if (compiled.error?.code !== "ENOENT") assert.equal(compiled.status, 0, compiled.stderr);
  planning.setTemplateConfiguration({ ...defaults, library: "vexcode-python" });
  planning.route.replace(route("forward", { speed: 64, motions: [{ id: "forward", type: "forward" }, { id: "turn", type: "rotate" }] }));
  const python = generatePlanningCode(planning);
  const checked = spawnSync("python3", ["-c", `
import sys
calls=[]
class Drive:
    def set_drive_velocity(self, value, units): calls.append(('drive', value, units))
    def set_turn_velocity(self, value, units): calls.append(('turn', value, units))
    def drive_for(self, *args): pass
    def turn_to_heading(self, *args): pass
drivetrain=Drive()
PERCENT='percent'; DEGREES='degrees'; INCHES='inches'; FORWARD=1; REVERSE=-1
exec(sys.stdin.read())
assert [kind for kind,_,_ in calls] == ['turn','drive','turn']
assert all(abs(value - 64*100/127) < 1e-9 and unit == PERCENT for _,value,unit in calls)
`], { input: python, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
}

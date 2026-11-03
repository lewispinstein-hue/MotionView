import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

export async function runPlanningSimulationTests(server) {
  const { simulatePlanningRoute: simulate } = await server.ssrLoadModule("/planning/planningSimulation.ts");
  const { normalizePlanningSimulationConfiguration: normalize, applyPlanningLibraryPreset: preset } = await server.ssrLoadModule("/planning/planningSimulationConfiguration.ts");
  const { PlanningFeature } = await server.ssrLoadModule("/planning/PlanningFeature.ts");
  const { PlanningTimelineView } = await server.ssrLoadModule("/planning/render/PlanningTimelineView.ts");
  const { PlanningMotionSelection } = await server.ssrLoadModule("/planning/planningMotionSelection.ts");
  const { generatePlanningCode } = await server.ssrLoadModule("/planning/planningCode.ts");
  const { MotionViewDocumentSerializer } = await server.ssrLoadModule("/app/persistence/MotionViewDocumentSerializer.ts");
  const defaults = normalize();
  const motion = (type, side) => ({ id: type, type, ...(side ? { lockedDriveSide: side } : {}) });
  const route = (types, start = {}, target = {}) => [
    { x: 0, y: 0, theta: 0, forwards: true, lead: 0.6, motions: types.map(t => typeof t === "string" ? motion(t) : t), ...start },
    { x: 24, y: 24, theta: 90, ...target },
  ];
  const run = (waypoints, configuration = defaults, previous) => simulate({ waypoints, configuration }, previous);
  for (const library of ["lemlib", "ez-template"]) {
    const configuration = preset(library, defaults);
    for (const type of ["forward", "rotate", "swing", "boomerang"]) {
      // Start Straight aligned for this arrival check; off-axis approaches can
      // retain a cross-track offset once close-range steering stops.
      const result = run(route([type], type === "forward" ? { theta: 45 } : {}), configuration);
      assert.equal(result.complete, true, `${library} ${type}`);
      assert.equal(result.sections[0].outcome, "reached");
      assert.ok(result.duration > 0 && result.duration < 10);
      const samples = result.sections[0].samples;
      assert.ok(samples.every(s => Object.values(s).every(Number.isFinite)));
      assert.ok(samples.every((s, i) => i === 0 || s.time >= samples[i - 1].time));
      assert.ok(samples.every((s, i) => i === 0 || s.distance >= samples[i - 1].distance));
      if (type === "rotate") assert.ok(samples.every(s => s.x === 0 && s.y === 0 && s.distance === 0));
      if (type === "forward") assert.ok(Math.abs(samples.at(-1).theta - Math.PI / 2) > 0.2, "Straight does not impose the target heading");
      assert.ok(Math.abs(samples.at(-1).linearVelocity) < 0.05, "terminal coast reaches rest");
    }
    const left = run(route([motion("swing", "left")]), configuration).sections[0].samples.at(-1);
    const right = run(route([motion("swing", "right")]), configuration).sections[0].samples.at(-1);
    assert.ok(left.x < 0 && right.x > 0 && left.y < 0 && right.y > 0, "held side changes the pivot trajectory");
    for (const type of ["forward", "boomerang"]) {
      const end = run(route([type], { theta: 180, forwards: false }, { theta: 270 }), configuration).sections[0].samples.at(-1);
      assert.ok(end.x > 20 && end.y > 20, `${library} reversed ${type} approaches the target`);
    }
    const wrapped = run(route(["rotate"], { theta: 359 }, { x: 0, y: 0, theta: 1 }), configuration);
    assert.ok(wrapped.sections[0].samples.every(s => Math.abs(s.theta - 359 * Math.PI / 180) < 0.1), "turn takes the short route across zero");
  }

  const ordered = run(route(["forward", "rotate"], { theta: 45 }));
  const reversed = run(route(["rotate", "forward"], { theta: 45 }));
  assert.notDeepEqual(ordered.sections[0].samples, reversed.sections[0].samples);
  const turnStart = ordered.sections[0].motions[1].startTime;
  const boundary = ordered.sections[0].samples.find(s => Math.abs(s.time - turnStart) < 1e-8);
  assert.ok(Math.abs(boundary.linearVelocity) > 0.1, "velocity carries into the following action");
  const stalledRoute = route(["boomerang"], { lead: 1 }, { x: 0, y: 30, theta: 0 });
  stalledRoute[1].motions = [motion("forward")];
  stalledRoute.push({ x: 0, y: 50, theta: 0 });
  const stalled = run(stalledRoute);
  assert.equal(stalled.sections[0].outcome, "stalled");
  assert.equal(stalled.sections[0].samples.at(-1).y, 0);
  assert.equal(stalled.sections[1].samples[0].y, 0, "next section begins at the actual missed pose");
  assert.ok(stalled.sections[1].samples.at(-1).y > 49);

  const chain = route(["forward"]);
  chain[1].motions = [motion("boomerang")]; chain.push({ x: 48, y: 30, theta: 90 });
  const initial = run(chain);
  const edited = structuredClone(chain); edited[1].lead = 0.4;
  const updated = run(edited, defaults, initial);
  assert.equal(updated.sections[0], initial.sections[0], "unchanged prefix is reused");
  assert.notEqual(updated.sections[1], initial.sections[1]);
  assert.deepEqual(updated, run(edited), "cached suffix matches a fresh simulation");
  const earlierEdit = structuredClone(chain); earlierEdit[0].theta = 45;
  const recomputed = run(earlierEdit, defaults, initial);
  assert.notEqual(recomputed.sections[0], initial.sections[0]);
  assert.notEqual(recomputed.sections[1], initial.sections[1]);
  assert.deepEqual(run([...chain, { x: 50, y: 40 }], defaults, initial), run([...chain, { x: 50, y: 40 }]), "appending invalidates a former terminal coast");

  const incomplete = run(route(["rotate"]), normalize({ angularPID: { kP: -2.5 } }));
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.sections[0].outcome, "incomplete", "a numerical limit does not invent a successful finish");
  assert.ok(incomplete.duration <= 120.01);
  const responsive = changes => run(route(["forward"], {}, { x: 0, y: 60, theta: 0 }), normalize(changes)).duration;
  assert.ok(responsive({ motorWatts: 22 }) > responsive({ motorWatts: 66 }));
  assert.ok(responsive({ robotWeightPounds: 25 }) > responsive({ robotWeightPounds: 10 }));
  assert.ok(responsive({ maxSpeedInchesPerSecond: 30 }) > responsive({ maxSpeedInchesPerSecond: 60 }));
  const unsupportedInternals = normalize({ timeStepSeconds: 0.05, maxDurationSeconds: 0.01, settlingDistance: 200 });
  assert.deepEqual(unsupportedInternals, defaults, "hidden physical and stop assumptions cannot be overridden through imports");
  const seeded = preset("ez-template", normalize({ angularPID: { kP: 4, kD: 12 } }));
  assert.equal(seeded.turnPID.kP, 4); assert.equal(seeded.boomerangSteeringPID.kD, 12);
  const tuned = normalize({ turnPID: { kP: 7 } }, seeded);
  assert.equal(preset("ez-template", preset("lemlib", tuned)).turnPID.kP, 7, "independent gains survive preset changes");

  const planning = new PlanningFeature();
  planning.load({ "planned-segment-export": true, "planned-path": route([motion("swing", "right")]),
    "planned-boomerang-configuration": { motorWatts: 55, angularPID: { kP: 4 }, settlingDistance: 100 } });
  assert.equal(planning.simulationConfiguration.motorWatts, 55);
  assert.equal(planning.simulationConfiguration.angularPID.kP, 4);
  assert.ok(!Object.hasOwn(planning.simulationConfiguration, "settlingDistance"));
  const oldCode = generatePlanningCode(planning);
  planning.setSimulationConfiguration({ robotWeightPounds: 20 });
  const pathA = planning.paths.activeId; planning.paths.add();
  assert.equal(planning.history.undo(), true); // undo new path
  planning.paths.add(); planning.paths.select(pathA);
  assert.equal(planning.simulationConfiguration.robotWeightPounds, 20);
  planning.paths.mirror("left-right");
  assert.equal(planning.route.waypoints[0].motions[0].lockedDriveSide, "left");
  planning.paths.mirror("top-bottom");
  assert.equal(planning.route.waypoints[0].motions[0].lockedDriveSide, "right");
  planning.history.undo(); planning.history.undo();
  assert.equal(generatePlanningCode(planning), oldCode);
  const selection = new PlanningMotionSelection(planning.route.waypoints[0].motions, planning.motionTemplates);
  selection.toggle("forward"); selection.swap(); selection.setLockedDriveSide("swing", "left");
  assert.equal(selection.result.find(m => m.type === "swing").lockedDriveSide, "left");
  const history = new PlanningFeature();
  const origin = history.paths.activeId; const other = history.paths.add();
  history.paths.select(origin); history.setSimulationConfiguration({ motorWatts: 44 }); history.paths.select(other);
  assert.equal(history.history.undo(), true); assert.equal(history.paths.activeId, origin);
  assert.equal(history.simulationConfiguration.motorWatts, 66);
  assert.equal(history.history.redo(), true); assert.equal(history.simulationConfiguration.motorWatts, 44);
  const serializer = new MotionViewDocumentSerializer({ planning, viewing: { data: { poses: [], watches: [], logs: [], waypoints: [] } }, version: "test" });
  for (const data of [serializer.exportPayload("planning", "Simulation", {}), JSON.parse(serializer.savedPaths())]) {
    assert.ok(data["planned-simulation-configuration"]);
    assert.ok(!Object.hasOwn(data, "planned-boomerang-configuration"));
    const restored = new PlanningFeature(); restored.load(data);
    assert.deepEqual(restored.simulationConfiguration, planning.simulationConfiguration);
    assert.deepEqual(restored.paths.items, planning.paths.items);
  }

  await playbackTests(planning, route, PlanningTimelineView);
  await workerTests(PlanningFeature, route, simulate);
  const fixtures = JSON.parse(await readFile(new URL("./fixtures/planning_recorded_motions.json", import.meta.url)));
  const robot = normalize({ trackWidth: 10.75, horizontalDrift: 2, lateralPID: { kP: 11.75, kD: 8 }, angularPID: { kP: 3.5, kD: 20 } });
  assert.equal(fixtures.length, 6, "duplicate viewing exports are one run");
  for (const fixture of fixtures) {
    const prediction = run(route(["boomerang"], { ...fixture.start, lead: fixture.lead, forwards: fixture.forwards }, fixture.target), robot);
    const section = prediction.sections[0];
    if (fixture.lead === 1) { assert.equal(section.outcome, "stalled"); assert.ok(section.samples.at(-1).x < -3); }
    else if (fixture.target.x === 24) assert.ok(Math.hypot(section.samples.at(-1).x - fixture.end.x, section.samples.at(-1).y - fixture.end.y) < 2);
    assert.ok(section.samples.every(s => Number.isFinite(s.theta)));
  }
}

async function playbackTests(planning, route, Timeline) {
  const oldRAF = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  let frame;
  globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
  globalThis.cancelAnimationFrame = () => { frame = null; };
  try {
    planning.load({ "planned-segment-export": true, "planned-path": route(["rotate"]) });
    assert.equal(planning.projection.totalLength, 0);
    assert.ok(planning.playback.duration > 0);
    planning.playback.play(); frame(1000); frame(1100);
    near(planning.playback.time, 0.1); assert.equal(planning.playback.distance, 0);
    planning.playback.setRate(2); frame(1200); near(planning.playback.time, 0.3);
    planning.playback.pause();
    const total = planning.playback.duration;
    const fake = { planning }, layout = { waypointX: [20, 200] };
    near(Timeline.prototype.xForTime.call(fake, total / 2, layout), 110);
    near(Timeline.prototype.timeForX.call(fake, 110, layout), total / 2);
    planning.playback.setTime(total);
    assert.equal(planning.playback.pose.x, 0, "predicted pose never teleports to the requested XY");
    planning.playback.inspectWaypoint(1); assert.equal(planning.playback.pose.x, 24, "target inspection remains exact");
    planning.playback.play(); assert.equal(planning.playback.pose.x, 0); planning.playback.pause();
  } finally {
    if (oldRAF) globalThis.requestAnimationFrame = oldRAF; else delete globalThis.requestAnimationFrame;
    if (oldCancel) globalThis.cancelAnimationFrame = oldCancel; else delete globalThis.cancelAnimationFrame;
  }
}

async function workerTests(PlanningFeature, route, simulate) {
  const oldWorker = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); this.posts = 0; }
    postMessage(message) { this.message = structuredClone(message); this.posts++; }
    terminate() { this.terminated = true; }
    finish() {
      this.previous = simulate(this.message.request, this.previous ?? this.message.previous);
      this.onmessage({ data: { result: this.previous } });
    }
  };
  try {
    const planning = new PlanningFeature();
    planning.load({ "planned-segment-export": true, "planned-path": route(["forward"]) });
    assert.equal(planning.projection.pending, true);
    const worker = workers.at(-1);
    assert.equal(worker.posts, 1, "the visual preview starts immediately without a debounce");
    planning.route.updateField(1, "y", 40);
    assert.equal(planning.projection.pending, true);
    assert.ok(!worker.terminated, "editing does not restart a busy worker");
    worker.finish();
    assert.equal(planning.projection.pending, true, "a stale non-drag result cannot commit playback");
    assert.equal(worker.posts, 2);
    assert.equal(worker.message.request.waypoints[1].y, 40);
    worker.finish();
    assert.equal(planning.projection.pending, false);
    assert.ok(planning.playback.duration > 0);
    assert.equal(workers.length, 1, "completed requests reuse one worker");
    const duration = planning.playback.duration;
    planning.route.updateMotions(0, [{ id: "forward", type: "forward", overrideCode: "opaque();" }]);
    assert.equal(planning.projection.pending, false, "code edits do not alter the selected motion simulation");
    assert.equal(planning.playback.duration, duration);
    assert.equal(worker.posts, 2);
    planning.route.updateField(1, "y", 41);
    worker.onerror();
    assert.equal(planning.projection.pending, false);
    assert.equal(planning.projection.error, "Preview unavailable");
    worker.finish();
    assert.equal(planning.projection.error, "Preview unavailable", "a failed worker cannot replace its result later");

    const dragged = new PlanningFeature();
    dragged.load({ "planned-segment-export": true, "planned-path": route(["boomerang"]) });
    const liveWorker = workers.at(-1);
    liveWorker.finish();
    for (const [name, edit, checkHandle] of [
      ["waypoint", () => dragged.route.updateField(1, "x", 30), () => assert.equal(dragged.route.waypoints[1].x, 30)],
      ["theta", () => dragged.route.updateField(1, "theta", 45), () => assert.ok(dragged.projection.segments[0].leadAxis.y < -0.7)],
      ["lead", () => dragged.route.updateLead(0, 0.4), () => assert.equal(dragged.projection.segments[0].lead, 0.4)],
    ]) {
      const before = dragged.projection.simulation;
      const oldVisual = dragged.projection.segments[0].samples;
      const oldDuration = dragged.playback.duration;
      const playbackPose = dragged.projection.sampleTime(oldDuration / 2);
      const distancePose = dragged.projection.sample(10);
      const posts = liveWorker.posts;
      dragged.history.begin("route");
      edit(); checkHandle();
      assert.equal(dragged.route.isEditing, true);
      assert.equal(dragged.projection.simulation, before, `${name} drag retains playback`);
      assert.equal(liveWorker.posts, posts + 1, `${name} change immediately requests a visual preview`);
      liveWorker.finish();
      assert.equal(dragged.route.isEditing, true);
      assert.notDeepEqual(dragged.projection.segments[0].samples, oldVisual, `${name} visual path updates before release`);
      assert.equal(dragged.projection.simulation, before, `${name} visual update does not change playback`);
      assert.equal(dragged.playback.duration, oldDuration);
      assert.deepEqual(dragged.projection.sampleTime(oldDuration / 2), playbackPose);
      assert.deepEqual(dragged.projection.sample(10), distancePose, "distance sampling also uses committed playback");
      const visual = dragged.projection.visualSimulation;
      dragged.history.commit();
      assert.equal(dragged.route.isEditing, false);
      assert.equal(dragged.projection.simulation, visual, "release commits the newest visual result to playback");
      assert.equal(dragged.projection.pending, false);
      assert.equal(liveWorker.posts, posts + 1, "release reuses an already computed visual result");
    }

    const beforeQueue = dragged.projection.simulation, posts = liveWorker.posts;
    dragged.history.begin("route");
    for (const x of [35, 36, 37]) {
      dragged.route.updateField(1, "x", x);
      void dragged.projection.visualSimulation;
    }
    assert.equal(liveWorker.posts, posts + 1, "only one request runs at a time");
    liveWorker.finish();
    assert.notEqual(dragged.projection.visualSimulation, beforeQueue, "ongoing movement still displays successive completed previews");
    assert.equal(dragged.projection.simulation, beforeQueue);
    assert.equal(liveWorker.posts, posts + 2);
    assert.equal(liveWorker.message.request.waypoints[1].x, 37, "queued pointer moves coalesce to the newest input");
    liveWorker.finish();
    dragged.history.commit();
    assert.equal(dragged.projection.simulation, dragged.projection.visualSimulation);

    const accepted = dragged.projection.simulation, count = liveWorker.posts;
    const originalX = dragged.route.waypoints[1].x;
    void dragged.projection.segments;
    dragged.history.begin("route");
    dragged.route.updateField(1, "x", 50);
    void dragged.projection.visualSimulation;
    liveWorker.finish();
    assert.notEqual(dragged.projection.visualSimulation, accepted);
    dragged.history.cancel();
    assert.equal(dragged.route.waypoints[1].x, originalX);
    assert.equal(dragged.projection.segments[0].end.x, originalX);
    assert.equal(dragged.projection.simulation, accepted);
    assert.equal(dragged.projection.visualSimulation, accepted, "cancelling restores the original visual and playback paths");
    assert.equal(liveWorker.posts, count + 1, "cancelling does not recompute an accepted path");

    dragged.history.begin("route");
    dragged.route.updateField(1, "x", 60); void dragged.projection.visualSimulation;
    dragged.route.updateField(1, "x", 61); void dragged.projection.visualSimulation;
    const cancellingPosts = liveWorker.posts;
    dragged.history.cancel();
    liveWorker.finish();
    assert.equal(dragged.projection.visualSimulation, accepted, "late drag results cannot replace a cancelled preview");
    assert.equal(liveWorker.posts, cancellingPosts, "cancelling discards the queued update");

    dragged.route.updateField(1, "y", 35);
    dragged.history.begin("route");
    liveWorker.finish();
    assert.equal(dragged.projection.simulation, accepted, "grabbing a handle freezes playback even with an outstanding request");
    dragged.history.commit();
    assert.equal(dragged.projection.pending, false);
    assert.equal(dragged.projection.simulation, dragged.projection.visualSimulation);
  } finally { if (oldWorker) globalThis.Worker = oldWorker; else delete globalThis.Worker; }
}

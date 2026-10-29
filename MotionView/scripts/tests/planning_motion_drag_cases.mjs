import assert from "node:assert/strict";

// Exercise the registered pointer handlers without a browser/native DragEvent API.
class TestElement {
  listeners = new Map();
  dataset = {};
  style = {};
  children = [];
  parent = null;
  captured = new Set();
  classes = new Set();
  animations = [];
  classList = {
    add: (...names) => names.forEach((name) => this.classes.add(name)),
    remove: (...names) => names.forEach((name) => this.classes.delete(name)),
  };
  bounds = { top: 0, bottom: 26, width: 180, height: 26 };

  constructor(tag = "div") { this.tag = tag; }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type, values = {}) {
    const event = {
      target: this, button: 0, pointerId: 1, isPrimary: true,
      clientX: 0, clientY: 0, detail: 1, prevented: false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() {},
      ...values,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  setAttribute() {}
  removeAttribute() {}
  before() {}
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  appendChild(child) { child.parent = this; this.children.push(child); }
  replaceChildren() { this.children = []; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  cloneNode() { return new TestElement(); }
  getBoundingClientRect() { return this.bounds; }
  animate(keyframes, options) { this.animations.push({ keyframes, options }); }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) {
    this.captured.delete(id);
    this.emit("lostpointercapture", { pointerId: id });
  }
  matches(selector) {
    if (selector === "button") return this.tag === "button";
    if (selector.startsWith(".")) return this.className === selector.slice(1);
    const key = {
      "[data-motion-id]": "motionId", "[data-motion-type]": "motionType",
      "[data-motion-timeline]": "motionTimeline",
    }[selector];
    return key != null && Object.hasOwn(this.dataset, key);
  }
  closest(selector) {
    return selector.split(", ").some((part) => this.matches(part)) ? this : this.parent?.closest(selector) ?? null;
  }
  contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
}

export async function runPlanningMotionDragTests(server) {
  const original = Object.fromEntries(["window", "document", "Element", "requestAnimationFrame"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = new TestElement();
  const body = new TestElement();
  let hit = null;
  Object.assign(globalThis, {
    window, Element: TestElement,
    document: { body, createElement: (tag) => new TestElement(tag), elementFromPoint: () => hit },
  });
  try {
    await runVerticalReorderAnimationTests(server, window);
    const { PlanningMotionEditorView } = await server.ssrLoadModule("/planning/render/PlanningMotionEditorView.ts");
    const dom = Object.fromEntries([
      "templateCode", "motionPreview", "templateModal", "templateIndicatorPicker", "templateConfirm", "templateDescription",
    ].map((key) => [key, new TestElement()]));
    const view = new PlanningMotionEditorView(dom);
    // Rendering is independently verified in the UI; keep geometry stable here.
    let renderedPositions;
    view.render = (positions) => { renderedPositions = positions; };
    view.bind();
    const templates = { forward: "move(@x);", rotate: "turn(@th);", swing: "swing(@th);", boomerang: "pose(@x,@y);" };
    const bank = new TestElement();
    bank.dataset.motionType = "rotate";
    const timeline = new TestElement();
    timeline.dataset.motionTimeline = "";
    timeline.bounds = { top: 0, bottom: 134, width: 400, height: 134 };
    dom.motionPreview.append(bank, timeline);
    const rows = () => {
      timeline.replaceChildren();
      view.result.motions.forEach((motion, index) => {
        const row = new TestElement();
        row.dataset.motionId = motion.id;
        row.bounds = { top: 10 + index * 30, bottom: 36 + index * 30, width: 400, height: 26 };
        timeline.appendChild(row);
      });
      hit = timeline;
    };
    const drag = (source, y = 130, destination = timeline) => {
      rows();
      dom.motionPreview.emit("pointerdown", { target: source });
      hit = destination;
      window.emit("pointermove", { clientX: 240, clientY: y });
      assert.equal(dom.motionPreview.hasPointerCapture(1), true);
      window.emit("pointerup", { clientX: 240, clientY: y });
      assert.equal(dom.motionPreview.hasPointerCapture(1), false);
      assert.equal(body.children.length, 0, "drag ghost is removed on release");
    };

    view.open({ mode: "waypoint", templates, motions: [] });
    // A click, right-click, or movement below the threshold must not add a motion.
    dom.motionPreview.emit("pointerdown", { target: bank });
    window.emit("pointermove", { clientX: 2, clientY: 1 });
    window.emit("pointerup");
    dom.motionPreview.emit("pointerdown", { target: bank, button: 2 });
    window.emit("pointermove", { clientX: 240, clientY: 130 });
    window.emit("pointerup");
    assert.equal(view.result.motions.length, 0);

    drag(bank);
    assert.equal(view.result.motions[0].type, "rotate", "bank drops work without HTML drag events");
    assert.equal(dom.motionPreview.emit("click").prevented, true, "release must not also click a row");
    bank.dataset.motionType = "forward";
    drag(bank, 0);
    assert.deepEqual(view.result.motions.map((motion) => motion.type), ["forward", "rotate"]);
    assert.equal(renderedPositions.get(view.result.motions[1].id), 10, "inserting captures surviving rows before rendering");
    drag(bank, 130, null);
    assert.equal(view.result.motions.length, 2, "dropping outside does not add a motion");

    const edited = { id: "edited", type: "forward", overrideCode: "custom(@x);\nwait();" };
    view.open({ mode: "waypoint", templates, motions: [edited, { id: "turn", type: "rotate" }, { id: "swing", type: "swing" }, { id: "pose", type: "boomerang" }] });
    rows();
    dom.motionPreview.emit("pointerdown", { target: bank });
    window.emit("pointermove", { clientX: 240, clientY: 130 });
    window.emit("pointerup");
    assert.equal(view.result.motions.length, 4, "full bank is disabled");
    drag(timeline.children[0]);
    assert.deepEqual(view.result.motions.map((motion) => motion.id), ["turn", "swing", "pose", "edited"]);
    assert.equal(renderedPositions.get("edited"), 10, "drag reorders capture each motion's old visual position");
    assert.equal(view.result.motions[3].overrideCode, edited.overrideCode, "reordering at capacity keeps edited code attached");
    rows();
    drag(timeline.children[3], 0);
    assert.equal(view.result.motions[0].id, "edited");

    const before = structuredClone(view.result);
    for (const cancel of ["pointercancel", "blur", "keydown"]) {
      rows();
      dom.motionPreview.emit("pointerdown", { target: timeline.children[0] });
      window.emit("pointermove", { clientX: 240, clientY: 130 });
      window.emit("pointerup", { pointerId: 2, clientY: 130 });
      assert.equal(body.children.length, 1, "unrelated pointers cannot finish the drag");
      window.emit(cancel, { key: "Escape" });
      window.emit("pointerup", { clientY: 130 });
      assert.equal(body.children.length, 0);
      assert.equal(dom.motionPreview.hasPointerCapture(1), false);
      assert.deepEqual(view.result, before, `${cancel} cancels without changing motions`);
    }
    assert.equal(dom.motionPreview.emit("dragstart").prevented, true, "native file-drop handling is bypassed");
    view.close();
  } finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

async function runVerticalReorderAnimationTests(server, window) {
  const { captureVerticalPositions, animateVerticalReorder } = await server.ssrLoadModule("/planning/render/verticalReorderAnimation.ts");
  let reducedMotion = false;
  const frames = [];
  window.matchMedia = () => ({ matches: reducedMotion });
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);
  for (const idKey of ["motionId", "methodId"]) {
    const row = (id, top) => {
      const item = new TestElement();
      item.dataset[idKey] = id;
      item.bounds.top = top;
      return item;
    };
    const positions = captureVerticalPositions([row("first", 10), row("second", 40), row("still", 70)], idKey);
    let items = [];
    animateVerticalReorder(() => items, idKey, positions);
    assert.equal(frames.length, 1, "animation waits for the new layout");
    items = [row("second", 10), row("first", 40), row("still", 70.2), row("new", 100)];
    frames.shift()();
    assert.deepEqual(items[0].animations, [{
      keyframes: [{ transform: "translateY(30px)" }, { transform: "translateY(0)" }],
      options: { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    }]);
    assert.equal(items[1].animations[0].keyframes[0].transform, "translateY(-30px)");
    assert.equal(items[2].animations.length, 0, "unchanged rows do not animate");
    assert.equal(items[3].animations.length, 0, "new rows have no prior position");
    reducedMotion = true;
    animateVerticalReorder(() => items, idKey, positions);
    assert.equal(frames.length, 0, "reduced-motion preference skips animation");
    reducedMotion = false;
  }
}

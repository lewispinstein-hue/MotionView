import assert from "node:assert/strict";

export async function runSettingsTelemetryTests(server) {
  const { SettingsTelemetry } = await server.ssrLoadModule(
    "/telemetry/settingsTelemetry.ts",
  );
  const { TelemetrySettingsBinding } = await server.ssrLoadModule(
    "/app/settings/bindings/TelemetrySettingsBinding.ts",
  );
  const { ViewingSettingsBinding } = await server.ssrLoadModule(
    "/app/settings/bindings/ViewingSettingsBinding.ts",
  );
  const { LiveProject } = await server.ssrLoadModule("/live/LiveProject.ts");
  const { LiveEvents } = await server.ssrLoadModule("/live/LiveEvents.ts");

  const captured = [];
  const client = {
    capture: async (name, properties, options) => {
      captured.push({ name, properties, options });
      return true;
    },
  };
  const telemetry = new SettingsTelemetry(client);
  await telemetry.fieldImageLoaded("custom-field-image");
  await telemetry.robotImageUploaded("image/png", 1200);
  await telemetry.customFieldImageUploaded("image/jpeg", 2400);
  await telemetry.unitsChanged("cm");
  await telemetry.speedNormalizationChanged(10, 100);
  assert.deepEqual(
    captured.map(({ name }) => name),
    [
      "field_image_loaded",
      "robot_image_uploaded",
      "custom_field_image_uploaded",
      "settings_units_changed",
      "settings_speed_normalization_changed",
    ],
  );
  assert.deepEqual(captured[1].properties, {
    image_type: "image/png",
    image_bytes: 1200,
  });
  assert.deepEqual(captured[4].properties, {
    min_speed: 10,
    max_speed: 100,
  });

  function input(value) {
    const listeners = new Map();
    return {
      value,
      addEventListener: (type, callback) => listeners.set(type, callback),
      fire: (type) => listeners.get(type)?.(),
    };
  }
  const units = input("in");
  const sidebarUnits = input("in");
  const minimumSpeed = input("0");
  const maximumSpeed = input("127");
  const settings = {
    current: { units: "in", minSpeed: "0", maxSpeed: "127" },
    changed: { subscribe() {} },
    update(patch) { this.current = { ...this.current, ...patch }; },
  };
  const dom = {
    units, sidebarUnits, minimumSpeed, maximumSpeed,
    offsetX: input("0"), offsetY: input("0"), offsetTheta: input("0"),
  };
  const viewingBinding = new ViewingSettingsBinding(settings, {}, dom, telemetry);
  viewingBinding.bind();
  captured.length = 0;
  sidebarUnits.value = "tiles";
  sidebarUnits.fire("input");
  sidebarUnits.fire("change");
  minimumSpeed.value = "15";
  minimumSpeed.fire("input");
  minimumSpeed.fire("change");
  assert.deepEqual(captured.map(({ name, properties }) => ({ name, properties })), [
    { name: "settings_units_changed", properties: { units: "tiles" } },
    { name: "settings_speed_normalization_changed", properties: { min_speed: 15, max_speed: 127 } },
  ]);

  let onSettingsChanged;
  const preferenceSteps = [];
  const preferenceClient = {
    capture: async (name, properties, options) => {
      preferenceSteps.push({ name, properties, options });
      return true;
    },
    setEnabled: (enabled) => preferenceSteps.push({ enabled }),
  };
  const binding = new TelemetrySettingsBinding(
    { changed: { subscribe: (callback) => { onSettingsChanged = callback; } } },
    preferenceClient,
    { telemetryEnabled: { checked: true, addEventListener() {} } },
  );
  binding.bind();
  onSettingsChanged({
    settings: { telemetryEnabled: false },
    keys: ["telemetryEnabled"],
    source: "user",
  });
  assert.deepEqual(preferenceSteps, [
    {
      name: "telemetry_preference_changed",
      properties: { telemetry_enabled: false },
      options: { explicitUserAction: true },
    },
    { enabled: false },
  ]);

  async function discover(ready, response, expectedReason, expectedStatus) {
    captured.length = 0;
    const bridge = {
      waitUntilReady: async () => ready,
      get: async () => response,
    };
    const project = new LiveProject(bridge, new LiveEvents(), telemetry);
    const candidates = await project.discover();
    assert.deepEqual(candidates, response?.json?.candidates && !expectedReason
      ? response.json.candidates : []);
    const failures = captured.filter(({ name }) => name === "pros_project_auto_detect_failed");
    assert.equal(failures.length, expectedReason ? 1 : 0);
    if (expectedReason) {
      assert.deepEqual(failures[0].properties, {
        reason: expectedReason,
        ...(expectedStatus ? { http_status: expectedStatus } : {}),
      });
      assert.equal(JSON.stringify(failures).includes("/private/project"), false);
    }
  }

  await discover(false, null, "bridge_unavailable");
  await discover(true, { ok: false, status: 0, json: null }, "bridge_unavailable");
  await discover(true, { ok: false, status: 503, json: { status: "/private/project" } }, "request_failed", 503);
  await discover(true, { ok: true, status: 200, json: { ok: false, status: "/private/project" } }, "bridge_error");
  await discover(true, { ok: true, status: 200, json: { ok: true } }, "invalid_response");
  await discover(true, { ok: true, status: 200, json: { ok: true, candidates: [] } });
  await discover(true, { ok: true, status: 200, json: { ok: true, candidates: ["/private/project"] } });

  captured.length = 0;
  const thrownProject = new LiveProject({
    waitUntilReady: async () => true,
    get: async () => { throw new Error("/private/project"); },
  }, new LiveEvents(), telemetry);
  assert.deepEqual(await thrownProject.discover(), []);
  assert.deepEqual(captured[0].properties, { reason: "request_failed" });
}

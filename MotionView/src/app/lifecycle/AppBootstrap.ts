import type { MotionViewApp } from "../MotionViewApp";
import type { FieldRenderer } from "../../render/field";
import type { TopBarView } from "../topBar";
import type { FieldSettingsBinding, LayoutSettingsBinding, LiveSettingsBinding, PlanningSettingsBinding, TelemetrySettingsBinding, ViewingSettingsBinding } from "../settings";
import type { SessionPersistence } from "../persistence";
import type { RouteImportService } from "../import";
import type { ViewingLayoutView } from "../../viewing/render/ViewingLayoutView";

export class AppBootstrap {
  constructor(
    private readonly app: MotionViewApp, private readonly field: FieldRenderer, private readonly topBar: TopBarView,
    private readonly fieldSettings: FieldSettingsBinding, private readonly viewingSettings: ViewingSettingsBinding,
    private readonly planningSettings: PlanningSettingsBinding, private readonly liveSettings: LiveSettingsBinding,
    private readonly layoutSettings: LayoutSettingsBinding, private readonly telemetrySettings: TelemetrySettingsBinding,
    private readonly persistence: SessionPersistence,
    private readonly importer: RouteImportService, private readonly viewingLayout: ViewingLayoutView,
  ) {}
  async start(): Promise<void> {
    await this.app.settings.load();
    this.fieldSettings.bind(); this.viewingSettings.bind(); this.planningSettings.bind(); this.liveSettings.bind();
    this.telemetrySettings.bind();
    await this.fieldSettings.applyAll(); this.viewingSettings.applyAll(); this.planningSettings.applyAll(); this.liveSettings.applyAll(); this.layoutSettings.apply(); this.telemetrySettings.applyAll();
    const appStartup = this.app.start();
    void this.app.live.initialize(); const restored = await this.persistence.restore(); if (!restored) await this.importer.loadDemoIfUpgraded();
    this.app.core.mode.setMode("viewing"); this.field.updateFieldLayout(restored); this.viewingLayout.activate(); this.topBar.render(); this.field.loadRobotImage();
    await appStartup;
    await this.app.markReady({ plan_saved: this.app.planning.route.length > 0, plan_points: this.app.planning.route.length });
  }
}

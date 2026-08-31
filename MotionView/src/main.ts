// @ts-nocheck
import demoRouteUrl from "./assets/demo/getting-started-route.json?url";
import { initializeMotionViewApp } from "./app/appRuntime";
import { HelpDom, HelpView } from "./app/help";
import { AppCommands, AppInput } from "./app/input";
import { RouteImportService } from "./app/import";
import { AppBootstrap, AppShutdown } from "./app/lifecycle";
import { ModeCoordinator } from "./app/ModeCoordinator";
import { MotionViewDocumentSerializer, SessionPersistence } from "./app/persistence";
import { ExportDialog, ExportDom, ExportService } from "./app/export";
import { RouteInfoDom, RouteInfoView } from "./app/routeInfo";
import {
  FieldSettingsBinding,
  LayoutSettingsBinding,
  LiveSettingsBinding,
  PlanningSettingsBinding,
  SettingsDom,
  SettingsView,
  ViewingSettingsBinding,
} from "./app/settings";
import { TopBarDom, TopBarView } from "./app/topBar";
import { WindowController } from "./app/window";
import { installGlobalErrorReporting } from "./app/globalErrors";
import { requiredElement } from "./dom/elements";
import { LiveDom, LiveInput, LiveView } from "./live";
import {
  PlanningCodeExportDialog,
  PlanningDialogs,
  PlanningDom,
  PlanningInput,
  PlanningView,
} from "./planning";
import { PlanningLayoutView } from "./planning/render/PlanningLayoutView";
import { FieldRenderer } from "./render/field";
import {
  configureRenderScheduler,
  registerPlanningRenderLayer,
  registerViewingRenderLayer,
} from "./render/renderScheduler";
import { ViewingDom, ViewingInput, ViewingView } from "./viewing";
import { ViewingLayoutView } from "./viewing/render/ViewingLayoutView";

const app = initializeMotionViewApp();
installGlobalErrorReporting(app.core.bridge);

const fieldRenderer = new FieldRenderer(requiredElement("c", HTMLCanvasElement, document));
fieldRenderer.bindInput();

const topBar = new TopBarView(app, fieldRenderer, TopBarDom.from());

const planningDom = PlanningDom.from();
const planningDialogs = new PlanningDialogs(planningDom);
const planningCodeExportDialog = new PlanningCodeExportDialog(app.planning, planningDom);
const planningView = new PlanningView(app.planning, fieldRenderer, planningDom, planningDialogs);
const planningInput = new PlanningInput(app.planning, fieldRenderer, planningDialogs);

const viewingView = new ViewingView(app.viewing, fieldRenderer, ViewingDom.from());
const viewingInput = new ViewingInput(app.viewing, viewingView);
const liveView = new LiveView(app.live, LiveDom.from());
const liveInput = new LiveInput(app.live);

const planningLayout = new PlanningLayoutView(fieldRenderer, planningView);
const viewingLayout = new ViewingLayoutView(fieldRenderer, viewingView);

const settingsDom = SettingsDom.from();
const settingsView = new SettingsView(fieldRenderer, settingsDom);
const fieldSettings = new FieldSettingsBinding(app.settings, fieldRenderer, topBar, settingsDom);
const viewingSettings = new ViewingSettingsBinding(app.settings, app.viewing, settingsDom);
const planningSettings = new PlanningSettingsBinding(app.settings, app.planning, fieldRenderer, planningCodeExportDialog, settingsDom);
const liveSettings = new LiveSettingsBinding(app.settings, app.live);
const layoutSettings = new LayoutSettingsBinding(app.settings, planningLayout, viewingLayout);

const serializer = new MotionViewDocumentSerializer(app);
const helpView = new HelpView(app, HelpDom.from(), serializer);
const persistence = new SessionPersistence(app, serializer);
const importer = new RouteImportService(app, planningDialogs, topBar, demoRouteUrl);
const exportDialog = new ExportDialog(app, ExportDom.from(), new ExportService(app, serializer));
const routeInfoView = new RouteInfoView(app, RouteInfoDom.from());

const appCommands = new AppCommands(app, fieldRenderer, topBar, planningDialogs, planningLayout, viewingLayout);
const appInput = new AppInput(appCommands);
const modeCoordinator = new ModeCoordinator(app, fieldRenderer, planningLayout, viewingLayout);
const windowController = new WindowController();
const shutdown = new AppShutdown(app, fieldRenderer, persistence);
const bootstrap = new AppBootstrap(
  app,
  fieldRenderer,
  topBar,
  fieldSettings,
  viewingSettings,
  planningSettings,
  liveSettings,
  layoutSettings,
  persistence,
  importer,
  viewingLayout,
);

configureRenderScheduler({ drawField: () => fieldRenderer.draw() });
fieldRenderer.registerPlanningLayer(planningView);
fieldRenderer.registerViewingLayer(viewingView.fieldLayer);
registerPlanningRenderLayer(planningView);
registerViewingRenderLayer(viewingView.timelineLayer);

planningDialogs.bind();
planningCodeExportDialog.bind();
planningView.bind();
planningInput.bind();
viewingView.bind();
viewingInput.bind();
liveView.bind();
liveInput.bind();
planningLayout.bind();
viewingLayout.bind();
settingsView.bind();
topBar.bind();
helpView.bind();
exportDialog.bind();
routeInfoView.bind();
appCommands.bind();
appInput.bind();
modeCoordinator.bind();
windowController.bind();
persistence.bind();

planningLayout.changed.subscribe(() => layoutSettings.capture());
viewingLayout.changed.subscribe(() => layoutSettings.capture());
settingsView.robotImageRequested.subscribe(() => topBar.openRobotImagePicker());
app.live.events.projectChanged.subscribe(() => {
  planningCodeExportDialog.setProjectPath(app.live.project.valid ? app.live.project.path : "");
});

topBar.events.actionRequested.subscribe((action) => {
  if (action.kind === "file-selected") void importer.openFile(action.file, action.input);
  else if (action.kind === "robot-image-selected") void fieldSettings.handleRobotImageFile(action.file, action.input);
  else if (action.kind === "clear-requested") void (action.clearAll ? appCommands.clearAll() : appCommands.clearCurrent());
  else if (action.kind === "settings-requested") {
    if (app.live.project.path && !app.live.project.valid) void app.live.project.validate();
    settingsView.open();
  } else if (action.kind === "help-requested") helpView.open();
});

planningView.render();
viewingView.render();
void shutdown.bind();
await bootstrap.start();

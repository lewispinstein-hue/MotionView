import { optionalElement, requiredElement } from "../../dom/elements";

export class SettingsDom {
  readonly modal: HTMLElement;
  readonly closeButton: HTMLButtonElement;
  readonly uploadRobotImageButton: HTMLButtonElement;
  readonly robotImageToggle: HTMLInputElement;
  readonly robotImageControls: HTMLElement;
  readonly sidebarRobotImageControls: HTMLElement | null;
  readonly units: HTMLSelectElement;
  readonly sidebarUnits: HTMLSelectElement | null;
  readonly fieldCompetition: HTMLSelectElement;
  readonly showPreviousYears: HTMLInputElement;
  readonly fieldRotation: HTMLSelectElement;
  readonly robotWidth: HTMLInputElement;
  readonly robotHeight: HTMLInputElement;
  readonly offsetX: HTMLInputElement;
  readonly offsetY: HTMLInputElement;
  readonly offsetTheta: HTMLInputElement;
  readonly minimumSpeed: HTMLInputElement;
  readonly maximumSpeed: HTMLInputElement;
  readonly planMoveStep: HTMLInputElement;
  readonly planSnapStep: HTMLSelectElement;
  readonly planThetaSnapStep: HTMLSelectElement;
  readonly planLimitBounds: HTMLInputElement;
  readonly planSnapStepLabel: HTMLElement | null;
  readonly planMoveStepLabel: HTMLElement | null;
  readonly robotImageScale: HTMLInputElement;
  readonly robotImageOffsetX: HTMLInputElement;
  readonly robotImageOffsetY: HTMLInputElement;
  readonly robotImageRotation: HTMLInputElement;
  readonly robotImageAlpha: HTMLInputElement;
  readonly sidebarRobotImageScale: HTMLInputElement | null;
  readonly sidebarRobotImageOffsetX: HTMLInputElement | null;
  readonly sidebarRobotImageOffsetY: HTMLInputElement | null;
  readonly sidebarRobotImageRotation: HTMLInputElement | null;
  readonly sidebarRobotImageAlpha: HTMLInputElement | null;

  private constructor(document: Document) {
    this.modal = requiredElement("settingsModal", HTMLElement, document);
    this.closeButton = requiredElement("btnSettingsClose", HTMLButtonElement, document);
    this.uploadRobotImageButton = requiredElement("btnUploadRobotImage", HTMLButtonElement, document);
    this.robotImageToggle = requiredElement("robotImageToggle", HTMLInputElement, document);
    this.robotImageControls = requiredElement("settingsRobotImgControls", HTMLElement, document);
    this.sidebarRobotImageControls = optionalElement("robotImgControls", HTMLElement, document);
    this.units = requiredElement("settingsUnitsSelect", HTMLSelectElement, document);
    this.sidebarUnits = optionalElement("unitsSelect", HTMLSelectElement, document);
    this.fieldCompetition = requiredElement("settingsFieldCompetition", HTMLSelectElement, document);
    this.showPreviousYears = requiredElement("settingsShowPreviousYearFields", HTMLInputElement, document);
    this.fieldRotation = requiredElement("settingsFieldRotation", HTMLSelectElement, document);
    this.robotWidth = requiredElement("settingsRobotW", HTMLInputElement, document);
    this.robotHeight = requiredElement("settingsRobotH", HTMLInputElement, document);
    this.offsetX = requiredElement("settingsOffX", HTMLInputElement, document);
    this.offsetY = requiredElement("settingsOffY", HTMLInputElement, document);
    this.offsetTheta = requiredElement("settingsOffTheta", HTMLInputElement, document);
    this.minimumSpeed = requiredElement("settingsMinSpeed", HTMLInputElement, document);
    this.maximumSpeed = requiredElement("settingsMaxSpeed", HTMLInputElement, document);
    this.planMoveStep = requiredElement("settingsPlanMoveStep", HTMLInputElement, document);
    this.planSnapStep = requiredElement("settingsPlanSnapStep", HTMLSelectElement, document);
    this.planThetaSnapStep = requiredElement("settingsPlanThetaSnapStep", HTMLSelectElement, document);
    this.planLimitBounds = requiredElement("settingsPlanLimitBounds", HTMLInputElement, document);
    this.planSnapStepLabel = optionalElement("settingsPlanSnapStepLabel", HTMLElement, document);
    this.planMoveStepLabel = optionalElement("settingsPlanMoveStepLabel", HTMLElement, document);
    this.robotImageScale = requiredElement("settingsRobotImgScale", HTMLInputElement, document);
    this.robotImageOffsetX = requiredElement("settingsRobotImgOffX", HTMLInputElement, document);
    this.robotImageOffsetY = requiredElement("settingsRobotImgOffY", HTMLInputElement, document);
    this.robotImageRotation = requiredElement("settingsRobotImgRot", HTMLInputElement, document);
    this.robotImageAlpha = requiredElement("settingsRobotImgAlpha", HTMLInputElement, document);
    this.sidebarRobotImageScale = optionalElement("robotImgScale", HTMLInputElement, document);
    this.sidebarRobotImageOffsetX = optionalElement("robotImgOffX", HTMLInputElement, document);
    this.sidebarRobotImageOffsetY = optionalElement("robotImgOffY", HTMLInputElement, document);
    this.sidebarRobotImageRotation = optionalElement("robotImgRot", HTMLInputElement, document);
    this.sidebarRobotImageAlpha = optionalElement("robotImgAlpha", HTMLInputElement, document);
  }

  static from(documentRoot: Document = document): SettingsDom { return new SettingsDom(documentRoot); }
}

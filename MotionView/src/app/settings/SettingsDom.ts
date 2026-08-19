import { requiredElement } from "../../dom/elements";

export class SettingsDom {
  readonly modal: HTMLElement;
  readonly closeButton: HTMLButtonElement;
  readonly uploadRobotImageButton: HTMLButtonElement;
  readonly robotImageToggle: HTMLInputElement;
  readonly robotImageControls: HTMLElement;

  private constructor(document: Document) {
    this.modal = requiredElement("settingsModal", HTMLElement, document);
    this.closeButton = requiredElement("btnSettingsClose", HTMLButtonElement, document);
    this.uploadRobotImageButton = requiredElement("btnUploadRobotImage", HTMLButtonElement, document);
    this.robotImageToggle = requiredElement("robotImageToggle", HTMLInputElement, document);
    this.robotImageControls = requiredElement("settingsRobotImgControls", HTMLElement, document);
  }

  static from(document: Document): SettingsDom { return new SettingsDom(document); }
}

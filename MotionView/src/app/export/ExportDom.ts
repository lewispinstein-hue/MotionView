import { requiredElement } from "../../dom/elements";
export class ExportDom {
  readonly open: HTMLButtonElement; readonly modal: HTMLElement; readonly close: HTMLButtonElement; readonly cancel: HTMLButtonElement; readonly confirm: HTMLButtonElement;
  readonly pathName: HTMLInputElement; readonly filename: HTMLInputElement; readonly filenameHint: HTMLElement; readonly location: HTMLSelectElement; readonly type: HTMLSelectElement; readonly customWrap: HTMLElement; readonly customPath: HTMLInputElement; readonly customHint: HTMLElement; readonly validation: HTMLElement; readonly success: HTMLElement;
  private constructor(document: Document) {
    this.open = requiredElement("btnExport", HTMLButtonElement, document); this.modal = requiredElement("exportModal", HTMLElement, document); this.close = requiredElement("btnExportClose", HTMLButtonElement, document); this.cancel = requiredElement("btnExportCancel", HTMLButtonElement, document); this.confirm = requiredElement("btnExportConfirm", HTMLButtonElement, document);
    this.pathName = requiredElement("exportPathName", HTMLInputElement, document); this.filename = requiredElement("exportFilename", HTMLInputElement, document); this.filenameHint = requiredElement("exportFilenameHint", HTMLElement, document); this.location = requiredElement("exportLocation", HTMLSelectElement, document); this.type = requiredElement("exportTypes", HTMLSelectElement, document); this.customWrap = requiredElement("exportCustomPathWrap", HTMLElement, document); this.customPath = requiredElement("exportCustomPath", HTMLInputElement, document); this.customHint = requiredElement("exportCustomPathHint", HTMLElement, document); this.validation = requiredElement("exportValidationMessage", HTMLElement, document); this.success = requiredElement("exportSuccessMessage", HTMLElement, document);
  }
  static from(documentRoot: Document = document): ExportDom { return new ExportDom(documentRoot); }
}

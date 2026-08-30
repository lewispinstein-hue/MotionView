import { requiredElement } from "../../dom/elements";
export class RouteInfoDom {
  readonly open: HTMLButtonElement; readonly modal: HTMLElement; readonly close: HTMLButtonElement; readonly list: HTMLElement; readonly apply: HTMLButtonElement;
  private constructor(document: Document) { this.open = requiredElement("btnRouteInfo", HTMLButtonElement, document); this.modal = requiredElement("routeInfoModal", HTMLElement, document); this.close = requiredElement("btnRouteInfoClose", HTMLButtonElement, document); this.list = requiredElement("routeInfoList", HTMLElement, document); this.apply = requiredElement("btnApplyRunSettings", HTMLButtonElement, document); }
  static from(document: Document): RouteInfoDom { return new RouteInfoDom(document); }
}

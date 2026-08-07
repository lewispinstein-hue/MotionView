export interface PlanningSidebarRendererDependencies {
  planListEl: HTMLElement | null;
  planCountEl: HTMLElement | null;
  planObjectListEl: HTMLElement | null;
  planEventsHintEl: HTMLElement | null;
  getPlanWaypoints(): ReadonlyArray<any>;
  getPlanObjects(): ReadonlyArray<any>;
  isPlanWaypointSelected(index: number): boolean;
  getSelectedNode(): any;
  getEditingObjectId(): string | null;
  getPlanOpenColorPickerObjectId(): string | null;
  getPlanObjectEditSelectAll(): boolean;
  planThetaDegAt(index: number): number;
  readPlanSpeed(value: unknown, fallback?: number): number;
  fmtNum(value: unknown, decimals?: number): string;
  escapeHtml(value: unknown): string;
  svgIconHref(iconId: string): string;
  getDefaultPlanObjectName(index?: number): string;
  getDefaultPlanObjectColor(index?: number): string;
  getPlanObjectLatestValue(object: any): string;
  planToggleSelection(index: number): void;
  planSelectSingle(index: number): void;
  requestDrawAll(): void;
  renderPlanList(): void;
  updatePlanSelectionPanel(): void;
  commitPlanObjectNameEdit(objectId: string, nextName: string): void;
  cancelPlanObjectNameEdit(): void;
  startPlanObjectNameEdit(objectId: string, selectAll?: boolean): void;
  attachPlanMethodCardDragHandlers(card: HTMLElement): void;
  openPlanMethodEditModal(objectId: string, methodId: string): void;
}

export interface PlanningSidebarRenderer {
  renderPlanList(): void;
  renderPlanObjects(): void;
}

export function createPlanningSidebarRenderer(deps: PlanningSidebarRendererDependencies): PlanningSidebarRenderer {
  function renderPlanList() {
    if (!deps.planListEl) return;
    const planWaypoints = deps.getPlanWaypoints();
    deps.planListEl.innerHTML = "";
    if (deps.planCountEl) deps.planCountEl.textContent = `${planWaypoints.length}`;
    for (let i = 0; i < planWaypoints.length; i += 1) {
      const point = planWaypoints[i];
      const item = document.createElement("div");
      item.className = `planItem${deps.isPlanWaypointSelected(i) ? " selected" : ""}`;
      item.dataset.idx = String(i);
      const theta = deps.planThetaDegAt(i);
      item.innerHTML = `
        <div class="muted">#${i + 1}</div>
        <div>X: ${deps.fmtNum(point.x, 2)}  Y: ${deps.fmtNum(point.y, 2)}  θ: ${deps.fmtNum(theta, 1)}°  S: ${deps.fmtNum(deps.readPlanSpeed(point.speed, 127), 0)}</div>
      `;
      item.addEventListener("click", (event) => {
        if (event.shiftKey) deps.planToggleSelection(i);
        else deps.planSelectSingle(i);
        deps.requestDrawAll();
        deps.renderPlanList();
        deps.updatePlanSelectionPanel();
      });
      deps.planListEl.appendChild(item);
    }
  }

  function renderPlanObjects() {
    if (!deps.planObjectListEl) return;
    const planObjects = deps.getPlanObjects();
    const selectedNode = deps.getSelectedNode();
    const highlightedObjectId = selectedNode?.objectId || "";
    const highlightedMethodId = selectedNode?.methodId || "";
    const editingObjectId = deps.getEditingObjectId();
    const openColorPickerObjectId = deps.getPlanOpenColorPickerObjectId();

    deps.planObjectListEl.innerHTML = "";

    if (deps.planEventsHintEl) {
      deps.planEventsHintEl.textContent = planObjects.length
        ? "Double-click an object name to rename it."
        : "Add an object to define reusable method groups for this route.";
    }

    for (let i = 0; i < planObjects.length; i += 1) {
      const object = planObjects[i];
      const card = document.createElement("article");
      card.className = "planObjectCard";
      card.dataset.objectId = object.id;
      if (object.id === highlightedObjectId) card.classList.add("isHighlighted");

      const header = document.createElement("div");
      header.className = "planObjectHeader";

      const meta = document.createElement("div");
      meta.className = "planObjectMeta";

      if (editingObjectId === object.id) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "planObjectNameEditor";
        input.value = object.name;
        input.placeholder = "Object name";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.dataset.objectId = object.id;

        input.addEventListener("blur", () => {
          deps.commitPlanObjectNameEdit(object.id, input.value);
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            deps.commitPlanObjectNameEdit(object.id, input.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            deps.cancelPlanObjectNameEdit();
          }
        });
        meta.appendChild(input);
      } else {
        const name = document.createElement("div");
        name.className = "planObjectName";
        name.textContent = object.name || deps.getDefaultPlanObjectName(i);
        name.addEventListener("dblclick", () => {
          deps.startPlanObjectNameEdit(object.id, true);
        });
        meta.appendChild(name);
      }

      const subtle = document.createElement("div");
      subtle.className = "planObjectSubtle";
      subtle.textContent = `${object.methods.length} method${object.methods.length === 1 ? "" : "s"}`;
      meta.appendChild(subtle);
      header.appendChild(meta);

      const latest = document.createElement("div");
      latest.className = "planObjectLatest";
      latest.innerHTML = `
        <span class="planObjectLatestLabel">Latest</span>
        <span class="planObjectLatestValue">${deps.escapeHtml(deps.getPlanObjectLatestValue(object))}</span>
      `;
      header.appendChild(latest);
      card.appendChild(header);

      const methodList = document.createElement("div");
      methodList.className = "planMethodList";
      if (!object.methods.length) {
        const empty = document.createElement("div");
        empty.className = "planMethodEmpty";
        empty.textContent = "No methods yet.";
        methodList.appendChild(empty);
      } else {
        for (const [methodIndex, method] of object.methods.entries()) {
          const methodCard = document.createElement("div");
          methodCard.className = "planMethodCard";
          if (object.id === highlightedObjectId && method.id === highlightedMethodId) methodCard.classList.add("isHighlighted");
          methodCard.draggable = false;
          methodCard.dataset.objectId = object.id;
          methodCard.dataset.methodId = method.id;
          methodCard.innerHTML = `
            <div class="planMethodGrip" aria-hidden="true">⋮⋮</div>
            <div class="planMethodIndex">${methodIndex + 1}</div>
            <div class="planMethodContent">
              <div class="planMethodName">${deps.escapeHtml(method.name || "")}</div>
              <div class="planMethodCode">${deps.escapeHtml(method.code || "")}</div>
            </div>
            <button class="iconBtn planMethodRemoveBtn" type="button" title="Remove Method" aria-label="Remove Method" data-object-id="${deps.escapeHtml(object.id)}" data-method-id="${deps.escapeHtml(method.id)}">
              <svg width="30" height="30" aria-hidden="true">
                <use href="${deps.svgIconHref("icon-removePlanningObject")}"></use>
              </svg>
            </button>
          `;
          deps.attachPlanMethodCardDragHandlers(methodCard);
          methodCard.addEventListener("dblclick", (event) => {
            const removeButton = event.target instanceof Element ? event.target.closest(".planMethodRemoveBtn") : null;
            if (removeButton) return;
            deps.openPlanMethodEditModal(object.id, method.id);
          });
          methodList.appendChild(methodCard);
        }
      }
      card.appendChild(methodList);

      const actions = document.createElement("div");
      actions.className = "planObjectActions";
      actions.innerHTML = `
        <button class="iconBtn secondaryBtn planMethodAddBtn" type="button" title="Add Method" aria-label="Add Method" data-object-id="${deps.escapeHtml(object.id)}">Add Method</button>
        <div class="planObjectActionTools">
          <div class="planObjectColorWrap">
            <button class="iconBtn secondaryBtn planObjectColorBtn" type="button" title="Change Object Color" aria-label="Change Object Color" data-object-id="${deps.escapeHtml(object.id)}" style="color:${deps.escapeHtml(object.color || deps.getDefaultPlanObjectColor(i))}">
              <svg width="30" height="30" aria-hidden="true">
                <use href="${deps.svgIconHref("icon-planningChangeObjectColor")}"></use>
              </svg>
            </button>
            <div class="planObjectColorPopover"${openColorPickerObjectId === object.id ? "" : " hidden"}>
              <input class="planObjectColorInput" type="color" value="${deps.escapeHtml(object.color || deps.getDefaultPlanObjectColor(i))}" aria-label="Object color" data-object-id="${deps.escapeHtml(object.id)}" />
            </div>
          </div>
        </div>
        <button class="iconBtn secondaryBtn planObjectRemoveActionBtn" type="button" title="Remove Object" aria-label="Remove Object" data-object-id="${deps.escapeHtml(object.id)}">
          <svg width="30" height="30" aria-hidden="true">
            <use href="${deps.svgIconHref("icon-removePlanningObject")}"></use>
          </svg>
        </button>
      `;
      card.appendChild(actions);
      deps.planObjectListEl.appendChild(card);

      if (editingObjectId === object.id) {
        const input = card.querySelector<HTMLInputElement>(".planObjectNameEditor");
        if (input) {
          requestAnimationFrame(() => {
            input.focus();
            if (deps.getPlanObjectEditSelectAll()) input.select();
            else input.setSelectionRange(input.value.length, input.value.length);
          });
        }
      }
    }
  }

  return {
    renderPlanList,
    renderPlanObjects,
  };
}

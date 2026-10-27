import { setStatus } from "../../app/status";
import type { PlanningDialogs } from "../PlanningDialogs";
import type { PlanningDom } from "../PlanningDom";
import type { PlanningFeature } from "../PlanningFeature";

/** Fixed field-corner control for switching and maintaining Planning paths. */
export class PlanningPathManagerView {
  #open = false;
  #editingPathId: string | null = null;
  #bound = false;

  constructor(
    private readonly planning: PlanningFeature,
    private readonly dom: PlanningDom,
    private readonly dialogs: PlanningDialogs,
  ) {}

  bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.dom.pathManagerToggle.addEventListener("click", () => {
      this.#open = !this.#open;
      this.render();
    });
    this.dom.createPath.addEventListener("click", () => {
      this.planning.paths.add();
    });
    this.dom.mirrorLeftRight.addEventListener("click", () =>
      this.mirror("left-right"),
    );
    this.dom.mirrorTopBottom.addEventListener("click", () =>
      this.mirror("top-bottom"),
    );
  }

  render(): void {
    const active = this.planning.paths.active;
    this.dom.activePathName.textContent = active.name;
    this.dom.pathManager.classList.toggle("isOpen", this.#open);
    this.dom.pathManagerToggle.title = this.#open ? "Close paths" : "Open paths";
    this.dom.pathManagerToggle.setAttribute("aria-label", this.dom.pathManagerToggle.title);
    this.dom.pathManagerToggle.setAttribute("aria-expanded", String(this.#open));
    this.dom.pathManagerBody.setAttribute("aria-hidden", String(!this.#open));
    this.dom.pathManagerBody.inert = !this.#open;
    this.dom.pathList.replaceChildren();
    const canMirror = active.waypoints.length > 0;
    this.dom.mirrorLeftRight.disabled = !canMirror;
    this.dom.mirrorTopBottom.disabled = !canMirror;

    const paths = this.planning.paths.items;
    this.dom.pathCount.textContent = `${paths.length} Path${paths.length === 1 ? "" : "s"}`;
    for (const path of paths) {
      const row = document.createElement("article");
      row.className = `planningPathManagerItem${path.id === active.id ? " isActive" : ""}`;
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-current", String(path.id === active.id));
      const details = document.createElement("div");
      details.className = "planningPathManagerItemDetails";
      if (this.#editingPathId === path.id) {
        const input = document.createElement("input");
        input.className = "planningPathManagerNameInput";
        input.value = path.name;
        input.setAttribute("aria-label", "Path name");
        input.addEventListener("click", (event) => event.stopPropagation());
        input.addEventListener("blur", () => this.commitPathName(path.id, input.value));
        input.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.key === "Enter") input.blur();
          else if (event.key === "Escape") {
            this.#editingPathId = null;
            this.render();
          }
        });
        details.appendChild(input);
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      } else {
        const name = document.createElement("div");
        name.className = "planningPathManagerItemName";
        name.textContent = path.name;
        name.addEventListener("dblclick", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.planning.paths.select(path.id);
          this.#editingPathId = path.id;
          this.render();
        });
        details.appendChild(name);
      }
      const meta = document.createElement("div");
      meta.className = "planningPathManagerItemMeta";
      const waypointCount = path.waypoints.length;
      const nodeCount = path.nodes.length;
      meta.textContent = `${waypointCount} Waypoint${waypointCount === 1 ? "" : "s"} • ${nodeCount} Node${nodeCount === 1 ? "" : "s"}`;
      details.appendChild(meta);

      const derive = document.createElement("button");
      derive.type = "button";
      derive.className = "planningPathManagerDerive";
      derive.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="./assets/svg/planning/copyCode.svg#icon-copyCode"></use></svg>`;
      derive.title = "Derive path";
      derive.setAttribute("aria-label", derive.title);
      derive.addEventListener("click", (event) => {
        event.stopPropagation();
        this.planning.paths.derive(path.id);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "planningPathManagerDelete";
      remove.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="./assets/svg/planning/removePlanningObject.svg#icon-removePlanningObject"></use></svg>`;
      remove.title = paths.length <= 1 ? "At least one path is required" : "Delete path";
      remove.setAttribute("aria-label", remove.title);
      remove.disabled = paths.length <= 1;
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.removePath(path.id);
      });

      const select = () => this.planning.paths.select(path.id);
      row.addEventListener("click", select);
      row.addEventListener("keydown", (event) => {
        if (event.target !== row) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      });
      row.append(details, derive, remove);
      this.dom.pathList.appendChild(row);
    }
  }

  private mirror(direction: "left-right" | "top-bottom"): void {
    this.planning.paths.mirror(direction, (point) =>
      this.planning.projection.constrain(point),
    );
  }

  private async removePath(id: string): Promise<void> {
    const path = this.planning.paths.items.find((entry) => entry.id === id);
    if (!path || this.planning.paths.items.length <= 1) return;
    const confirmed = await this.dialogs.confirm({
      title: "Delete Path",
      message: `Delete ${path.name}? This removes its waypoints, nodes, and path-specific export settings.`,
      confirmLabel: "Delete",
    });
    if (!confirmed || !this.planning.paths.remove(id)) return;
    setStatus(`Deleted path ${path.name}.`);
  }

  private commitPathName(id: string, value: string): void {
    this.#editingPathId = null;
    this.planning.paths.rename(id, value);
    this.render();
  }
}

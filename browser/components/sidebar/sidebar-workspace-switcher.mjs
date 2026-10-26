/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  classMap,
  html,
  nothing,
  repeat,
} from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

// eslint-disable-next-line import/no-unassigned-import
import "chrome://global/content/elements/panel-list.mjs";

const NO_CONTAINER_ICON = "chrome://browser/skin/tab.svg";
const MAX_COLLAPSED_BUTTONS = 4;

const SWIPE_EVENTS = [
  "MozSwipeGestureMayStart",
  "MozSwipeGestureStart",
  "MozSwipeGestureUpdate",
  "MozSwipeGestureEnd",
  "MozSwipeGesture",
];
const SWIPE_SETTLE_MS = 200;

// Wheel fallback, used where the native swipe tracker never starts.
const SWIPE_THRESHOLD_PX = 80;
// Wheel events further apart than this belong to different gestures.
const SWIPE_GESTURE_GAP_MS = 150;

/**
 * Bottom-of-sidebar switcher between container workspaces, shown with
 * vertical tabs. Horizontal trackpad swipes over the vertical tab strip also
 * switch workspaces, through the native swipe tracker behind the back/forward
 * swipe animation, which reports progress and drops momentum.
 */
export default class SidebarWorkspaceSwitcher extends MozLitElement {
  static properties = {
    expanded: { type: Boolean, reflect: true },
    workspaces: { type: Array, state: true },
    activeUserContextId: { type: Number, state: true },
    enabled: { type: Boolean, state: true },
  };

  #swipe = { accumulated: 0, lastTime: -Infinity, switched: false };
  #nativeSwipeSupported = false;
  #nativeSwipePending = false;
  #swipeActive = false;
  #swipeProgress = 0;
  #settleAnimation = null;
  #reducedMotionQuery = null;
  #verticalTabs = null;
  #workspaceColorClass = "";
  #expandedObserver = null;

  constructor() {
    super();
    this.expanded = false;
    this.workspaces = [];
    this.activeUserContextId = 0;
    this.enabled = false;
  }

  get controller() {
    return window.gBrowser?.containerWorkspaces;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("ContainerWorkspaceChanged", this);
    window.addEventListener("ContainerWorkspacesUpdated", this);

    let sidebarMain = this.closest("sidebar-main");
    if (sidebarMain) {
      this.#expandedObserver = new MutationObserver(() => {
        this.expanded = sidebarMain.hasAttribute("expanded");
      });
      this.#expandedObserver.observe(sidebarMain, {
        attributes: true,
        attributeFilter: ["expanded"],
      });
      this.expanded = sidebarMain.hasAttribute("expanded");
    }

    this.#reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );
    this.#reducedMotionQuery.addEventListener("change", this);

    this.#verticalTabs = document.getElementById("vertical-tabs");
    this.#verticalTabs?.addEventListener("wheel", this, {
      capture: true,
      passive: false,
    });
    // Native swipe events aren't composed and only reach system group
    // listeners, so they never get to #vertical-tabs from the scrollbox's
    // shadow tree.
    for (let type of SWIPE_EVENTS) {
      window.windowRoot.addEventListener(type, this, {
        capture: true,
        mozSystemGroup: true,
      });
    }

    this.refresh();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("ContainerWorkspaceChanged", this);
    window.removeEventListener("ContainerWorkspacesUpdated", this);
    this.#expandedObserver?.disconnect();
    this.#expandedObserver = null;
    this.#verticalTabs?.removeEventListener("wheel", this, { capture: true });
    for (let type of SWIPE_EVENTS) {
      window.windowRoot?.removeEventListener(type, this, {
        capture: true,
        mozSystemGroup: true,
      });
    }
    this.#resetSwipe();
    this.#reducedMotionQuery?.removeEventListener("change", this);
    this.#reducedMotionQuery = null;
    this.#setWorkspaceColor(null);
    this.#verticalTabs = null;
  }

  handleEvent(event) {
    switch (event.type) {
      case "ContainerWorkspaceChanged":
      case "ContainerWorkspacesUpdated":
        this.refresh();
        break;
      case "wheel":
        this.#onWheel(event);
        break;
      case "change":
        if (this.#reducedMotion) {
          this.#settleAnimation?.cancel();
          this.#setSwipeProgress(0);
        }
        break;
      case "MozSwipeGestureMayStart":
        this.#onSwipeMayStart(event);
        break;
      case "MozSwipeGestureStart":
      case "MozSwipeGestureUpdate":
      case "MozSwipeGesture":
      case "MozSwipeGestureEnd":
        if (
          (!this.#swipeActive && !this.#nativeSwipePending) ||
          !this.#isInVerticalTabs(event.originalTarget)
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.#onSwipe(event);
        break;
    }
  }

  get #reducedMotion() {
    return this.#reducedMotionQuery?.matches;
  }

  /**
   * The swipe direction that moves to the next workspace. Matches history
   * forward navigation, where DIRECTION_RIGHT means the fingers moved left.
   *
   * @param {SimpleGestureEvent} event
   */
  #forwardDirection(event) {
    return window.RTL_UI ? event.DIRECTION_LEFT : event.DIRECTION_RIGHT;
  }

  #backwardDirection(event) {
    return window.RTL_UI ? event.DIRECTION_RIGHT : event.DIRECTION_LEFT;
  }

  #isInVerticalTabs(node) {
    while (node) {
      if (node == this.#verticalTabs) {
        return true;
      }
      node = node.parentNode ?? node.host;
    }
    return false;
  }

  #onSwipeMayStart(event) {
    if (
      !this.enabled ||
      !this.#isInVerticalTabs(event.originalTarget) ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }
    event.stopPropagation();
    let index = this.workspaces.findIndex(
      w => w.userContextId == this.activeUserContextId
    );
    if (index < this.workspaces.length - 1) {
      event.allowedDirections |= this.#forwardDirection(event);
    }
    if (index > 0) {
      event.allowedDirections |= this.#backwardDirection(event);
    }
    if (event.allowedDirections) {
      event.preventDefault();
      this.#nativeSwipePending = true;
      // The wheel events of this gesture follow; keep them in one gesture.
      this.#swipe.lastTime = event.timeStamp;
      this.#settleAnimation?.cancel();
    }
  }

  #onSwipe(event) {
    if (!this.enabled) {
      this.#resetSwipe();
      return;
    }
    switch (event.type) {
      case "MozSwipeGestureStart":
        this.#nativeSwipeSupported = true;
        this.#nativeSwipePending = false;
        this.#swipeActive = true;
        this.#settleAnimation?.cancel();
        this.#setSwipeProgress(0);
        break;
      case "MozSwipeGestureUpdate":
        this.#setSwipeProgress(event.delta);
        break;
      case "MozSwipeGesture":
        this.#commitSwipe(event);
        break;
      case "MozSwipeGestureEnd":
        // Also ends a swipe interrupted by a new one, between that one's
        // MayStart and Start, so the pending state stays. It arrives right
        // after a commit too, so the settle animation stays.
        this.#swipeActive = false;
        this.#setSwipeProgress(0);
        break;
    }
  }

  #resetSwipe() {
    this.#swipeActive = false;
    this.#nativeSwipePending = false;
    this.#settleAnimation?.cancel();
    this.#settleAnimation = null;
    this.#setSwipeProgress(0);
  }

  /**
   * @param {number} progress
   *   Swipe progress from the native tracker, between -1 and 1. Positive
   *   values mean the fingers moved right.
   */
  #setSwipeProgress(progress) {
    this.#swipeProgress = progress;
    if (progress && !this.#reducedMotion) {
      this.#verticalTabs.setAttribute("workspace-swiping", "");
      this.#verticalTabs.style.setProperty(
        "--workspace-swipe-progress",
        String(progress)
      );
    } else {
      this.#verticalTabs?.removeAttribute("workspace-swiping");
      this.#verticalTabs?.style.removeProperty("--workspace-swipe-progress");
    }
  }

  #commitSwipe(event) {
    let step = event.direction == this.#forwardDirection(event) ? 1 : -1;
    let progress = this.#swipeProgress;
    this.#setSwipeProgress(0);
    if (!this.controller?.switchBy(step) || this.#reducedMotion) {
      return;
    }
    // The tracker stops at the commit point instead of animating to the end,
    // so the new workspace slides in from where the fingers left off.
    let fingersMovedLeft = event.direction == event.DIRECTION_RIGHT;
    let remaining = (1 - Math.abs(progress)) * 100;
    let from = fingersMovedLeft ? remaining : -remaining;
    this.#settleAnimation = window.gBrowser.tabContainer.animate(
      { translate: [`${from}% 0`, "0 0"] },
      { duration: SWIPE_SETTLE_MS, easing: "ease-out" }
    );
  }

  refresh() {
    let controller = this.controller;
    this.enabled = !!controller?.enabled;
    if (!this.enabled) {
      this.#resetSwipe();
    }
    this.workspaces = this.enabled ? [...controller.workspaces] : [];
    this.activeUserContextId = this.enabled
      ? controller.activeUserContextId
      : 0;
    this.#setWorkspaceColor(
      this.workspaces.find(w => w.userContextId == this.activeUserContextId)
    );
    this.hidden = !this.enabled;
  }

  #setWorkspaceColor(workspace) {
    let colorClass = workspace
      ? this.#colorClass(workspace) || "identity-color-gray"
      : "";
    if (colorClass == this.#workspaceColorClass) {
      return;
    }
    if (this.#workspaceColorClass) {
      this.#verticalTabs?.classList.remove(this.#workspaceColorClass);
    }
    if (colorClass) {
      this.#verticalTabs?.classList.add(colorClass);
    }
    this.#workspaceColorClass = colorClass;
  }

  #onWheel(event) {
    if (
      !this.enabled ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      Math.abs(event.deltaX) <= Math.abs(event.deltaY)
    ) {
      return;
    }
    // The tab strip's scrollbox would otherwise consume the event and keep
    // the native swipe tracker from starting.
    event.stopPropagation();
    let swipe = this.#swipe;
    let newGesture = event.timeStamp - swipe.lastTime > SWIPE_GESTURE_GAP_MS;
    swipe.lastTime = event.timeStamp;
    if (newGesture) {
      swipe.accumulated = 0;
      swipe.switched = false;
      // The tracker turned the last accepted swipe down; fall back to wheel.
      this.#nativeSwipePending = false;
    }
    if (
      this.#nativeSwipeSupported ||
      this.#nativeSwipePending ||
      event.deltaMode != event.DOM_DELTA_PIXEL
    ) {
      return;
    }
    event.preventDefault();

    if (swipe.switched) {
      return;
    }

    swipe.accumulated += event.deltaX;
    if (Math.abs(swipe.accumulated) < SWIPE_THRESHOLD_PX) {
      return;
    }
    swipe.switched = true;
    let direction = Math.sign(swipe.accumulated);
    if (window.RTL_UI) {
      direction = -direction;
    }
    this.controller.switchBy(direction);
  }

  #switchTo(userContextId) {
    if (userContextId != this.activeUserContextId) {
      this.controller?.switchTo(userContextId);
    }
  }

  #iconSrc(workspace) {
    return workspace.userContextId && workspace.icon
      ? `resource://usercontext-content/${workspace.icon}.svg`
      : NO_CONTAINER_ICON;
  }

  #colorClass(workspace) {
    return workspace.userContextId && workspace.color
      ? `identity-color-${workspace.color}`
      : "";
  }

  #visibleWorkspaces() {
    if (this.expanded || this.workspaces.length <= MAX_COLLAPSED_BUTTONS) {
      return { visible: this.workspaces, overflow: [] };
    }
    let visible = this.workspaces.slice(0, MAX_COLLAPSED_BUTTONS - 1);
    let active = this.workspaces.find(
      w => w.userContextId == this.activeUserContextId
    );
    if (active && !visible.includes(active)) {
      visible[visible.length - 1] = active;
    }
    let overflow = this.workspaces.filter(w => !visible.includes(w));
    return { visible, overflow };
  }

  buttonTemplate(workspace) {
    let isActive = workspace.userContextId == this.activeUserContextId;
    return html`<moz-button
      type="icon ghost"
      class=${classMap({
        "workspace-button": true,
        [this.#colorClass(workspace)]: !!this.#colorClass(workspace),
      })}
      data-usercontextid=${workspace.userContextId}
      .iconSrc=${this.#iconSrc(workspace)}
      .ariaPressed=${isActive ? "true" : "false"}
      data-l10n-id=${workspace.userContextId
        ? nothing
        : "sidebar-workspace-no-container"}
      title=${workspace.userContextId ? workspace.name : nothing}
      @click=${() => this.#switchTo(workspace.userContextId)}
    ></moz-button>`;
  }

  menuItemTemplate(workspace) {
    let iconClass =
      workspace.userContextId && workspace.icon
        ? `identity-icon-${workspace.icon}`
        : "no-container-icon";
    return html`<panel-item
      class=${`${iconClass} ${this.#colorClass(workspace)}`}
      data-usercontextid=${workspace.userContextId}
      data-l10n-id=${workspace.userContextId
        ? nothing
        : "sidebar-workspace-no-container-item"}
      @click=${() => this.#switchTo(workspace.userContextId)}
      >${workspace.userContextId ? workspace.name : nothing}</panel-item
    >`;
  }

  render() {
    if (!this.enabled) {
      return nothing;
    }
    let { visible, overflow } = this.#visibleWorkspaces();
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/usercontext/usercontext.css"
      />
      <link
        rel="stylesheet"
        href="chrome://browser/content/sidebar/sidebar-workspace-switcher.css"
      />
      <div
        class="workspaces"
        role="group"
        data-l10n-id="sidebar-workspace-switcher"
      >
        ${repeat(
          visible,
          w => w.userContextId,
          w => this.buttonTemplate(w)
        )}
        ${overflow.length
          ? html`<moz-button
                type="icon ghost"
                class="workspace-overflow-button"
                menuId="workspace-overflow-menu"
                iconSrc="chrome://global/skin/icons/more.svg"
                data-l10n-id="sidebar-workspace-overflow-button"
              ></moz-button>
              <panel-list id="workspace-overflow-menu">
                ${repeat(
                  overflow,
                  w => w.userContextId,
                  w => this.menuItemTemplate(w)
                )}
              </panel-list>`
          : nothing}
      </div>
    `;
  }
}

customElements.define("sidebar-workspace-switcher", SidebarWorkspaceSwitcher);

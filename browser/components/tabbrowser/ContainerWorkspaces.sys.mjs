/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  ContextualIdentityService:
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SessionStartup:
    "moz-src:///browser/components/sessionstore/SessionStartup.sys.mjs",
  SessionStore:
    "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
});

const WINDOW_VALUE = "activeContainerWorkspace";
const LAST_SELECTED_TAB_VALUE = "workspaceLastSelected";
const IDENTITY_TOPICS = [
  "contextual-identity-created",
  "contextual-identity-updated",
  "contextual-identity-deleted",
  "contextual-identity-reordered",
];
const TAB_EVENTS = [
  "SSTabRestoring",
  "TabOpen",
  "TabClose",
  "TabSelect",
  "TabShow",
  "TabHide",
  "TabAttrModified",
  "TabGrouped",
  "TabUngrouped",
  "TabGroupRemoved",
  "SplitViewCreated",
  "SplitViewRemoved",
  "SplitViewTabChange",
];

export class ContainerWorkspaces {
  #browser;
  #window;
  #ready = false;
  #enabled = false;
  #restoring = false;
  #switching = false;
  #filtered = false;
  #activeUserContextId = 0;
  #lastSelectedTabs = new Map();
  #orientationObserver;

  static prepareStartupURI(win, uri) {
    const extraOptions = win.arguments?.[1];
    const external =
      Array.isArray(uri) ||
      (extraOptions instanceof Ci.nsIPropertyBag2 &&
        extraOptions.hasKey("fromExternal") &&
        extraOptions.getPropertyAsBool("fromExternal"));
    if (
      !external ||
      win.arguments[5] != null ||
      win.arguments[11] ||
      !Services.prefs.getBoolPref("sidebar.verticalTabs", false) ||
      !Services.prefs.getBoolPref("privacy.userContext.enabled", false) ||
      Services.prefs.getBoolPref(
        "browser.link.force_default_user_context_id_for_external_opens",
        false
      ) ||
      lazy.PrivateBrowsingUtils.isWindowPrivate(win)
    ) {
      return uri;
    }
    return lazy.SessionStartup.onceInitialized.then(() => {
      if (win.closed) {
        return null;
      }
      let savedWindow = lazy.SessionStartup.willRestore()
        ? lazy.SessionStartup.state?.windows?.[0]
        : null;
      let id = Number(
        savedWindow?.extData?.[WINDOW_VALUE] ??
          savedWindow?.tabs?.[(savedWindow.selected || 1) - 1]?.userContextId ??
          0
      );
      if (
        !Number.isInteger(id) ||
        (id && !lazy.ContextualIdentityService.getPublicIdentityFromId(id))
      ) {
        id = 0;
      }
      win.arguments[5] = id;
      const browser = win.gBrowser;
      const initialTab = browser.selectedTab;
      if (
        initialTab.userContextId != id &&
        browser.tabs.length == 1 &&
        initialTab.linkedBrowser.currentURI.spec == "about:blank"
      ) {
        // Prepare the container before SessionStore snapshots command-line tabs.
        browser.selectedTab = browser.addTrustedTab("about:blank", {
          userContextId: id,
        });
        browser.removeTab(initialTab, { animate: false });
      }
      return uri;
    });
  }

  constructor(browser) {
    this.#browser = browser;
    this.#window = browser.documentGlobal;
  }

  init() {
    for (let type of TAB_EVENTS) {
      this.#window.addEventListener(type, this);
    }
    this.#window.addEventListener("SSWindowStateBusy", this);
    this.#window.addEventListener("SSWindowStateReady", this);
    for (let topic of IDENTITY_TOPICS) {
      Services.obs.addObserver(this, topic);
    }
    Services.obs.addObserver(this, "browser-delayed-startup-finished");
    Services.prefs.addObserver("privacy.userContext.enabled", this);
    this.#orientationObserver = new this.#window.MutationObserver(() =>
      this.#updateEnabled()
    );
    this.#orientationObserver.observe(this.#browser.tabContainer, {
      attributes: true,
      attributeFilter: ["orient"],
    });
    if (this.#window.gBrowserInit.delayedStartupFinished) {
      this.#ready = true;
      this.#restore();
    }
  }

  destroy() {
    this.#orientationObserver.disconnect();
    for (let type of TAB_EVENTS) {
      this.#window.removeEventListener(type, this);
    }
    this.#window.removeEventListener("SSWindowStateBusy", this);
    this.#window.removeEventListener("SSWindowStateReady", this);
    for (let topic of IDENTITY_TOPICS) {
      Services.obs.removeObserver(this, topic);
    }
    Services.obs.removeObserver(this, "browser-delayed-startup-finished");
    Services.prefs.removeObserver("privacy.userContext.enabled", this);
    this.#lastSelectedTabs.clear();
  }

  get enabled() {
    return this.#enabled;
  }

  get activeUserContextId() {
    return this.#activeUserContextId;
  }

  get workspaces() {
    return [
      ...lazy.ContextualIdentityService.getPublicIdentities().map(identity => ({
        ...identity,
        name: lazy.ContextualIdentityService.getUserContextLabel(
          identity.userContextId
        ),
      })),
      { userContextId: 0 },
    ];
  }

  canCombineTabs(tabs) {
    return (
      !this.enabled ||
      tabs.every(tab => tab.userContextId == tabs[0].userContextId)
    );
  }

  switchBy(direction) {
    let workspaces = this.workspaces;
    let index = workspaces.findIndex(
      workspace => workspace.userContextId == this.activeUserContextId
    );
    let target = workspaces[index + Math.sign(direction)];
    return target ? this.switchTo(target.userContextId) : false;
  }

  switchTo(userContextId) {
    if (!this.enabled || this.#restoring || this.#switching) {
      return false;
    }
    userContextId = this.#validateId(userContextId);
    let browser = this.#browser;
    let previousTab = browser.selectedTab;
    if (previousTab?.isOpen) {
      this.#rememberSelectedTab(previousTab);
    }
    let candidates = browser.tabs.filter(
      tab => tab.isOpen && !tab.hidden && tab.userContextId == userContextId
    );
    let target = this.#lastSelectedTabs.get(userContextId);
    if (!candidates.includes(target)) {
      target = candidates[0];
    }
    this.#switching = true;
    try {
      let previousUserContextId = this.activeUserContextId;
      this.#activeUserContextId = userContextId;
      browser.clearMultiSelectedTabs();
      target ??= browser.addTrustedTab(this.#window.BROWSER_NEW_TAB_URL, {
        userContextId,
      });
      this.refresh();
      browser.selectedTab = target;
      this.#rememberSelectedTab(target);
      this.refresh();
      this.#save();
      this.#notify(previousUserContextId);
    } finally {
      this.#switching = false;
    }
    return true;
  }

  onTabSelected(tab) {
    if (!this.enabled || this.#restoring || this.#switching) {
      return;
    }
    this.#rememberSelectedTab(tab);
    if (tab.userContextId == this.activeUserContextId) {
      return;
    }
    let previousUserContextId = this.activeUserContextId;
    this.#activeUserContextId = this.#validateId(tab.userContextId);
    this.#browser.clearMultiSelectedTabs();
    this.refresh();
    this.#save();
    this.#notify(previousUserContextId);
  }

  ensureReplacementTab(closingTab) {
    let browser = this.#browser;
    if (
      this.enabled &&
      closingTab.selected &&
      !browser.nonHiddenTabs.some(tab => tab != closingTab) &&
      browser.tabs.some(tab => tab != closingTab && tab.isOpen && !tab.hidden)
    ) {
      browser.addTrustedTab(this.#window.BROWSER_NEW_TAB_URL, {
        userContextId: this.activeUserContextId,
      });
    }
  }

  refresh() {
    if (!this.enabled && !this.#filtered) {
      return;
    }
    this.#filtered = this.enabled;
    let tabs = this.#browser.tabs;
    let visible = tab =>
      tab.userContextId == this.activeUserContextId ||
      !!tab.linkedBrowser._sharingState?.webRTC?.sharing;
    for (let tab of tabs) {
      let inWorkspace = tab.splitview
        ? tab.splitview.tabs.some(visible)
        : visible(tab);
      tab.toggleAttribute("workspace-hidden", this.enabled && !inWorkspace);
    }
    for (let container of [
      ...this.#browser.tabGroups,
      ...this.#browser.splitViews,
    ]) {
      container.toggleAttribute(
        "workspace-hidden",
        this.enabled &&
          !container.tabs.some(
            tab => tab.isOpen && !tab.hidden && !tab.workspaceHidden
          )
      );
    }
    for (let group of this.#browser.tabGroups) {
      group.updateWorkspaceVisibility();
    }
    this.#browser.tabContainer._invalidateCachedVisibleTabs();
  }

  handleEvent(event) {
    switch (event.type) {
      case "SSWindowStateBusy":
        this.#restoring = true;
        break;
      case "SSWindowStateReady":
        this.#restoring = false;
        if (this.#ready) {
          this.#restore();
        }
        break;
      case "SSTabRestoring":
        if (!this.#restoring) {
          this.#restoreTabSelection(event.target);
        }
        break;
      case "TabSelect":
        this.onTabSelected(event.target);
        break;
      case "TabAttrModified":
        if (event.detail.changed.includes("sharing")) {
          this.refresh();
        }
        break;
      case "TabClose":
        for (let [id, tab] of this.#lastSelectedTabs) {
          if (tab == event.target) {
            this.#lastSelectedTabs.delete(id);
          }
        }
        this.refresh();
        break;
      default:
        this.refresh();
    }
  }

  observe(subject, topic) {
    if (topic == "browser-delayed-startup-finished") {
      if (subject == this.#window) {
        this.#ready = true;
        this.#restore();
      }
      return;
    }
    if (topic == "nsPref:changed") {
      this.#updateEnabled();
      return;
    }
    if (this.enabled && this.#validateId(this.activeUserContextId) == 0) {
      if (this.activeUserContextId != 0) {
        this.switchTo(0);
      }
    }
    this.#notifyUpdated();
  }

  #validateId(id) {
    return this.workspaces.some(workspace => workspace.userContextId === id)
      ? id
      : 0;
  }

  #updateEnabled() {
    let enabled =
      this.#ready &&
      this.#browser.tabContainer.verticalMode &&
      Services.prefs.getBoolPref("privacy.userContext.enabled", false) &&
      !lazy.PrivateBrowsingUtils.isWindowPrivate(this.#window);
    if (enabled == this.enabled) {
      return;
    }
    this.#enabled = enabled;
    this.#browser.document.documentElement.toggleAttribute(
      "container-workspaces",
      enabled
    );
    if (enabled && !this.#restoring) {
      this.switchTo(this.#browser.selectedTab.userContextId);
    } else {
      this.refresh();
    }
    this.#notifyUpdated();
  }

  #rememberSelectedTab(tab) {
    let previous = this.#lastSelectedTabs.get(tab.userContextId);
    if (previous == tab) {
      return;
    }
    if (previous?.isOpen) {
      lazy.SessionStore.deleteCustomTabValue(previous, LAST_SELECTED_TAB_VALUE);
    }
    this.#lastSelectedTabs.set(tab.userContextId, tab);
    lazy.SessionStore.setCustomTabValue(tab, LAST_SELECTED_TAB_VALUE, "1");
  }

  #restoreTabSelection(tab) {
    if (
      lazy.SessionStore.getCustomTabValue(tab, LAST_SELECTED_TAB_VALUE) != "1"
    ) {
      return;
    }
    let previous = this.#lastSelectedTabs.get(tab.userContextId);
    if (previous?.isOpen && previous != tab) {
      if (!tab.selected) {
        lazy.SessionStore.deleteCustomTabValue(tab, LAST_SELECTED_TAB_VALUE);
        return;
      }
      lazy.SessionStore.deleteCustomTabValue(previous, LAST_SELECTED_TAB_VALUE);
    }
    this.#lastSelectedTabs.set(tab.userContextId, tab);
  }

  #restore() {
    this.#lastSelectedTabs.clear();
    for (let tab of this.#browser.tabs) {
      this.#restoreTabSelection(tab);
    }
    let value = lazy.SessionStore.getCustomWindowValue(
      this.#window,
      WINDOW_VALUE
    );
    let id =
      value === "" ? this.#browser.selectedTab.userContextId : Number(value);
    this.#updateEnabled();
    if (this.enabled) {
      this.switchTo(id);
    }
  }

  #save() {
    lazy.SessionStore.setCustomWindowValue(
      this.#window,
      WINDOW_VALUE,
      String(this.activeUserContextId)
    );
  }

  #notify(previousUserContextId) {
    this.#window.dispatchEvent(
      new this.#window.CustomEvent("ContainerWorkspaceChanged", {
        detail: {
          userContextId: this.activeUserContextId,
          previousUserContextId,
        },
      })
    );
  }

  #notifyUpdated() {
    this.#window.dispatchEvent(
      new this.#window.CustomEvent("ContainerWorkspacesUpdated")
    );
  }
}

/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { TabUnloader } = ChromeUtils.importESModule(
  "moz-src:///browser/components/tabbrowser/TabUnloader.sys.mjs"
);
const { sinon } = ChromeUtils.importESModule(
  "resource://testing-common/Sinon.sys.mjs"
);
const INACTIVE_PREF = "browser.tabs.unloadAfterInactiveMs";
const INACTIVE_MS = 12 * 60 * 60 * 1000;
const INACTIVE_URL =
  "https://example.com/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html";

add_setup(async function () {
  Assert.equal(
    Services.prefs.getDefaultBranch("").getIntPref(INACTIVE_PREF),
    INACTIVE_MS,
    "Scheduled unloading defaults to twelve hours"
  );
  Assert.ok(
    Services.prefs
      .getDefaultBranch("")
      .getBoolPref("browser.sessionstore.restore_pinned_tabs_on_demand"),
    "Background pinned tabs restore on demand by default"
  );
  await SpecialPowers.pushPrefEnv({
    set: [
      [INACTIVE_PREF, INACTIVE_MS],
      ["browser.tabs.unloadOnLowMemory", false],
      ["sidebar.verticalTabs", false],
      ["browser.tabs.splitView.enabled", true],
      ["dom.require_user_interaction_for_beforeunload", false],
    ],
  });
  TabUnloader.init();
});

function methodsFor(win, now) {
  return {
    getNow: () => now,
    *iterateTabs() {
      for (let tab of win.gBrowser.tabs) {
        yield { tab, gBrowser: win.gBrowser };
      }
    },
  };
}

async function withInactiveWindow(task, options = {}) {
  let win = await BrowserTestUtils.openNewBrowserWindow(options);
  try {
    await task(win, Date.now());
  } finally {
    await BrowserTestUtils.closeWindow(win);
  }
}

async function inactiveTab(win, now, age = INACTIVE_MS) {
  let selected = win.gBrowser.selectedTab;
  let tab = await BrowserTestUtils.openNewForegroundTab({
    gBrowser: win.gBrowser,
    url: INACTIVE_URL,
  });
  win.gBrowser.selectedTab = selected;
  tab.updateLastAccessed(now - age);
  return tab;
}

add_task(async function test_age_pinned_state_and_reload() {
  await withInactiveWindow(async (win, now) => {
    let browser = win.gBrowser;
    let old = await inactiveTab(win, now);
    let fresh = await inactiveTab(win, now, INACTIVE_MS - 1);
    let pinned = await inactiveTab(win, now, INACTIVE_MS + 1);
    browser.pinTab(pinned);
    let group = browser.addTabGroup([old, fresh]);
    SessionStore.setCustomTabValue(pinned, "workspaceLastSelected", "1");
    let order = [...browser.tabs];
    let count = Glean.browserEngagement.tabUnloadCount.testGetValue();
    Assert.equal(await TabUnloader.unloadInactiveTabs(methodsFor(win, now)), 2);
    Assert.ok(!old.linkedPanel, "Unload at the 12-hour boundary");
    Assert.ok(!pinned.linkedPanel, "Pinned tabs can also expire");
    Assert.ok(fresh.linkedPanel, "A tab just below the threshold stays loaded");
    Assert.ok(browser.selectedTab.linkedPanel, "Keep the selected tab loaded");
    Assert.deepEqual(browser.tabs, order, "Unloading preserves tab order");
    Assert.equal(old.group, group, "Unloading preserves group membership");
    Assert.ok(pinned.pinned, "Unloading preserves pinning");
    Assert.equal(
      SessionStore.getCustomTabValue(pinned, "workspaceLastSelected"),
      "1"
    );
    Assert.equal(
      Glean.browserEngagement.tabUnloadCount.testGetValue(),
      count,
      "Inactivity does not increment the low-memory counter"
    );
    let loaded = BrowserTestUtils.browserLoaded(
      old.linkedBrowser,
      false,
      INACTIVE_URL
    );
    browser.selectedTab = old;
    await loaded;
    Assert.ok(old.linkedPanel, "Selecting an unloaded tab reloads it");
    Assert.equal(old.linkedBrowser.currentURI.spec, INACTIVE_URL);
  });
});

add_task(async function test_protected_tabs() {
  await withInactiveWindow(async (win, now) => {
    let browser = win.gBrowser;
    let protectedTabs = [];
    for (let attribute of [
      "undiscardable",
      "soundplaying",
      "pictureinpicture",
    ]) {
      let tab = await inactiveTab(win, now);
      tab.setAttribute(attribute, "true");
      protectedTabs.push(tab);
    }
    let beforeUnload = await inactiveTab(win, now);
    await SpecialPowers.spawn(beforeUnload.linkedBrowser, [], () => {
      content.onbeforeunload = event => event.preventDefault();
    });
    let internal = await BrowserTestUtils.openNewForegroundTab({
      gBrowser: browser,
      url: "about:preferences",
    });
    browser.selectedTab = browser.tabs[0];
    internal.updateLastAccessed(now - INACTIVE_MS);
    protectedTabs.push(beforeUnload, internal);
    try {
      Assert.equal(
        await TabUnloader.unloadInactiveTabs(methodsFor(win, now)),
        0
      );
      Assert.ok(
        protectedTabs.every(tab => tab.linkedPanel),
        "Media, undiscardable, beforeunload and internal tabs stay loaded"
      );
    } finally {
      await SpecialPowers.spawn(beforeUnload.linkedBrowser, [], () => {
        content.onbeforeunload = null;
      });
      for (let tab of protectedTabs) {
        for (let attribute of [
          "undiscardable",
          "soundplaying",
          "pictureinpicture",
        ]) {
          tab.removeAttribute(attribute);
        }
      }
    }
  });
  await withInactiveWindow(
    async (win, now) => {
      let tab = await inactiveTab(win, now);
      Assert.equal(
        await TabUnloader.unloadInactiveTabs(methodsFor(win, now)),
        0
      );
      Assert.ok(tab.linkedPanel, "Private tabs stay loaded");
    },
    { private: true }
  );
});

add_task(async function test_active_split_view() {
  await withInactiveWindow(async (win, now) => {
    let browser = win.gBrowser;
    let first = await inactiveTab(win, now);
    let second = await inactiveTab(win, now);
    let split = browser.addTabSplitView([first, second]);
    browser.selectedTab = first;
    second.updateLastAccessed(now - INACTIVE_MS);
    Assert.ok(split.hasActiveTab);
    Assert.equal(await TabUnloader.unloadInactiveTabs(methodsFor(win, now)), 0);
    Assert.ok(second.linkedPanel, "The visible split partner is protected");
    browser.selectedTab = browser.tabs.find(tab => !tab.splitview);
    first.updateLastAccessed(now - INACTIVE_MS);
    second.updateLastAccessed(now - INACTIVE_MS);
    Assert.equal(await TabUnloader.unloadInactiveTabs(methodsFor(win, now)), 2);
    Assert.equal(first.splitview, split, "Unloading preserves the split view");
    split.unsplitTabs();
  });
});

add_task(async function test_recheck_after_flush_and_single_flight() {
  await withInactiveWindow(async (win, now) => {
    let browser = win.gBrowser;
    let tab = await inactiveTab(win, now);
    let sandbox = sinon.createSandbox();
    let entered = Promise.withResolvers();
    let resume = Promise.withResolvers();
    sandbox.stub(browser, "prepareDiscardBrowser").callsFake(async () => {
      entered.resolve();
      await resume.promise;
    });
    try {
      let pending = TabUnloader.unloadInactiveTabs(methodsFor(win, now));
      await entered.promise;
      Assert.equal(
        await TabUnloader.unloadInactiveTabs(methodsFor(win, now)),
        0,
        "Concurrent passes do not overlap"
      );
      browser.selectedTab = tab;
      resume.resolve();
      Assert.equal(
        await pending,
        0,
        "Do not unload a tab selected during flush"
      );
      Assert.ok(tab.linkedPanel);
    } finally {
      resume.resolve();
      sandbox.restore();
    }
    browser.selectedTab = browser.tabs[0];
    tab.updateLastAccessed(now - INACTIVE_MS);
    sandbox = sinon.createSandbox();
    sandbox.stub(browser, "prepareDiscardBrowser").callsFake(async () => {
      Services.prefs.setIntPref(INACTIVE_PREF, 0);
    });
    try {
      Assert.equal(
        await TabUnloader.unloadInactiveTabs(methodsFor(win, now)),
        0,
        "Disabling the pref during flush stops unloading"
      );
      Assert.ok(tab.linkedPanel);
      Assert.equal(
        TabUnloader._inactivityTimer,
        null,
        "Disabling cancels the timer"
      );
    } finally {
      sandbox.restore();
      Services.prefs.setIntPref(INACTIVE_PREF, INACTIVE_MS);
    }
    Assert.equal(
      await TabUnloader.unloadInactiveTabs(methodsFor(win, now)),
      1,
      "A cancelled pass does not leave the unloading guard set"
    );
  });
});

add_task(async function test_restored_age_and_wake() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.sessionstore.restore_pinned_tabs_on_demand", false]],
  });
  try {
    await withInactiveWindow(async (win, now) => {
      let tab = await inactiveTab(win, now, INACTIVE_MS + 1000);
      win.gBrowser.pinTab(tab);
      SessionStore.setCustomTabValue(tab, "inactiveRestoreTest", "1");
      let lastAccessed = tab.lastAccessed;
      const { TabStateFlusher } = ChromeUtils.importESModule(
        "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs"
      );
      await TabStateFlusher.flush(tab.linkedBrowser);
      let state = SessionStore.getWindowState(win);
      let ready = BrowserTestUtils.waitForEvent(win, "SSWindowStateReady");
      SessionStore.setWindowState(win, state, true);
      await ready;
      let restored = win.gBrowser.tabs.find(
        t => SessionStore.getCustomTabValue(t, "inactiveRestoreTest") == "1"
      );
      await TestUtils.waitForCondition(
        () =>
          restored.linkedPanel &&
          restored.linkedBrowser.currentURI.spec == INACTIVE_URL &&
          !restored.linkedBrowser.webProgress.isLoadingDocument,
        "The restored pinned tab loads in the background"
      );
      Assert.equal(
        restored.lastAccessed,
        lastAccessed,
        "Restoring does not reset the inactivity age"
      );
      Assert.equal(
        await TabUnloader.unloadInactiveTabs(methodsFor(win, now)),
        1,
        "A restored loaded tab expires using its saved last access time"
      );
      Assert.ok(TabUnloader._inactivityTimer, "The periodic timer is enabled");
      let sandbox = sinon.createSandbox();
      let check = sandbox.stub(TabUnloader, "unloadInactiveTabs").resolves(0);
      try {
        TabUnloader.init();
        Services.obs.notifyObservers(null, "wake_notification");
        Assert.equal(check.callCount, 1, "Wake requests one immediate pass");
      } finally {
        sandbox.restore();
      }
    });
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_inactive_container_selection_survives_unload() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
      ["privacy.userContext.enabled", true],
      ["browser.newtabpage.enabled", false],
    ],
  });
  try {
    await withInactiveWindow(async (win, now) => {
      let browser = win.gBrowser;
      let workspaces = browser.containerWorkspaces;
      await TestUtils.waitForCondition(() => workspaces.enabled);
      let tabs = [];
      for (let i = 0; i < 2; i++) {
        let tab = browser.addTrustedTab(INACTIVE_URL, { userContextId: 1 });
        await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
        tabs.push(tab);
      }
      browser.selectedTab = tabs[1];
      workspaces.switchTo(2);
      for (let tab of tabs) {
        tab.updateLastAccessed(now - INACTIVE_MS);
        Assert.ok(tab.workspaceHidden, "The expiring container is inactive");
      }
      let order = [...browser.tabs];
      Assert.equal(
        await TabUnloader.unloadInactiveTabs(methodsFor(win, now)),
        2
      );
      Assert.deepEqual(
        browser.tabs,
        order,
        "Hidden tabs retain their positions"
      );
      Assert.equal(
        workspaces.activeUserContextId,
        2,
        "Unloading does not switch containers"
      );
      let loaded = BrowserTestUtils.browserLoaded(
        tabs[1].linkedBrowser,
        false,
        INACTIVE_URL
      );
      workspaces.switchTo(1);
      await loaded;
      Assert.equal(
        browser.selectedTab,
        tabs[1],
        "Returning selects the same last-used tab"
      );
      Assert.equal(
        tabs[1].userContextId,
        1,
        "The restored tab keeps its container"
      );
    });
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_periodic_timer_unloads_without_manual_pass() {
  await withInactiveWindow(async (win, now) => {
    let tab = await inactiveTab(win, now, INACTIVE_MS + 1000);
    let discarded = BrowserTestUtils.waitForEvent(tab, "TabBrowserDiscarded");
    Assert.equal(
      TabUnloader._inactivityTimer.delay,
      5 * 60 * 1000,
      "The normal check interval is five minutes"
    );
    try {
      TabUnloader._inactivityTimer.delay = 10;
      await discarded;
      Assert.ok(!tab.linkedPanel, "The actual timer unloads an expired tab");
    } finally {
      Services.prefs.setIntPref(INACTIVE_PREF, 0);
      Services.prefs.setIntPref(INACTIVE_PREF, INACTIVE_MS);
    }
  });
});

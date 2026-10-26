/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

let workspaceWindow;
let workspaceBrowser;
let workspaces;
let firstContext;
let secondContext;

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
      ["sidebar.animation.enabled", false],
      ["privacy.userContext.enabled", true],
      ["browser.tabs.splitView.enabled", true],
      ["browser.newtabpage.enabled", false],
    ],
  });
  firstContext = ContextualIdentityService.create(
    "Workspace A",
    "fingerprint",
    "blue"
  );
  secondContext = ContextualIdentityService.create(
    "Workspace B",
    "briefcase",
    "red"
  );
  registerCleanupFunction(async () => {
    if (workspaceWindow && !workspaceWindow.closed) {
      await BrowserTestUtils.closeWindow(workspaceWindow);
    }
    ContextualIdentityService.remove(firstContext.userContextId);
    ContextualIdentityService.remove(secondContext.userContextId);
  });
  workspaceWindow = await BrowserTestUtils.openNewBrowserWindow();
  workspaceBrowser = workspaceWindow.gBrowser;
  workspaces = workspaceBrowser.containerWorkspaces;
  await TestUtils.waitForCondition(() => workspaces.enabled);
});

function openWorkspaceTab(userContextId) {
  return workspaceBrowser.addTrustedTab("about:blank", { userContextId });
}

add_task(async function test_switch_selection_and_pinning() {
  let defaultTab = workspaceBrowser.selectedTab;
  let first = openWorkspaceTab(firstContext.userContextId);
  let second = openWorkspaceTab(secondContext.userContextId);
  workspaceBrowser.pinTab(first);
  Assert.ok(first.workspaceHidden, "Inactive pinned tab is filtered");
  Assert.ok(!first.hidden, "Workspace filtering does not use hidden");

  workspaces.switchTo(firstContext.userContextId);
  Assert.equal(
    workspaceBrowser.selectedTab,
    first,
    "Select the container's tab"
  );
  Assert.equal(
    workspaceWindow.getComputedStyle(first.querySelector(".tab-context-line"))
      .display,
    "none",
    "Workspace tabs do not repeat the container stripe"
  );
  Assert.deepEqual(
    workspaceBrowser.visibleTabs,
    [first],
    "Only this container is visible"
  );
  Assert.ok(!workspaceBrowser.tabContainer.ariaFocusableItems.includes(second));
  Assert.ok(
    !workspaceBrowser.tabContainer.ariaFocusableItems.includes(defaultTab)
  );
  Assert.ok(
    !workspaceBrowser.tabContainer.dragAndDropElements.includes(second)
  );
  Assert.equal(workspaceWindow.getComputedStyle(second).display, "none");

  let lastSelected = openWorkspaceTab(firstContext.userContextId);
  workspaceBrowser.selectedTab = lastSelected;
  workspaceBrowser.addToMultiSelectedTabs(first);
  workspaces.switchTo(secondContext.userContextId);
  Assert.equal(
    workspaceBrowser.multiSelectedTabsCount,
    0,
    "Clear cross-workspace selection"
  );
  workspaces.switchTo(firstContext.userContextId);
  Assert.equal(
    workspaceBrowser.selectedTab,
    lastSelected,
    "Remember last selected tab"
  );

  workspaceBrowser.selectedTab = second;
  Assert.equal(
    workspaces.activeUserContextId,
    secondContext.userContextId,
    "External selection activates its workspace"
  );
  workspaceBrowser.unpinTab(first);
});

add_task(async function test_empty_and_new_tab_command() {
  let identity = ContextualIdentityService.create(
    "Empty workspace",
    "fruit",
    "green"
  );
  try {
    let before = workspaceBrowser.tabs.length;
    workspaces.switchTo(identity.userContextId);
    Assert.equal(
      workspaceBrowser.tabs.length,
      before + 1,
      "Empty workspace gets a new tab"
    );
    Assert.equal(
      workspaceBrowser.selectedTab.userContextId,
      identity.userContextId
    );
    workspaces.switchTo(identity.userContextId);
    Assert.equal(
      workspaceBrowser.tabs.length,
      before + 1,
      "Switching again reuses the tab"
    );

    let opened = BrowserTestUtils.waitForNewTab(workspaceBrowser);
    workspaceWindow.BrowserCommands.openTab();
    let tab = await opened;
    Assert.equal(
      tab.userContextId,
      identity.userContextId,
      "Ctrl+T command uses the active container"
    );
    let explicit = openWorkspaceTab(0);
    Assert.equal(
      explicit.userContextId,
      0,
      "Explicit container takes precedence"
    );
    Assert.ok(explicit.workspaceHidden);

    ContextualIdentityService.remove(identity.userContextId);
    Assert.equal(
      workspaces.activeUserContextId,
      0,
      "Deleting active container falls back to default"
    );
  } finally {
    if (
      ContextualIdentityService.getPublicIdentityFromId(identity.userContextId)
    ) {
      ContextualIdentityService.remove(identity.userContextId);
    }
  }
});

add_task(async function test_extension_hidden_and_horizontal_mode() {
  let hidden = openWorkspaceTab(firstContext.userContextId);
  workspaceBrowser.hideTab(hidden, "workspace-test-extension");
  workspaces.switchTo(firstContext.userContextId);
  Assert.ok(hidden.hidden, "Workspace switch preserves extension-hidden tabs");
  Assert.equal(
    SessionStore.getCustomTabValue(hidden, "hiddenBy"),
    "workspace-test-extension"
  );
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", false]] });
  await TestUtils.waitForCondition(() => !workspaces.enabled);
  Assert.notEqual(
    workspaceWindow.getComputedStyle(hidden.querySelector(".tab-context-line"))
      .display,
    "none",
    "Horizontal tabs retain the container stripe"
  );
  Assert.ok(
    workspaceBrowser.tabs.every(tab => !tab.workspaceHidden),
    "Horizontal mode removes workspace filtering"
  );
  Assert.ok(hidden.hidden, "Horizontal mode preserves extension hiding");
  Assert.equal(
    SessionStore.getCustomTabValue(hidden, "hiddenBy"),
    "workspace-test-extension"
  );
  await SpecialPowers.popPrefEnv();
  await TestUtils.waitForCondition(() => workspaces.enabled);
  workspaceBrowser.showTab(hidden);
});

add_task(async function test_mixed_groups_and_split_views() {
  let first = openWorkspaceTab(firstContext.userContextId);
  let second = openWorkspaceTab(secondContext.userContextId);
  let group = workspaceBrowser.addTabGroup([first, second]);
  workspaces.switchTo(firstContext.userContextId);
  Assert.ok(!group.hasAttribute("workspace-hidden"));
  Assert.ok(first.visible);
  Assert.ok(!second.visible);
  Assert.equal(
    first.getAttribute("aria-setsize"),
    "1",
    "Group positions count workspace tabs"
  );
  workspaces.switchTo(0);
  Assert.ok(
    group.hasAttribute("workspace-hidden"),
    "Group with no workspace tabs is hidden"
  );
  Assert.ok(
    !workspaceBrowser.tabContainer.ariaFocusableItems.includes(
      group.labelElement
    )
  );

  workspaces.switchTo(firstContext.userContextId);
  Assert.equal(
    workspaceBrowser.addTabSplitView([first, second]),
    null,
    "Cannot create a mixed split view"
  );
  let matching = openWorkspaceTab(firstContext.userContextId);
  let split = workspaceBrowser.addTabSplitView([first, matching]);
  Assert.ok(split, "Can create same-container split view");
  split.replaceTab(matching, second);
  Assert.ok(matching.isOpen, "Rejected replacement does not close the old tab");
  Assert.deepEqual(
    split.tabs,
    [first, matching],
    "Rejected replacement preserves the pair"
  );
  split.unsplitTabs();

  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", false]] });
  await TestUtils.waitForCondition(() => !workspaces.enabled);
  let mixed = workspaceBrowser.addTabSplitView([first, second]);
  await SpecialPowers.popPrefEnv();
  await TestUtils.waitForCondition(() => workspaces.enabled);
  workspaces.switchTo(firstContext.userContextId);
  Assert.ok(mixed.visible, "Existing mixed pair is visible in first container");
  workspaces.switchTo(secondContext.userContextId);
  Assert.ok(
    mixed.visible,
    "Existing mixed pair is visible in second container"
  );
  workspaces.switchTo(0);
  Assert.ok(
    mixed.hasAttribute("workspace-hidden"),
    "Pair is hidden in unrelated container"
  );
  mixed.unsplitTabs();

  workspaces.switchTo(firstContext.userContextId);
  workspaceBrowser.selectedTab = matching;
  workspaceWindow.BrowserCommands.addTabSplitView();
  Assert.equal(
    workspaceBrowser.selectedTab.userContextId,
    firstContext.userContextId,
    "Split view shortcut opens the picker in the current container"
  );
  Assert.ok(matching.splitview, "Split view shortcut creates the pair");
  Assert.ok(
    matching.splitview.tabs.every(
      tab => tab.userContextId == firstContext.userContextId
    ),
    "Picker and original tab share their container"
  );
  matching.splitview.unsplitTabs();
});

add_task(async function test_sharing_and_mru() {
  let sharing = openWorkspaceTab(firstContext.userContextId);
  workspaces.switchTo(secondContext.userContextId);
  workspaceBrowser.updateBrowserSharing(sharing.linkedBrowser, {
    webRTC: { sharing: "camera" },
  });
  Assert.ok(
    sharing.visible,
    "Active sharing remains visible across workspaces"
  );
  workspaceBrowser.resetBrowserSharing(sharing.linkedBrowser);
  Assert.ok(!sharing.visible, "After sharing ends the tab is filtered again");
  workspaceWindow.ctrlTab.init();
  Assert.ok(
    workspaceWindow.ctrlTab.tabList.every(tab => !tab.workspaceHidden),
    "MRU excludes inactive workspaces"
  );
  workspaceBrowser.selectTabAtIndex(0);
  Assert.ok(
    !workspaceBrowser.selectedTab.workspaceHidden,
    "Numbered navigation selects a visible tab"
  );
});

add_task(async function test_close_last_and_window_state() {
  let identity = ContextualIdentityService.create(
    "Close last",
    "fruit",
    "green"
  );
  try {
    workspaces.switchTo(identity.userContextId);
    let lastTab = workspaceBrowser.selectedTab;
    workspaceBrowser.removeTab(lastTab, { animate: false });
    Assert.equal(
      workspaces.activeUserContextId,
      identity.userContextId,
      "Closing last tab stays in its workspace"
    );
    Assert.equal(
      workspaceBrowser.selectedTab.userContextId,
      identity.userContextId
    );

    let secondWindow = await BrowserTestUtils.openNewBrowserWindow();
    try {
      Assert.equal(
        secondWindow.gBrowser.containerWorkspaces.activeUserContextId,
        0,
        "Windows have independent workspace selection"
      );
    } finally {
      await BrowserTestUtils.closeWindow(secondWindow);
    }
    workspaces.switchTo(firstContext.userContextId);
    let state = SessionStore.getWindowState(workspaceWindow);
    workspaces.switchTo(secondContext.userContextId);
    let restored = BrowserTestUtils.waitForEvent(
      workspaceWindow,
      "SSWindowStateReady"
    );
    SessionStore.setWindowState(workspaceWindow, state, true);
    await restored;
    Assert.equal(
      workspaces.activeUserContextId,
      firstContext.userContextId,
      "Session restore restores active container"
    );
    Assert.equal(
      workspaceBrowser.selectedTab.userContextId,
      firstContext.userContextId
    );
  } finally {
    ContextualIdentityService.remove(identity.userContextId);
  }
});

add_task(async function test_disabled_and_private_windows() {
  await SpecialPowers.pushPrefEnv({
    set: [["privacy.userContext.enabled", false]],
  });
  Assert.ok(
    !workspaces.enabled,
    "Disabled containers disable workspace filtering"
  );
  Assert.ok(workspaceBrowser.tabs.every(tab => !tab.workspaceHidden));
  await SpecialPowers.popPrefEnv();
  await TestUtils.waitForCondition(() => workspaces.enabled);
  let privateWindow = await BrowserTestUtils.openNewBrowserWindow({
    private: true,
  });
  try {
    Assert.ok(
      !privateWindow.gBrowser.containerWorkspaces.enabled,
      "No workspaces in private windows"
    );
  } finally {
    await BrowserTestUtils.closeWindow(privateWindow);
  }
});

add_task(async function test_no_container_is_last() {
  let ids = workspaces.workspaces.map(workspace => workspace.userContextId);
  Assert.equal(ids.at(-1), 0, "No Container is the last workspace");
  Assert.deepEqual(
    ids.slice(0, -1),
    ContextualIdentityService.getPublicIdentities().map(
      identity => identity.userContextId
    ),
    "Containers retain their configured order before No Container"
  );

  let previous = workspaces.activeUserContextId;
  try {
    workspaces.switchTo(ids.at(-2));
    Assert.ok(workspaces.switchBy(1), "Advance from the last container");
    Assert.equal(workspaces.activeUserContextId, 0, "Advance to No Container");
    Assert.ok(!workspaces.switchBy(1), "Do not wrap after No Container");
    Assert.equal(workspaces.activeUserContextId, 0);
    Assert.ok(workspaces.switchBy(-1), "Move back from No Container");
    Assert.equal(workspaces.activeUserContextId, ids.at(-2));
    workspaces.switchTo(ids[0]);
    Assert.ok(
      !workspaces.switchBy(-1),
      "Do not wrap before the first container"
    );
    Assert.equal(workspaces.activeUserContextId, ids[0]);
  } finally {
    workspaces.switchTo(previous);
  }
});

add_task(async function test_inactive_workspace_session_restore() {
  let restoreFirstContext = ContextualIdentityService.create(
    "Restore A",
    "fruit",
    "green"
  );
  let restoreSecondContext = ContextualIdentityService.create(
    "Restore B",
    "briefcase",
    "red"
  );
  let source = await BrowserTestUtils.openNewBrowserWindow();
  let restoredWindow;
  const key = "workspaceRestoreTestId";
  function snapshot(browser) {
    return browser.tabs.map(tab => ({
      id: SessionStore.getCustomTabValue(tab, key),
      userContextId: tab.userContextId,
      pinned: tab.pinned,
      group: tab.group?.id,
    }));
  }
  try {
    let browser = source.gBrowser;
    let controller = browser.containerWorkspaces;
    await TestUtils.waitForCondition(() => controller.enabled);
    let tabs = new Map();
    for (let [prefix, identity] of [
      ["a", restoreFirstContext],
      ["b", restoreSecondContext],
    ]) {
      for (let index = 1; index <= 3; index++) {
        let id = prefix + index;
        let tab = browser.addTrustedTab("about:blank", {
          userContextId: identity.userContextId,
        });
        SessionStore.setCustomTabValue(tab, key, id);
        tabs.set(id, tab);
      }
      browser.pinTab(tabs.get(prefix + 1));
      browser.addTabGroup([tabs.get(prefix + 2), tabs.get(prefix + 3)]);
    }
    browser.selectedTab = tabs.get("a3");
    browser.selectedTab = tabs.get("a2");
    Assert.equal(
      SessionStore.getCustomTabValue(tabs.get("a3"), "workspaceLastSelected"),
      "",
      "Selecting another tab clears the previous saved selection"
    );
    browser.selectedTab = tabs.get("b3");
    controller.switchTo(0);
    let expected = snapshot(browser);
    let state = SessionStore.getWindowState(source);
    await BrowserTestUtils.closeWindow(source);
    source = null;

    restoredWindow = await BrowserTestUtils.openNewBrowserWindow();
    let ready = BrowserTestUtils.waitForEvent(
      restoredWindow,
      "SSWindowStateReady"
    );
    SessionStore.setWindowState(restoredWindow, state, true);
    await ready;
    browser = restoredWindow.gBrowser;
    controller = browser.containerWorkspaces;
    Assert.equal(controller.activeUserContextId, 0);
    Assert.deepEqual(
      snapshot(browser),
      expected,
      "All inactive tabs retain their order, containers, pinned state and groups"
    );
    for (let [identity, id] of [
      [restoreFirstContext, "a2"],
      [restoreSecondContext, "b3"],
    ]) {
      Assert.ok(
        controller.switchTo(identity.userContextId),
        "Can switch restored workspace"
      );
      Assert.equal(
        SessionStore.getCustomTabValue(browser.selectedTab, key),
        id,
        "Restore the last selected tab of each inactive workspace"
      );
    }
    Assert.deepEqual(
      snapshot(browser),
      expected,
      "Switching restored workspaces does not reorder or create tabs"
    );
  } finally {
    if (source && !source.closed) {
      await BrowserTestUtils.closeWindow(source);
    }
    if (restoredWindow && !restoredWindow.closed) {
      await BrowserTestUtils.closeWindow(restoredWindow);
    }
    ContextualIdentityService.remove(restoreFirstContext.userContextId);
    ContextualIdentityService.remove(restoreSecondContext.userContextId);
  }
});

add_task(async function test_duplicate_and_reopened_workspace_selection() {
  let identity = ContextualIdentityService.create(
    "Restore selection",
    "fruit",
    "green"
  );
  let win = await BrowserTestUtils.openNewBrowserWindow();
  try {
    let browser = win.gBrowser;
    let controller = browser.containerWorkspaces;
    await TestUtils.waitForCondition(() => controller.enabled);
    let original = browser.addTrustedTab("about:mozilla", {
      userContextId: identity.userContextId,
    });
    await BrowserTestUtils.browserLoaded(original.linkedBrowser);
    browser.selectedTab = original;
    let duplicate = SessionStore.duplicateTab(win, original, 0, true, {
      inBackground: true,
    });
    await BrowserTestUtils.waitForEvent(duplicate, "SSTabRestoring");
    Assert.equal(
      SessionStore.getCustomTabValue(duplicate, "workspaceLastSelected"),
      "",
      "A background duplicate does not inherit the saved selection"
    );
    controller.switchTo(0);
    controller.switchTo(identity.userContextId);
    Assert.equal(
      browser.selectedTab,
      original,
      "Keep the original selected tab"
    );
    controller.switchTo(0);
    let closedCount = SessionStore.getClosedTabCountForWindow(win);
    browser.removeTab(original, { animate: false });
    await TestUtils.waitForCondition(
      () => SessionStore.getClosedTabCountForWindow(win) > closedCount,
      "SessionStore records the closed tab"
    );
    controller.switchTo(identity.userContextId);
    Assert.equal(
      browser.selectedTab,
      duplicate,
      "Use a remaining tab after close"
    );
    controller.switchTo(0);
    let restoring = BrowserTestUtils.waitForEvent(win, "SSTabRestoring");
    let reopened = SessionStore.undoCloseTab(win);
    await restoring;
    Assert.equal(
      browser.selectedTab,
      reopened,
      "Reopening selects the restored tab"
    );
    Assert.equal(
      SessionStore.getCustomTabValue(duplicate, "workspaceLastSelected"),
      "",
      "Reopening clears the previous selected tab's marker"
    );
    Assert.equal(
      browser.tabs.filter(
        tab =>
          tab.userContextId == identity.userContextId &&
          SessionStore.getCustomTabValue(tab, "workspaceLastSelected") == "1"
      ).length,
      1,
      "Only one saved selection remains in the workspace"
    );
  } finally {
    await BrowserTestUtils.closeWindow(win);
    ContextualIdentityService.remove(identity.userContextId);
  }
});

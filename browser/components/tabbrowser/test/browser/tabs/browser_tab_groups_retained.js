/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

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
});

async function retainedGroupFixture(contexts = [0, 0, 0], split = false) {
  const win = await BrowserTestUtils.openNewBrowserWindow();
  registerCleanupFunction(async () => {
    if (!win.closed) {
      await BrowserTestUtils.closeWindow(win);
    }
  });
  const browser = win.gBrowser;
  await TestUtils.waitForCondition(() => browser.containerWorkspaces.enabled);
  const outside = new Map([[0, browser.selectedTab]]);
  for (const id of new Set(contexts)) {
    if (!outside.has(id)) {
      outside.set(
        id,
        browser.addTrustedTab("about:blank", {
          userContextId: id,
          skipAnimation: true,
        })
      );
    }
  }
  const tabs = contexts.map(userContextId =>
    browser.addTrustedTab("about:blank", {
      userContextId,
      skipAnimation: true,
    })
  );
  const pair = split
    ? browser.addTabSplitView([tabs[0], tabs[1]], { insertBefore: tabs[0] })
    : null;
  const group = browser.addTabGroup(pair ? [pair, tabs[2]] : tabs, {
    label: "Retained group",
  });
  browser.selectedTab = outside.get(0);
  await TestUtils.waitForTick();
  return { win, browser, outside, tabs, group, pair };
}

add_task(async function test_retained_tab_and_horizontal_mode() {
  const { win, browser, outside, tabs, group } = await retainedGroupFixture();
  try {
    browser.selectedTab = tabs[1];
    group.collapsed = true;
    const order = [...browser.tabs];
    browser.selectedTab = outside.get(0);
    await TestUtils.waitForTick();
    Assert.ok(group.collapsed, "Leaving the group does not expand it");
    Assert.ok(!group.hasActiveTab, "The group is no longer active");
    Assert.ok(group.hasRetainedTab, "The group keeps a visible retained tab");
    Assert.equal(group.retainedTab, tabs[1]);
    Assert.deepEqual(
      group.tabs.filter(tab => tab.visible),
      [tabs[1]]
    );
    Assert.deepEqual(browser.tabs, order, "Leaving does not reorder tabs");
    Assert.notEqual(win.getComputedStyle(tabs[1]).display, "none");
    Assert.ok(!tabs[1].hasAttribute("aria-hidden"));
    Assert.equal(tabs[0].getAttribute("aria-hidden"), "true");
    Assert.ok(browser.tabContainer.ariaFocusableItems.includes(tabs[1]));
    Assert.ok(!browser.tabContainer.ariaFocusableItems.includes(tabs[0]));
    Assert.ok(browser.tabContainer.dragAndDropElements.includes(tabs[1]));

    browser.selectedTab = tabs[2];
    browser.selectedTab = outside.get(0);
    Assert.equal(
      group.retainedTab,
      tabs[2],
      "Selecting another member replaces the retained tab"
    );
    Assert.deepEqual(
      group.tabs.filter(tab => tab.visible),
      [tabs[2]]
    );

    await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", false]] });
    try {
      await TestUtils.waitForCondition(
        () => !browser.tabContainer.verticalMode
      );
      await TestUtils.waitForTick();
      Assert.ok(
        !group.hasRetainedTab,
        "Horizontal mode has no retained presentation"
      );
      Assert.ok(
        !tabs[2].visible,
        "Horizontal collapsed-group visibility is unchanged"
      );
      Assert.equal(tabs[2].getBoundingClientRect().width, 0);
    } finally {
      await SpecialPowers.popPrefEnv();
    }
    await TestUtils.waitForCondition(() => browser.tabContainer.verticalMode);
    await TestUtils.waitForTick();
    Assert.equal(
      group.retainedTab,
      tabs[2],
      "Returning to vertical restores the retained tab"
    );
    Assert.ok(tabs[2].visible);
    group.collapsed = false;
    Assert.ok(!group.hasRetainedTab, "Expanding clears the retained state");
    Assert.ok(group.tabs.every(tab => tab.visible));
    Assert.ok(
      group.tabs.every(
        tab => !SessionStore.getCustomTabValue(tab, "retainedTabGroup")
      )
    );
  } finally {
    await BrowserTestUtils.closeWindow(win);
  }
});

add_task(async function test_retained_member_leaves_or_closes() {
  const { win, browser, outside, tabs, group } = await retainedGroupFixture();
  try {
    browser.selectedTab = tabs[1];
    group.collapsed = true;
    browser.selectedTab = outside.get(0);
    browser.ungroupTab(tabs[1]);
    await TestUtils.waitForTick();
    Assert.equal(
      group.retainedTab,
      null,
      "Moving the retained tab out clears its slot"
    );
    Assert.ok(!tabs[1].hasAttribute("group-retained"));
    Assert.equal(
      SessionStore.getCustomTabValue(tabs[1], "retainedTabGroup"),
      ""
    );
    Assert.ok(!group.hasRetainedTab);
    browser.selectedTab = tabs[2];
    browser.selectedTab = outside.get(0);
    browser.removeTab(tabs[2], { animate: false });
    await TestUtils.waitForTick();
    Assert.equal(
      group.retainedTab,
      null,
      "Closing the retained tab does not reveal an arbitrary replacement"
    );
    Assert.ok(!group.hasRetainedTab);
  } finally {
    await BrowserTestUtils.closeWindow(win);
  }
});

add_task(async function test_retained_split_view() {
  const { win, browser, outside, tabs, group, pair } =
    await retainedGroupFixture([0, 0, 0], true);
  try {
    browser.selectedTab = tabs[0];
    group.collapsed = true;
    browser.selectedTab = outside.get(0);
    await TestUtils.waitForTick();
    Assert.ok(!pair.hasActiveTab, "The pair is no longer selected");
    Assert.ok(pair.hasAttribute("group-retained"));
    Assert.ok(pair.visible, "Both members of the retained pair stay visible");
    Assert.notEqual(win.getComputedStyle(pair).display, "none");
    Assert.ok(!pair.hasAttribute("aria-hidden"));
    Assert.deepEqual(
      group.tabs.filter(tab => tab.visible),
      pair.tabs
    );
    Assert.ok(browser.tabContainer.dragAndDropElements.includes(pair));
    const count = group.querySelector(".tab-group-overflow-count");
    await TestUtils.waitForCondition(() => count.textContent.includes("1"));
    Assert.ok(
      group.hasAttribute("hasmultipletabs"),
      "Overflow excludes both visible members"
    );
  } finally {
    await BrowserTestUtils.closeWindow(win);
  }
});

add_task(async function test_retained_tabs_restore_per_workspace() {
  const first = ContextualIdentityService.create("Retained A", "fruit", "blue");
  const second = ContextualIdentityService.create(
    "Retained B",
    "briefcase",
    "red"
  );
  const { win, browser, outside, tabs, group } = await retainedGroupFixture([
    first.userContextId,
    first.userContextId,
    second.userContextId,
    second.userContextId,
  ]);
  let restored;
  try {
    browser.selectedTab = tabs[1];
    group.collapsed = true;
    browser.selectedTab = outside.get(first.userContextId);
    browser.selectedTab = tabs[3];
    browser.selectedTab = outside.get(second.userContextId);
    browser.containerWorkspaces.switchTo(first.userContextId);
    Assert.equal(
      group.retainedTab,
      tabs[1],
      "First workspace keeps its own retained member"
    );
    Assert.deepEqual(
      group.tabs.filter(tab => tab.visible),
      [tabs[1]]
    );
    browser.containerWorkspaces.switchTo(second.userContextId);
    Assert.equal(
      group.retainedTab,
      tabs[3],
      "Second workspace keeps a different member"
    );
    for (let index = 0; index < tabs.length; index++) {
      SessionStore.setCustomTabValue(
        tabs[index],
        "retainedTestId",
        String(index)
      );
    }
    const state = SessionStore.getWindowState(win);
    const groupId = group.id;
    await BrowserTestUtils.closeWindow(win);
    restored = await BrowserTestUtils.openNewBrowserWindow();
    const ready = BrowserTestUtils.waitForEvent(restored, "SSWindowStateReady");
    SessionStore.setWindowState(restored, state, true);
    await ready;
    await TestUtils.waitForTick();
    const restoredBrowser = restored.gBrowser;
    const restoredGroup = restoredBrowser.tabGroups.find(
      candidate => candidate.id == groupId
    );
    Assert.ok(restoredGroup.collapsed, "Collapsed state survives restore");
    Assert.notEqual(
      restoredBrowser.selectedTab.group,
      restoredGroup,
      "The restored retained tab does not steal selection"
    );
    for (const [identity, expected] of [
      [second, "3"],
      [first, "1"],
    ]) {
      restoredBrowser.containerWorkspaces.switchTo(identity.userContextId);
      Assert.equal(
        SessionStore.getCustomTabValue(
          restoredGroup.retainedTab,
          "retainedTestId"
        ),
        expected
      );
      Assert.deepEqual(
        restoredGroup.tabs.filter(tab => tab.visible),
        [restoredGroup.retainedTab]
      );
      Assert.ok(
        !restoredGroup.retainedTab.linkedPanel,
        "Restoring retained visibility does not load a background browser"
      );
    }
  } finally {
    if (!win.closed) {
      await BrowserTestUtils.closeWindow(win);
    }
    if (restored && !restored.closed) {
      await BrowserTestUtils.closeWindow(restored);
    }
    ContextualIdentityService.remove(first.userContextId);
    ContextualIdentityService.remove(second.userContextId);
  }
});

add_task(async function test_restored_retained_markers_are_unique() {
  const { win, browser, outside, tabs, group } = await retainedGroupFixture();
  let restored;
  try {
    browser.selectedTab = tabs[1];
    group.collapsed = true;
    browser.selectedTab = outside.get(0);
    for (let index = 0; index < tabs.length; index++) {
      SessionStore.setCustomTabValue(
        tabs[index],
        "retainedTestId",
        String(index)
      );
    }
    const state = structuredClone(SessionStore.getWindowState(win));
    const windowState = state.windows[0];
    const duplicate = windowState.tabs.find(
      tab => tab.extData?.retainedTestId == "0"
    );
    duplicate.extData.retainedTabGroup = group.id;
    windowState.selected =
      windowState.tabs.findIndex(tab => tab.extData?.retainedTestId == "1") + 1;
    const groupId = group.id;
    await BrowserTestUtils.closeWindow(win);
    restored = await BrowserTestUtils.openNewBrowserWindow();
    const ready = BrowserTestUtils.waitForEvent(restored, "SSWindowStateReady");
    SessionStore.setWindowState(restored, state, true);
    await ready;
    await TestUtils.waitForTick();
    const restoredBrowser = restored.gBrowser;
    const restoredGroup = restoredBrowser.tabGroups.find(
      candidate => candidate.id == groupId
    );
    Assert.equal(
      restoredGroup.retainedTab,
      restoredBrowser.selectedTab,
      "The selected member wins over a copied marker"
    );
    Assert.equal(
      SessionStore.getCustomTabValue(
        restoredGroup.retainedTab,
        "retainedTestId"
      ),
      "1"
    );
    Assert.equal(
      restoredGroup.tabs.filter(
        tab =>
          SessionStore.getCustomTabValue(tab, "retainedTabGroup") == groupId
      ).length,
      1,
      "Only one retained marker survives in a workspace"
    );
  } finally {
    if (!win.closed) {
      await BrowserTestUtils.closeWindow(win);
    }
    if (restored && !restored.closed) {
      await BrowserTestUtils.closeWindow(restored);
    }
  }
});

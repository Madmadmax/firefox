/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const LIST_URL =
  "https://example.com/browser/browser/components/tabbrowser/test/browser/tabs/dummy_page.html";

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

async function withListWindow(task) {
  const win = await BrowserTestUtils.openNewBrowserWindow();
  try {
    await TestUtils.waitForCondition(
      () => win.gBrowser.containerWorkspaces.enabled
    );
    win.SidebarController._state.launcherExpanded = true;
    await TestUtils.waitForCondition(() =>
      win.gBrowser.tabContainer.hasAttribute("expanded")
    );
    await task(win, win.gBrowser);
  } finally {
    await BrowserTestUtils.closeWindow(win);
  }
}

async function listPage(browser, suffix = "") {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    browser,
    LIST_URL + suffix
  );
  browser.pinTabToList(tab);
  return tab;
}

add_task(async function test_order_and_conversion() {
  await withListWindow(async (win, browser) => {
    const first = browser.addTrustedTab("about:blank");
    const second = browser.addTrustedTab("about:blank");
    const icon = browser.addTrustedTab("about:blank");
    browser.pinTabToList(first);
    browser.pinTabToList(second);
    browser.pinTab(icon);
    Assert.deepEqual(browser.tabs.slice(0, 3), [icon, first, second]);
    browser.moveTabTo(first, { tabIndex: 0 });
    Assert.equal(
      browser.tabs[0],
      icon,
      "A list row cannot move before an icon pin"
    );
    browser.moveTabAfter(icon, second);
    Assert.equal(browser.tabs[0], icon, "Icon pins stay before list pins");
    browser.pinTabAsIcon(second);
    Assert.deepEqual(browser.tabs.slice(0, 3), [icon, second, first]);
    Assert.ok(!second.listPinned, "Pin as icon clears the subtype");
    browser.unpinTabFromList(first);
    Assert.ok(!first.pinned);
    Assert.equal(SessionStore.getCustomTabValue(first, "listPinned"), "");
    browser.pinTabToList(first);
    const group = browser.addTabGroup([first]);
    Assert.ok(group.listPinned, "A group of list pins is a list group");
    browser.ungroupTab(first);
    Assert.ok(
      first.listPinned && !first.group,
      "Ungrouping keeps list pinning"
    );
    const other = browser.addTrustedTab("about:blank");
    browser.addTabSplitView([first, other]);
    Assert.ok(!first.splitview, "List pins cannot enter split view");
    await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", false]] });
    await TestUtils.waitForCondition(() => !browser.tabContainer.verticalMode);
    Assert.ok(first.listPinned, "Changing orientation preserves the subtype");
    Assert.equal(
      first.closeButton.getAttribute("data-l10n-id"),
      "tabbrowser-close-tabs-button"
    );
    await SpecialPowers.popPrefEnv();
  });
});

add_task(async function test_group_context_menu() {
  for (const alternate of [false, true]) {
    await SpecialPowers.pushPrefEnv({
      set: [["browser.tabs.contextmenu.altstructure.enabled", alternate]],
    });
    await withListWindow(async (win, browser) => {
      const list = await listPage(browser, "?menu");
      const normal = browser.addTrustedTab("about:blank");
      browser.addTabGroup([browser.addTrustedTab("about:blank")]);
      const menu = win.document.getElementById("tabContextMenu");
      for (const tab of [list, normal]) {
        const shown = BrowserTestUtils.waitForPopupEvent(menu, "shown");
        tab.scrollIntoView({ behavior: "instant" });
        EventUtils.synthesizeMouseAtCenter(
          tab,
          { type: "contextmenu", button: 2 },
          win
        );
        await shown;
        const id = alternate
          ? "context_addTabToGroup"
          : "context_moveTabToGroup";
        Assert.ok(
          !win.document.getElementById(id).hidden,
          `Group actions are shown for tab ${tab.listPinned}`
        );
        const hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
        menu.hidePopup();
        await hidden;
      }
    });
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_list_pinned_groups() {
  await withListWindow(async (win, browser) => {
    const icon = browser.addTrustedTab("about:blank");
    browser.pinTab(icon);
    const first = await listPage(browser, "?group-1");
    const second = await listPage(browser, "?group-2");
    const group = browser.addTabGroup([first, second], { label: "List" });
    Assert.ok(group.listPinned, "The group stays among list pins");
    Assert.equal(group.parentNode, browser.tabContainer.pinnedTabsContainer);
    Assert.ok(browser.tabGroups.includes(group), "The group is listed");
    Assert.deepEqual(browser.tabs.slice(0, 3), [icon, first, second]);
    Assert.ok(first.pinned && first.listPinned && first.group == group);
    Assert.equal(
      browser.tabContainer.visiblePinnedTabCount,
      4,
      "The group label counts among pinned elements"
    );

    const normal = browser.addTrustedTab("about:blank");
    group.addTabs([normal]);
    Assert.ok(
      normal.listPinned && normal.group == group,
      "An ordinary tab added to a list group becomes a list pin"
    );

    const lateIcon = browser.addTrustedTab("about:blank");
    browser.pinTab(lateIcon);
    Assert.deepEqual(
      browser.tabs.slice(0, 2),
      [icon, lateIcon],
      "Icon pins go before the list group"
    );

    browser.unpinTabFromList(normal);
    Assert.ok(
      !normal.pinned && !normal.group,
      "Unpinning from the list leaves the group"
    );

    const ordinaryGroup = browser.addTabGroup([
      browser.addTrustedTab("about:blank"),
    ]);
    ordinaryGroup.addTabs([second]);
    Assert.ok(
      !second.pinned && second.group == ordinaryGroup,
      "A list pin added to an ordinary group becomes an ordinary tab"
    );

    group.collapsed = true;
    const state = SessionStore.getWindowState(win);
    await withListWindow(async (restored, target) => {
      const ready = BrowserTestUtils.waitForEvent(
        restored,
        "SSWindowStateReady"
      );
      SessionStore.setWindowState(restored, state, true);
      await ready;
      const restoredGroup = target.tabGroups.find(g => g.label == "List");
      Assert.ok(restoredGroup?.listPinned, "The list group restores");
      Assert.equal(
        restoredGroup.parentNode,
        target.tabContainer.pinnedTabsContainer
      );
      Assert.ok(restoredGroup.collapsed, "Its collapsed state restores");
      Assert.ok(
        restoredGroup.tabs.length == 1 && restoredGroup.tabs[0].listPinned,
        "Its list pins restore inside it"
      );
    });
  });
});

add_task(async function test_restore_duplicate_and_adopt() {
  await withListWindow(async (win, browser) => {
    const original = await listPage(browser, "?restore");
    const duplicate = SessionStore.duplicateTab(win, original, 0, true, {
      inBackground: true,
    });
    await BrowserTestUtils.waitForEvent(duplicate, "SSTabRestoring");
    Assert.ok(duplicate.listPinned, "A duplicate retains list pinning");
    const state = SessionStore.getWindowState(win);
    await withListWindow(async (restored, target) => {
      const ready = BrowserTestUtils.waitForEvent(
        restored,
        "SSWindowStateReady"
      );
      SessionStore.setWindowState(restored, state, true);
      await ready;
      Assert.equal(
        target.tabs.filter(tab => tab.listPinned).length,
        2,
        "Both subtype markers restore"
      );
      Assert.ok(target.tabs[0].listPinned && target.tabs[1].listPinned);
      const adopted = target.adoptTab(duplicate, {
        tabIndex: target.pinnedTabCount,
      });
      Assert.ok(
        adopted.listPinned,
        "Moving between windows retains list pinning"
      );
      Assert.equal(
        SessionStore.getCustomTabValue(adopted, "listPinned"),
        "true"
      );
    });
  });
});

add_task(async function test_unload_chooses_loaded_successor() {
  await withListWindow(async (win, browser) => {
    const selected = await listPage(browser, "?unload");
    const pending = await BrowserTestUtils.openNewForegroundTab(
      browser,
      LIST_URL + "?pending"
    );
    const successor = await BrowserTestUtils.openNewForegroundTab(
      browser,
      LIST_URL + "?successor"
    );
    browser.selectedTab = selected;
    await browser.prepareDiscardBrowser(pending);
    Assert.ok(browser.discardBrowser(pending));
    browser.removeTab(
      browser.tabs.find(
        tab => !tab.pinned && tab != pending && tab != successor
      ),
      { animate: false }
    );
    Assert.ok(await browser.unloadListPinnedTab(selected));
    Assert.equal(
      browser.selectedTab,
      successor,
      "Skip unloaded tabs when choosing the next page"
    );
    Assert.ok(!selected.linkedPanel);
    Assert.ok(selected.listPinned);
    Assert.equal(selected.linkedBrowser.currentURI.spec, LIST_URL + "?unload");
    const loaded = BrowserTestUtils.browserLoaded(selected.linkedBrowser);
    browser.selectedTab = selected;
    await loaded;
    await browser.prepareDiscardBrowser(successor);
    Assert.ok(browser.discardBrowser(successor));
    Assert.ok(await browser.unloadListPinnedTab(selected));
    Assert.ok(!browser.selectedTab.pinned);
    Assert.ok(
      ![pending, successor].includes(browser.selectedTab),
      "Create a new tab when every alternative is unloaded"
    );
  });
});

add_task(async function test_beforeunload_keeps_selection() {
  await SpecialPowers.pushPrefEnv({
    set: [["dom.require_user_interaction_for_beforeunload", false]],
  });
  try {
    await withListWindow(async (win, browser) => {
      const selected = await listPage(browser, "?beforeunload");
      await SpecialPowers.spawn(selected.linkedBrowser, [], () => {
        content.onbeforeunload = event => {
          event.preventDefault();
          event.returnValue = "";
        };
      });
      try {
        Assert.ok(
          !(await browser.unloadListPinnedTab(selected)),
          "A page can refuse unloading"
        );
        Assert.equal(
          browser.selectedTab,
          selected,
          "An unsuccessful unload preserves selection"
        );
        Assert.ok(selected.linkedPanel);
      } finally {
        await SpecialPowers.spawn(selected.linkedBrowser, [], () => {
          content.onbeforeunload = null;
        });
      }
    });
  } finally {
    await SpecialPowers.popPrefEnv();
  }
});

add_task(async function test_links_and_new_tabs_open_above_normal_tabs() {
  await withListWindow(async (win, browser) => {
    const source = await listPage(browser, "?source");
    const existing = browser.addTrustedTab("about:blank");
    browser.selectedTab = source;
    const created = BrowserTestUtils.waitForNewTab(browser, LIST_URL + "?link");
    win.openTrustedLinkIn(LIST_URL + "?link", "tabshifted", {
      relatedToCurrent: true,
    });
    const link = await created;
    Assert.equal(
      browser.selectedTab,
      source,
      "A foreground-link request from a list pin stays in the background"
    );
    Assert.equal(
      link.index,
      browser.pinnedTabCount,
      "Insert at the start of normal tabs"
    );
    Assert.less(link.index, existing.index);
    await SpecialPowers.spawn(
      source.linkedBrowser,
      [LIST_URL + "?blank"],
      url => {
        const anchor = content.document.createElement("a");
        anchor.id = "list-pinned-blank-link";
        anchor.href = url;
        anchor.target = "_blank";
        anchor.textContent = "Open another tab";
        content.document.body.appendChild(anchor);
      }
    );
    const blankCreated = BrowserTestUtils.waitForNewTab(
      browser,
      LIST_URL + "?blank"
    );
    await BrowserTestUtils.synthesizeMouseAtCenter(
      "#list-pinned-blank-link",
      {},
      source.linkedBrowser
    );
    const blankLink = await blankCreated;
    Assert.equal(
      browser.selectedTab,
      source,
      "A real target=_blank click stays in the background"
    );
    Assert.equal(blankLink.index, browser.pinnedTabCount);

    browser.addTabGroup([source]);
    const groupedCreated = BrowserTestUtils.waitForNewTab(
      browser,
      LIST_URL + "?grouped"
    );
    win.openTrustedLinkIn(LIST_URL + "?grouped", "tab", {
      relatedToCurrent: true,
    });
    const groupedLink = await groupedCreated;
    Assert.ok(
      !groupedLink.pinned && !groupedLink.group,
      "A link from a list group opens outside of the group"
    );
    Assert.equal(groupedLink.index, browser.pinnedTabCount);

    const newTab = BrowserTestUtils.waitForNewTab(browser);
    win.BrowserCommands.openTab();
    const fresh = await newTab;
    Assert.equal(fresh.index, browser.pinnedTabCount);
    Assert.equal(
      browser.selectedTab,
      fresh,
      "New Tab still selects its new page"
    );
  });
});

add_task(async function test_normal_links_open_immediately_after_source() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.tabs.loadDivertedInBackground", true]],
  });
  await withListWindow(async (win, browser) => {
    // Pinned tabs hidden in another workspace must not push links to the end.
    for (let index = 0; index < 4; index++) {
      browser.addTrustedTab("about:blank", { userContextId: 1, pinned: true });
    }
    await TestUtils.waitForCondition(
      () => browser.tabContainer.visiblePinnedTabCount < browser.pinnedTabCount
    );
    for (const uri of [
      LIST_URL,
      "data:text/html,<title>Source</title><body>",
    ]) {
      const source = await BrowserTestUtils.openNewForegroundTab(browser, uri);
      const trailing = browser.addTrustedTab("about:blank");
      const opened = [];
      await SpecialPowers.spawn(source.linkedBrowser, [], () => {
        const anchor = content.document.createElement("a");
        anchor.id = "normal-new-tab-link";
        anchor.textContent = "New tab";
        content.document.body.appendChild(anchor);
      });
      for (let index = 0; index < 3; index++) {
        const url = LIST_URL + "?normal-link=" + index;
        await SpecialPowers.spawn(
          source.linkedBrowser,
          [url, index],
          (href, n) => {
            const anchor = content.document.getElementById(
              "normal-new-tab-link"
            );
            anchor.href = href;
            anchor.target = n == 1 ? "" : "_blank";
          }
        );
        const created = BrowserTestUtils.waitForNewTab(browser, url);
        await BrowserTestUtils.synthesizeMouseAtCenter(
          "#normal-new-tab-link",
          index == 1 ? { accelKey: true } : {},
          source.linkedBrowser
        );
        const tab = await created;
        opened.unshift(tab);
        Assert.deepEqual(
          browser.tabs.slice(source.index, trailing.index + 1),
          [source, ...opened, trailing],
          "Each link is inserted immediately after its ordinary source"
        );
      }
    }
  });
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_links_from_groups_open_first_among_normal_tabs() {
  await withListWindow(async (win, browser) => {
    browser.addTrustedTab("about:blank");
    const source = await BrowserTestUtils.openNewForegroundTab(
      browser,
      LIST_URL + "?grouped-source"
    );
    browser.addTabGroup([source, browser.addTrustedTab("about:blank")]);
    browser.selectedTab = source;
    const created = BrowserTestUtils.waitForNewTab(
      browser,
      LIST_URL + "?from-group"
    );
    win.openTrustedLinkIn(LIST_URL + "?from-group", "tab", {
      relatedToCurrent: true,
    });
    const link = await created;
    Assert.ok(!link.group, "A link from a tab group opens outside of it");
    Assert.equal(
      link.index,
      browser.pinnedTabCount,
      "It opens first among the normal tabs"
    );
  });
});

add_task(async function test_drag_between_list_and_normal_sections() {
  await withListWindow(async (win, browser) => {
    win.gReduceMotionOverride = true;
    win.SidebarController._state.launcherExpanded = true;
    const list = browser.addTrustedTab("about:blank");
    await SimpleTest.promiseFocus(win);
    await new Promise(resolve =>
      win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))
    );
    const splitter = win.document.getElementById(
      "vertical-pinned-tabs-splitter"
    );
    Assert.ok(
      BrowserTestUtils.isVisible(splitter),
      "The empty list keeps a drop boundary"
    );
    const logDrop = event =>
      info(
        `List boundary drop: target=${event.target.id}, effect=${event.dataTransfer.dropEffect}`
      );
    browser.tabContainer.addEventListener("drop", logDrop, true);
    try {
      await dragAndDrop(list, splitter, false, win, true, win);
    } finally {
      browser.tabContainer.removeEventListener("drop", logDrop, true);
    }
    Assert.ok(
      list.listPinned,
      "Drop the first list pin onto an empty section's divider"
    );
    const normal = browser.addTrustedTab("about:blank");
    const moving = browser.addTrustedTab("about:blank");
    await new Promise(resolve =>
      win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))
    );
    await dragAndDrop(moving, list, false, win, true, win);
    Assert.ok(moving.listPinned, "Dropping a normal tab in the list pins it");
    await new Promise(resolve =>
      win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))
    );
    const rect = normal.getBoundingClientRect();
    EventUtils.synthesizeDrop(moving, normal, null, "move", win, win, {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2 + 1,
    });
    EventUtils.synthesizeMouseAtCenter(normal, { type: "mouseup" }, win);
    await TestUtils.waitForCondition(
      () => !moving.pinned,
      "Wait for the drop to remove list pinning"
    );
    Assert.ok(
      !moving.pinned,
      "Dropping a list pin in the normal section unpins it"
    );
    Assert.equal(SessionStore.getCustomTabValue(moving, "listPinned"), "");
  });
});

add_task(
  async function test_close_command_unloads_selected_but_close_button_removes_background() {
    await withListWindow(async (win, browser) => {
      const first = await listPage(browser, "?close-command");
      const second = await listPage(browser, "?background-close");
      await BrowserTestUtils.switchTab(browser, first);
      win.BrowserCommands.closeTabOrWindow({ metaKey: true });
      await TestUtils.waitForCondition(() => !first.linkedPanel);
      Assert.ok(
        first.isOpen && first.listPinned,
        "Close command preserves the selected list pin"
      );
      Assert.ok(!first.selected, "The unloaded row is no longer selected");
      Assert.ok(
        !first.hasAttribute("visuallyselected"),
        "The unloaded row is no longer visually selected"
      );
      Assert.ok(
        browser.selectedTab.hasAttribute("visuallyselected"),
        "The replacement is visually selected"
      );
      const normal = await BrowserTestUtils.openNewForegroundTab(
        browser,
        LIST_URL + "?normal"
      );
      EventUtils.synthesizeMouseAtCenter(second, { type: "mousemove" }, win);
      await new Promise(resolve => win.requestAnimationFrame(resolve));
      Assert.ok(
        BrowserTestUtils.isVisible(second.closeButton),
        "A list pin exposes its close button"
      );
      EventUtils.synthesizeMouseAtCenter(second.closeButton, {}, win);
      await TestUtils.waitForCondition(() => !second.isOpen);
      Assert.equal(
        browser.selectedTab,
        normal,
        "Closing a background list pin does not select it"
      );
    });
  }
);

add_task(async function test_inactivity_preserves_list_pinning() {
  const { TabUnloader } = ChromeUtils.importESModule(
    "moz-src:///browser/components/tabbrowser/TabUnloader.sys.mjs"
  );
  await withListWindow(async (win, browser) => {
    const old = await listPage(browser, "?inactive");
    browser.selectedTab = browser.addTrustedTab("about:blank");
    const now = Date.now();
    old.updateLastAccessed(now - 12 * 60 * 60 * 1000);
    const count = await TabUnloader.unloadInactiveTabs({
      getNow: () => now,
      *iterateTabs() {
        yield { tab: old, gBrowser: browser };
      },
    });
    Assert.equal(count, 1);
    Assert.ok(
      old.listPinned && !old.linkedPanel,
      "Automatic unloading preserves list pinning"
    );
  });
});

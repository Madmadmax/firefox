/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

Services.scriptloader.loadSubScript(
  "chrome://mochitests/content/browser/gfx/layers/apz/test/mochitest/apz_test_utils.js",
  this
);
Services.scriptloader.loadSubScript(
  "chrome://mochitests/content/browser/gfx/layers/apz/test/mochitest/apz_test_native_event_utils.js",
  this
);

add_task(async function test_native_workspace_swipes() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
      ["sidebar.animation.enabled", false],
      ["privacy.userContext.enabled", true],
      ["widget.disable-swipe-tracker", false],
      ["widget.swipe.pixel-size", 200.0],
      ["widget.swipe.success-velocity-contribution", 0.0],
      ["widget.swipe.velocity-twitch-tolerance", 0.0000001],
      ["ui.prefersReducedMotion", 0],
      ["browser.newtabpage.enabled", false],
    ],
  });
  let win = window;
  let initialTabs = new Set(gBrowser.tabs);
  let observedEvents = [];
  let eventTypes = ["MozSwipeGestureStart", "MozSwipeGestureUpdate"];
  let listener = event => observedEvents.push(event.type);
  for (let type of eventTypes) {
    win.windowRoot.addEventListener(type, listener, {
      capture: true,
      mozSystemGroup: true,
    });
  }
  try {
    let controller = win.gBrowser.containerWorkspaces;
    await TestUtils.waitForCondition(() => controller.enabled);
    await win.SidebarController.waitUntilStable();
    let switcher = win.document.querySelector("sidebar-workspace-switcher");
    await switcher.updateComplete;
    await new Promise(resolve =>
      win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))
    );
    let panel = win.document.getElementById("vertical-tabs");

    async function pan() {
      let rect = panel.getBoundingClientRect();
      await panRightToLeft(
        panel,
        rect.width / 2,
        Math.min(rect.height / 2, 100),
        3
      );
    }

    controller.switchTo(controller.workspaces[0].userContextId);
    let next = controller.workspaces[1].userContextId;
    await pan();
    await TestUtils.waitForCondition(
      () => controller.activeUserContextId == next,
      "Native pan commits the next workspace",
      50,
      40
    );
    Assert.ok(
      observedEvents.includes("MozSwipeGestureStart"),
      "Widget starts a native gesture over the tab panel"
    );
    Assert.ok(
      observedEvents.includes("MozSwipeGestureUpdate"),
      "Widget supplies live gesture progress"
    );
    let second = controller.workspaces[2].userContextId;
    await pan();
    await TestUtils.waitForCondition(
      () => controller.activeUserContextId == second,
      "The next native pan works immediately after the previous gesture",
      50,
      40
    );
    Assert.equal(
      controller.activeUserContextId,
      second,
      "Each native gesture commits once"
    );

    let historyTab = win.gBrowser.addTrustedTab("about:about", {
      userContextId: controller.activeUserContextId,
    });
    await BrowserTestUtils.browserLoaded(historyTab.linkedBrowser);
    win.gBrowser.selectedTab = historyTab;
    let loaded = BrowserTestUtils.browserLoaded(
      historyTab.linkedBrowser,
      false,
      "about:mozilla"
    );
    BrowserTestUtils.startLoadingURIString(
      historyTab.linkedBrowser,
      "about:mozilla"
    );
    await loaded;
    let active = controller.activeUserContextId;
    loaded = BrowserTestUtils.browserLoaded(
      historyTab.linkedBrowser,
      false,
      "about:about"
    );
    await panLeftToRight(historyTab.linkedBrowser, 100, 100, 3);
    await loaded;
    Assert.equal(
      controller.activeUserContextId,
      active,
      "A history swipe over the page does not change workspace"
    );
    Assert.equal(
      historyTab.linkedBrowser.currentURI.spec,
      "about:about",
      "History swipe over the page still navigates back"
    );
  } finally {
    for (let type of eventTypes) {
      win.windowRoot.removeEventListener(type, listener, {
        capture: true,
        mozSystemGroup: true,
      });
    }
    win.gBrowser.containerWorkspaces.switchTo(0);
    for (let tab of win.gBrowser.tabs) {
      if (!initialTabs.has(tab)) {
        win.gBrowser.removeTab(tab, { animate: false });
      }
    }
  }
});

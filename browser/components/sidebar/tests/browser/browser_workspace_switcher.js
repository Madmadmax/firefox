/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Must exceed SWIPE_GESTURE_GAP_MS in sidebar-workspace-switcher.mjs.
const GESTURE_GAP_MS = 200;

add_setup(async () => {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["sidebar.revamp", true],
      ["sidebar.verticalTabs", true],
      ["sidebar.animation.enabled", false],
      ["privacy.userContext.enabled", true],
      ["browser.newtabpage.enabled", false],
      // The swipe offset is off with reduced motion, which follows the OS.
      ["ui.prefersReducedMotion", 0],
    ],
  });
  await SidebarController.waitUntilStable();
  await TestUtils.waitForCondition(
    () => gBrowser.containerWorkspaces?.enabled,
    "Container workspaces are enabled"
  );

  let originalTabs = new Set(gBrowser.tabs);
  let wasExpanded = SidebarController._state.launcherExpanded;
  registerCleanupFunction(async () => {
    gBrowser.containerWorkspaces.switchTo(0);
    for (let tab of gBrowser.tabs.filter(t => !originalTabs.has(t))) {
      BrowserTestUtils.removeTab(tab);
    }
    SidebarController._state.launcherExpanded = wasExpanded;
    await SidebarController.waitUntilStable();
  });
});

function getSwitcher(win = window) {
  return win.document.querySelector("sidebar-workspace-switcher");
}

function getButtons(switcher) {
  return [...switcher.shadowRoot.querySelectorAll(".workspace-button")];
}

function firstWorkspaceId() {
  return gBrowser.containerWorkspaces.workspaces[0].userContextId;
}

function isPressed(button) {
  return button.buttonEl.getAttribute("aria-pressed") == "true";
}

function workspaceChanged(win = window) {
  return BrowserTestUtils.waitForEvent(win, "ContainerWorkspaceChanged");
}

async function setExpanded(expanded) {
  SidebarController._state.launcherExpanded = expanded;
  await SidebarController.waitUntilStable();
  let switcher = getSwitcher();
  await TestUtils.waitForCondition(
    () => switcher.expanded == expanded,
    `Switcher follows launcher expanded=${expanded}`
  );
  await switcher.updateComplete;
}

async function endGesture() {
  // A pause longer than the gesture gap starts a new swipe gesture.
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, GESTURE_GAP_MS));
}

async function wheel(
  { deltaX, deltaY = 0, steps = 4, deltaMode = WheelEvent.DOM_DELTA_PIXEL },
  win = window
) {
  await endGesture();
  let verticalTabs = win.document.getElementById("vertical-tabs");
  for (let i = 0; i < steps; i++) {
    EventUtils.synthesizeWheel(
      verticalTabs,
      10,
      10,
      { deltaMode, deltaX: deltaX / steps, deltaY: deltaY / steps },
      win
    );
  }
  await TestUtils.waitForTick();
}

add_task(async function test_switcher_renders_all_workspaces_expanded() {
  await setExpanded(true);
  let switcher = getSwitcher();
  Assert.ok(!switcher.hidden, "Switcher is shown with vertical tabs");
  await Promise.all(getButtons(switcher).map(b => b.updateComplete));

  let expected = gBrowser.containerWorkspaces.workspaces;
  Assert.deepEqual(
    getButtons(switcher).map(b => Number(b.dataset.usercontextid)),
    expected.map(w => w.userContextId),
    "One button per workspace, in controller order"
  );
  Assert.ok(
    !switcher.shadowRoot.querySelector(".workspace-overflow-button"),
    "No overflow button while expanded"
  );

  let sidebarMain = SidebarController.sidebarMain;
  Assert.ok(
    BrowserTestUtils.isHidden(
      sidebarMain.shadowRoot.querySelector(".buttons-wrapper")
    ),
    "Tools are hidden with workspaces"
  );
  Assert.lessOrEqual(
    Math.abs(
      switcher.getBoundingClientRect().bottom -
        sidebarMain.shadowRoot.querySelector(".wrapper").getBoundingClientRect()
          .bottom
    ),
    1,
    "The switcher sits at the very bottom of the launcher"
  );

  await TestUtils.waitForCondition(
    () => getButtons(switcher).every(b => b.buttonEl.title),
    "Every workspace button has an accessible name"
  );

  let pressed = getButtons(switcher).filter(isPressed);
  Assert.equal(pressed.length, 1, "Exactly one button is pressed");
  Assert.equal(
    Number(pressed[0].dataset.usercontextid),
    gBrowser.containerWorkspaces.activeUserContextId,
    "The pressed button matches the active workspace"
  );
});

add_task(async function test_collapsed_overflow_keeps_active_visible() {
  let controller = gBrowser.containerWorkspaces;
  let workspaces = controller.workspaces;
  Assert.greater(workspaces.length, 4, "Default containers cause overflow");

  await setExpanded(false);
  let lastId = workspaces.at(-1).userContextId;
  let changed = workspaceChanged();
  controller.switchTo(lastId);
  await changed;
  let switcher = getSwitcher();
  await switcher.updateComplete;

  let ids = getButtons(switcher).map(b => Number(b.dataset.usercontextid));
  Assert.equal(ids.length, 3, "Collapsed switcher shows 3 buttons");
  Assert.ok(ids.includes(lastId), "Active workspace stays visible");

  let overflowButton = switcher.shadowRoot.querySelector(
    ".workspace-overflow-button"
  );
  Assert.ok(overflowButton, "Overflow button is shown");
  let items = [...switcher.shadowRoot.querySelectorAll("panel-item")];
  Assert.deepEqual(
    [...ids, ...items.map(i => Number(i.dataset.usercontextid))].sort(),
    workspaces.map(w => w.userContextId).sort(),
    "Buttons and overflow items cover all workspaces once"
  );

  let menu = switcher.shadowRoot.querySelector("panel-list");
  let shown = BrowserTestUtils.waitForEvent(menu, "shown");
  overflowButton.click();
  await shown;
  let target = items[0];
  changed = workspaceChanged();
  target.click();
  await changed;
  Assert.equal(
    controller.activeUserContextId,
    Number(target.dataset.usercontextid),
    "Choosing an overflow item activates its workspace"
  );

  controller.switchTo(0);
  await setExpanded(true);
});

add_task(async function test_click_switches_workspace() {
  let switcher = getSwitcher();
  await switcher.updateComplete;
  let target = getButtons(switcher).find(
    b =>
      Number(b.dataset.usercontextid) !=
      gBrowser.containerWorkspaces.activeUserContextId
  );
  let targetId = Number(target.dataset.usercontextid);

  let changed = workspaceChanged();
  target.click();
  await changed;
  await switcher.updateComplete;

  Assert.equal(
    gBrowser.containerWorkspaces.activeUserContextId,
    targetId,
    "Clicking a button activates its workspace"
  );
  await target.updateComplete;
  Assert.ok(isPressed(target), "Clicked button is pressed");

  gBrowser.containerWorkspaces.switchTo(0);
});

add_task(async function test_identity_changes_update_switcher() {
  let switcher = getSwitcher();
  await switcher.updateComplete;
  let before = getButtons(switcher).length;

  let identity = ContextualIdentityService.create(
    "Workspace test",
    "fruit",
    "green"
  );
  try {
    await TestUtils.waitForCondition(
      () => getButtons(switcher).length == before + 1,
      "A new container adds a button"
    );
    let button = getButtons(switcher).find(
      b => Number(b.dataset.usercontextid) == identity.userContextId
    );
    Assert.ok(button, "New button belongs to the new container");
    Assert.equal(
      Number(getButtons(switcher).at(-1).dataset.usercontextid),
      0,
      "No Container stays last"
    );
    Assert.ok(
      button.classList.contains("identity-color-green"),
      "New button uses the container color"
    );
  } finally {
    ContextualIdentityService.remove(identity.userContextId);
  }
  await TestUtils.waitForCondition(
    () => getButtons(switcher).length == before,
    "Removing the container removes its button"
  );
});

add_task(async function test_swipe_switches_one_workspace_per_gesture() {
  let controller = gBrowser.containerWorkspaces;
  let [start, first, second] = controller.workspaces.map(w => w.userContextId);
  controller.switchTo(start);

  // Enough distance for several switches, delivered as one gesture.
  let changed = workspaceChanged();
  await wheel({ deltaX: 800, steps: 16 });
  await changed;
  Assert.equal(
    controller.activeUserContextId,
    first,
    "A long swipe moves exactly one workspace forward"
  );

  changed = workspaceChanged();
  await wheel({ deltaX: 200 });
  await changed;
  Assert.equal(
    controller.activeUserContextId,
    second,
    "A new gesture after a pause moves one more workspace"
  );

  changed = workspaceChanged();
  await wheel({ deltaX: -200 });
  await changed;
  Assert.equal(
    controller.activeUserContextId,
    first,
    "Swiping the other way moves back"
  );
});

add_task(async function test_swipe_ignored_cases() {
  let controller = gBrowser.containerWorkspaces;
  let first = firstWorkspaceId();
  controller.switchTo(first);

  await wheel({ deltaX: -200 });
  Assert.equal(
    controller.activeUserContextId,
    first,
    "Swiping back from the first workspace doesn't wrap"
  );

  await wheel({ deltaX: 40 });
  Assert.equal(
    controller.activeUserContextId,
    first,
    "A swipe below the threshold doesn't switch"
  );

  await wheel({ deltaX: 160, deltaY: 400 });
  Assert.equal(
    controller.activeUserContextId,
    first,
    "Mostly vertical scrolling doesn't switch"
  );

  await wheel({ deltaX: 20, deltaMode: WheelEvent.DOM_DELTA_LINE });
  Assert.equal(
    controller.activeUserContextId,
    first,
    "Line-based wheel events (mouse wheels) don't switch"
  );
});

// Dispatched straight to the tab strip: this covers the switcher's handling,
// while browser_workspace_native_swipe.js covers the widget delivering them.
function sendSwipeEvent(
  type,
  direction = 0,
  delta = 0,
  target = document.getElementById("vertical-tabs").firstElementChild
) {
  let event = document.createEvent("SimpleGestureEvent");
  event.initSimpleGestureEvent(
    type,
    true,
    true,
    window,
    0,
    0,
    0,
    0,
    0,
    false,
    false,
    false,
    false,
    0,
    null,
    0,
    direction,
    delta
  );
  target.dispatchEvent(event);
  return event;
}

async function completeSwipe(direction, delta) {
  let changed = workspaceChanged();
  sendSwipeEvent("MozSwipeGestureMayStart");
  sendSwipeEvent("MozSwipeGestureStart");
  sendSwipeEvent("MozSwipeGestureUpdate", 0, delta);
  sendSwipeEvent("MozSwipeGesture", direction);
  sendSwipeEvent("MozSwipeGestureEnd");
  await changed;
}

// These run after the wheel tests: once a native swipe is seen, the wheel
// fallback turns itself off for the window.
add_task(async function test_native_swipe_allowed_directions() {
  let controller = gBrowser.containerWorkspaces;
  let { DIRECTION_LEFT, DIRECTION_RIGHT } = SimpleGestureEvent;
  let first = firstWorkspaceId();
  controller.switchTo(first);

  let event = sendSwipeEvent("MozSwipeGestureMayStart");
  Assert.ok(event.defaultPrevented, "Swipe is accepted over vertical tabs");
  Assert.equal(
    event.allowedDirections,
    DIRECTION_RIGHT,
    "Only the next workspace is reachable from the first one"
  );

  let lastId = controller.workspaces.at(-1).userContextId;
  controller.switchTo(lastId);
  event = sendSwipeEvent("MozSwipeGestureMayStart");
  Assert.equal(
    event.allowedDirections,
    DIRECTION_LEFT,
    "Only the previous workspace is reachable from the last one"
  );

  controller.switchTo(first);
});

add_task(async function test_native_swipe_moves_tabs_and_switches() {
  let controller = gBrowser.containerWorkspaces;
  let { DIRECTION_LEFT, DIRECTION_RIGHT } = SimpleGestureEvent;
  let verticalTabs = document.getElementById("vertical-tabs");
  let first = firstWorkspaceId();
  controller.switchTo(first);
  let next = controller.workspaces[1].userContextId;

  sendSwipeEvent("MozSwipeGestureMayStart");
  sendSwipeEvent("MozSwipeGestureStart");
  sendSwipeEvent("MozSwipeGestureUpdate", 0, -0.3);
  Assert.ok(
    verticalTabs.hasAttribute("workspace-swiping"),
    "Tab strip follows the fingers during the swipe"
  );
  Assert.equal(
    verticalTabs.style.getPropertyValue("--workspace-swipe-progress"),
    "-0.3",
    "Swipe progress is exposed to CSS"
  );
  Assert.notEqual(
    window.getComputedStyle(gBrowser.tabContainer).translate,
    "none",
    "The tab strip renders the gesture translation"
  );

  let changed = workspaceChanged();
  sendSwipeEvent("MozSwipeGesture", DIRECTION_RIGHT);
  await changed;
  sendSwipeEvent("MozSwipeGestureEnd");
  Assert.equal(
    controller.activeUserContextId,
    next,
    "A completed swipe switches to the next workspace"
  );
  Assert.ok(
    !verticalTabs.hasAttribute("workspace-swiping"),
    "Swipe state is cleared when the gesture ends"
  );

  // A new gesture right away is not blocked by the previous one.
  changed = workspaceChanged();
  sendSwipeEvent("MozSwipeGestureMayStart");
  sendSwipeEvent("MozSwipeGestureStart");
  sendSwipeEvent("MozSwipeGestureUpdate", 0, 0.3);
  sendSwipeEvent("MozSwipeGesture", DIRECTION_LEFT);
  await changed;
  sendSwipeEvent("MozSwipeGestureEnd");
  Assert.equal(
    controller.activeUserContextId,
    first,
    "An immediate swipe back returns to the previous workspace"
  );
});

add_task(async function test_native_swipe_cancelled() {
  let controller = gBrowser.containerWorkspaces;
  let verticalTabs = document.getElementById("vertical-tabs");
  let first = firstWorkspaceId();
  controller.switchTo(first);

  sendSwipeEvent("MozSwipeGestureMayStart");
  sendSwipeEvent("MozSwipeGestureStart");
  sendSwipeEvent("MozSwipeGestureUpdate", 0, -0.1);
  sendSwipeEvent("MozSwipeGestureUpdate", 0, 0);
  sendSwipeEvent("MozSwipeGestureEnd");
  Assert.equal(
    controller.activeUserContextId,
    first,
    "A swipe that doesn't complete keeps the workspace"
  );
  Assert.ok(
    !verticalTabs.hasAttribute("workspace-swiping"),
    "Swipe state is cleared after a cancelled swipe"
  );
});

add_task(async function test_new_swipe_interrupts_settle_animation() {
  let controller = gBrowser.containerWorkspaces;
  let { DIRECTION_RIGHT } = SimpleGestureEvent;
  controller.switchTo(firstWorkspaceId());

  await completeSwipe(DIRECTION_RIGHT, -0.3);
  Assert.equal(
    gBrowser.tabContainer.getAnimations().length,
    1,
    "The new workspace slides in after a completed swipe"
  );

  sendSwipeEvent("MozSwipeGestureMayStart");
  sendSwipeEvent("MozSwipeGestureStart");
  Assert.equal(
    gBrowser.tabContainer.getAnimations().length,
    0,
    "A new swipe cancels the slide-in so it doesn't fight the fingers"
  );
  sendSwipeEvent("MozSwipeGestureEnd");
});

add_task(async function test_swipe_with_reduced_motion() {
  await SpecialPowers.pushPrefEnv({ set: [["ui.prefersReducedMotion", 1]] });
  let controller = gBrowser.containerWorkspaces;
  let { DIRECTION_RIGHT } = SimpleGestureEvent;
  let verticalTabs = document.getElementById("vertical-tabs");
  controller.switchTo(firstWorkspaceId());
  let next = controller.workspaces[1].userContextId;

  let changed = workspaceChanged();
  sendSwipeEvent("MozSwipeGestureMayStart");
  sendSwipeEvent("MozSwipeGestureStart");
  sendSwipeEvent("MozSwipeGestureUpdate", 0, -0.3);
  Assert.ok(
    !verticalTabs.hasAttribute("workspace-swiping"),
    "Tab strip stays in place with reduced motion"
  );
  sendSwipeEvent("MozSwipeGesture", DIRECTION_RIGHT);
  sendSwipeEvent("MozSwipeGestureEnd");
  await changed;
  Assert.equal(
    controller.activeUserContextId,
    next,
    "The swipe still switches workspaces"
  );
  Assert.equal(
    gBrowser.tabContainer.getAnimations().length,
    0,
    "No slide-in animation with reduced motion"
  );

  await SpecialPowers.popPrefEnv();
});

add_task(async function test_swipe_outside_vertical_tabs_ignored() {
  let controller = gBrowser.containerWorkspaces;
  let navBar = document.getElementById("nav-bar");
  let first = firstWorkspaceId();
  controller.switchTo(first);

  let event = sendSwipeEvent("MozSwipeGestureMayStart", 0, 0, navBar);
  Assert.ok(
    !event.defaultPrevented,
    "A swipe starting outside the vertical tabs isn't taken"
  );

  // Even with a swipe pending over the tabs, events aimed elsewhere (like a
  // history swipe over the page) pass through untouched.
  sendSwipeEvent("MozSwipeGestureMayStart");
  event = sendSwipeEvent("MozSwipeGestureStart", 0, 0, navBar);
  Assert.ok(
    !event.defaultPrevented,
    "Swipe events outside the vertical tabs aren't intercepted"
  );
  sendSwipeEvent("MozSwipeGestureEnd");
  Assert.equal(controller.activeUserContextId, first, "Workspace is unchanged");
});

add_task(async function test_switcher_hidden_with_horizontal_tabs() {
  let switcher = getSwitcher();
  await SpecialPowers.pushPrefEnv({ set: [["sidebar.verticalTabs", false]] });
  await TestUtils.waitForCondition(
    () => switcher.hidden,
    "Switcher hides with horizontal tabs"
  );
  await SpecialPowers.popPrefEnv();
  await TestUtils.waitForCondition(
    () => !switcher.hidden,
    "Switcher returns with vertical tabs"
  );
});

add_task(async function test_tools_return_without_workspaces() {
  let sidebarMain = SidebarController.sidebarMain;
  let switcher = getSwitcher();
  await SpecialPowers.pushPrefEnv({
    set: [["privacy.userContext.enabled", false]],
  });
  await TestUtils.waitForCondition(
    () => !sidebarMain.hasAttribute("workspaces"),
    "Workspaces turn off with containers disabled"
  );
  Assert.ok(switcher.hidden, "Switcher is hidden without containers");
  Assert.ok(
    BrowserTestUtils.isVisible(
      sidebarMain.shadowRoot.querySelector(".buttons-wrapper")
    ),
    "Tools are shown again without workspaces"
  );
  await SpecialPowers.popPrefEnv();
  await TestUtils.waitForCondition(
    () => sidebarMain.hasAttribute("workspaces"),
    "Workspaces come back with containers enabled"
  );
});

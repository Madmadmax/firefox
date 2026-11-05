/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const ENABLE_WHEN_APP_INACTIVE_PREF =
  "media.videocontrols.picture-in-picture.enable-when-app-inactive.enabled";

async function withPlayingVideo(task) {
  await SpecialPowers.pushPrefEnv({
    set: [[ENABLE_WHEN_APP_INACTIVE_PREF, true]],
  });
  let win = await BrowserTestUtils.openNewBrowserWindow();
  try {
    let tab = await BrowserTestUtils.openNewForegroundTab(
      win.gBrowser,
      TEST_PAGE
    );
    await ensureVideosReady(tab.linkedBrowser);
    await SpecialPowers.spawn(
      tab.linkedBrowser,
      ["with-controls"],
      async id => {
        let video = content.document.getElementById(id);
        video.muted = false;
        await video.play();
      }
    );
    await task(win);
  } finally {
    for (let pip of Services.wm.getEnumerator(WINDOW_TYPE)) {
      await BrowserTestUtils.closeWindow(pip);
    }
    await BrowserTestUtils.closeWindow(win);
    await SpecialPowers.popPrefEnv();
  }
}

// Losing focus opens the player for the selected tab, and activating the window
// closes it again.
add_task(async function autopip_when_app_inactive() {
  await withPlayingVideo(async win => {
    let pipOpened = BrowserTestUtils.domWindowOpenedAndLoaded(null);
    PictureInPicture.autoPipSelectedBrowser(win);
    let pipWin = await pipOpened;
    ok(pipWin, "The player opened");

    PictureInPicture.autoPipSelectedBrowser(win);
    await TestUtils.waitForTick();
    ok(!pipWin.closed, "Asking again does not toggle the open player off");

    let pipClosed = BrowserTestUtils.domWindowClosed(pipWin);
    win.dispatchEvent(new win.Event("activate"));
    await pipClosed;
    ok(true, "The player closed when the window was activated");
  });
});

// Focus moving to another window of the browser is not the browser losing focus.
add_task(async function no_autopip_when_another_window_is_active() {
  await withPlayingVideo(async win => {
    Assert.ok(Services.focus.activeWindow, "A browser window is active");
    let opened = BrowserTestUtils.domWindowOpenedAndLoaded(null).then(
      () => true
    );
    win.dispatchEvent(new win.Event("deactivate"));
    let didOpen = await Promise.race([
      opened,
      // Leave time for a wrong auto-open.
      // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
      new Promise(resolve => setTimeout(() => resolve(false), 1000)),
    ]);
    ok(!didOpen, "No player opened");
  });
});

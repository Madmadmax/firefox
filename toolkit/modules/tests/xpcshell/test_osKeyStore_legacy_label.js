/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(function test_legacy_store_label() {
  Services.prefs.setStringPref(
    "toolkit.osKeyStore.storeLabel",
    "test-legacy-store"
  );
  registerCleanupFunction(() =>
    Services.prefs.clearUserPref("toolkit.osKeyStore.storeLabel")
  );
  const { OSKeyStore } = ChromeUtils.importESModule(
    "resource://gre/modules/OSKeyStore.sys.mjs"
  );
  Assert.equal(
    OSKeyStore.STORE_LABEL,
    "test-legacy-store",
    "A renamed product can keep using its previous encrypted storage"
  );
  Services.prefs.clearUserPref("toolkit.osKeyStore.storeLabel");
  Assert.equal(
    OSKeyStore.STORE_LABEL,
    "test-legacy-store",
    "The storage key does not change while the module is in use"
  );
});

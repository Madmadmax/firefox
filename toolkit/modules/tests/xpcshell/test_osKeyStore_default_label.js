/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(function test_default_store_label() {
  const { AppConstants } = ChromeUtils.importESModule(
    "resource://gre/modules/AppConstants.sys.mjs"
  );
  const { OSKeyStore } = ChromeUtils.importESModule(
    "resource://gre/modules/OSKeyStore.sys.mjs"
  );
  Assert.equal(
    OSKeyStore.STORE_LABEL,
    AppConstants.MOZ_APP_BASENAME + " Encrypted Storage",
    "New installations use the product's own encrypted storage"
  );
});

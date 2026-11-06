# FoxA branding for macOS

FoxA is a personal Firefox fork. Mozilla license notices and attribution remain
in the browser; the application name and artwork are independent branding.

## Features

**Container workspaces (vertical tabs)**
- Each container is a workspace: the tab strip shows only the tabs of the active container.
- Switch workspaces with a horizontal two-finger swipe over the tab strip or with the container buttons at the bottom of the sidebar.
- Pinned tabs, the last used tab and the active workspace are remembered per container, including across restarts.
- The active container's color is shown as a band above the tabs.
- Links opened from other apps open in the active container.

**Pinned tabs, like in Arc**
- Besides the icon pins, tabs can be pinned to a list: they look like regular tabs, sit right under the icons and end with a divider that is always visible. Use "Pin to List" in the tab menu or drag a tab onto the divider.
- On the active list pin, "-" (and Cmd+W) unloads the tab instead of closing it; inactive list pins close with "x".
- List pins can be grouped into folders above the divider. Unloading the visible tab of a collapsed folder hides it again.

**Tabs**
- New tabs open at the top of the regular tabs, under the New Tab button.
- Links opened from a list pin, or from any tab in a group, open at the top of the regular tabs; links from a list pin open in the background. Links from other regular tabs open right below them.
- Background tabs are unloaded after 12 hours without a visit (`browser.tabs.unloadAfterInactiveMs`, `0` disables it).
- On startup only the current tab loads (or both visible pages of a split view); other tabs, including pinned ones, load when you select them.
- Tab groups look like regular tabs with a folder icon; a collapsed group keeps the tab you last used in it visible.
- Adjustable vertical tab font size, spacing, corner radius and squircle corners in `about:config` (`browser.tabs.vertical.*`).

**Other**
- `Cmd+S` shows and hides the whole sidebar, as in Arc. The sidebar toolbar button is hidden, and Save Page keeps only its menu item.
- Picture-in-Picture opens automatically when you switch tabs or containers, switch to another app or Space, or minimize the window, and closes when you come back.
- The "pick a search engine" button of the address bar is hidden outside of search mode.
- The User-Agent keeps the `Firefox/` token, so sites that check for Firefox keep working.
- `Cmd+Shift+C` copies the current page URL (the inspector stays on `Cmd+Option+C`).
- App updates, telemetry and studies are disabled by policy.

## Icons

`foxa-icon-source.png` is the approved illustration with detached pixels removed.
The original input is not modified by the generators. Run on macOS with Xcode:

```sh
python3 browser/branding/foxa/generate-icons.py
```

The generator uses Core Graphics, `iconutil`, and `actool`. It produces the UI
PNGs, legacy ICNS files, and `Assets.car` from the layered `AppIcon.icon` source.
The light translucent background is separate from the illustration. Preview
PNGs are written to `artifacts/foxa-icons/`, outside the branding source files.

## Build

The native launcher embeds the application identity, so use a native build for
the final product. This configuration keeps the existing artifact build intact:

```sh
MOZCONFIG=browser/branding/foxa/mozconfig ./mach build
make -C obj-foxa-native package MOZ_PKG_FORMAT=ZIP
```

The app is `obj-foxa-native/dist/foxa/FoxA.app`, with bundle identifier
`org.madmadmax.foxa`. This packaging workflow targets Apple Silicon.

## Personal installation

Quit FoxA and Firefox Workspaces before replacing the personal application:

```sh
MOZCONFIG=browser/branding/foxa/mozconfig \
  python3 artifacts/install-workspaces-macos.py --replace
```

The destination is `~/Applications/FoxA.app`. The existing profile remains at
`~/Library/Application Support/Firefox Workspaces/Profile`, with its cache under
`~/Library/Caches/Firefox Workspaces/Profile`. The previous application is kept;
update the Dock shortcut and the default browser setting after checking FoxA.
macOS may ask again for permissions associated with the new bundle identifier.
The personal package also sets `toolkit.osKeyStore.storeLabel` through an early
default-pref file to retain the previous `Firefox Encrypted Storage` key label.
This keeps existing encrypted autofill data accessible without copying Keychain
secrets. macOS may ask for permission to access that existing key. New release
installations use `FoxA Encrypted Storage` instead.

## Release package

Commit and publish the exact source version in the fork before distributing its
binary. A release archive contains a source link and keeps `about:license`.
The release mode uses the standard profile selected by the FoxA application
identity and does not contain the personal profile environment overrides.

```sh
MOZCONFIG=browser/branding/foxa/mozconfig \
  python3 artifacts/install-workspaces-macos.py --mode release --replace \
  --source-ref <published-tag> \
  --signing-identity 'Developer ID Application: <name> (<team>)' \
  --notary-profile foxa-notary
```

The source reference must match HEAD in a clean working tree. The signing and
notarization credentials belong in the local Keychain. Use `notarytool
store-credentials` locally; do not include passwords or tokens in this repository.
The packager uses `mach macos-sign` with `production-without-restricted`
entitlements, waits for Apple's acceptance, staples the ticket, and checks the
signature and Gatekeeper assessment before creating the final ZIP and SHA-256.
This command prepares an archive; uploading it to GitHub Releases is separate.

# FoxA branding for macOS

FoxA is a personal Firefox fork. Mozilla license notices and attribution remain
in the browser; the application name and artwork are independent branding.

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

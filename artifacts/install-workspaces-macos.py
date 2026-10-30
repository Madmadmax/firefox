#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import argparse
import configparser
import hashlib
import json
import os
import plistlib
import subprocess
import sys
import tempfile
from pathlib import Path


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def configure_bundle(stage, personal, source_commit):
    info_path = stage / "Contents/Info.plist"
    info = plistlib.loads(info_path.read_bytes())
    if info.get("CFBundleIdentifier") != "org.madmadmax.foxa":
        raise RuntimeError("Staged app is not branded as org.madmadmax.foxa")
    environment = {"MOZ_CRASHREPORTER_DISABLE": "1"}
    if personal:
        environment.update(
            MOZ_APP_DATA=str(
                Path.home() / "Library/Application Support/Firefox Workspaces"
            ),
            MOZ_LOCAL_APP_DATA=str(Path.home() / "Library/Caches/Firefox Workspaces"),
            XRE_PROFILE_PATH=str(
                Path.home() / "Library/Application Support/Firefox Workspaces/Profile"
            ),
            XRE_PROFILE_LOCAL_PATH=str(
                Path.home() / "Library/Caches/Firefox Workspaces/Profile"
            ),
        )
    info.update(
        CFBundleName="FoxA",
        CFBundleDisplayName="FoxA",
        LSEnvironment=environment,
    )
    if not personal and str(Path.home()) in json.dumps(info):
        raise RuntimeError("Personal path found in release Info.plist")
    info_path.write_bytes(plistlib.dumps(info))
    legacy_preferences = stage / "Contents/Resources/defaults/pref/foxa-profile.js"
    if personal:
        legacy_preferences.parent.mkdir(parents=True, exist_ok=True)
        legacy_preferences.write_text(
            'pref("toolkit.osKeyStore.storeLabel", "Firefox Encrypted Storage");\n'
        )
    else:
        legacy_preferences.unlink(missing_ok=True)
    preferences = {
        "sidebar.revamp": True,
        "sidebar.verticalTabs": True,
        "privacy.userContext.enabled": True,
        "browser.startup.page": 3,
        "browser.aboutwelcome.enabled": False,
        "browser.shell.checkDefaultBrowser": False,
    }
    policies = {
        "policies": {
            "DisableAppUpdate": True,
            "DisableTelemetry": True,
            "DisableFirefoxStudies": True,
            "Preferences": {
                name: {"Value": value, "Status": "default"}
                for name, value in preferences.items()
            }
            | {
                name: {"Value": False, "Status": "locked"}
                for name in (
                    "browser.crashReports.unsubmittedCheck.autoSubmit2",
                    "browser.tabs.crashReporting.sendReport",
                )
            },
        }
    }
    distribution = stage / "Contents/Resources/distribution"
    distribution.mkdir(parents=True, exist_ok=True)
    (distribution / "policies.json").write_text(json.dumps(policies, indent=2) + "\n")
    if not personal:
        (distribution / "SOURCE.txt").write_text(
            "FoxA is an independently modified browser, not a Mozilla product.\n"
            "MPL-covered source for this version:\n"
            f"https://github.com/Madmadmax/firefox/tree/{source_commit}\n"
            "License notices are available at about:license.\n"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--mode", choices=["personal", "release"], default="personal")
    parser.add_argument("--signing-identity")
    parser.add_argument("--notary-profile")
    parser.add_argument(
        "--source-ref", help="Published tag or commit matching a release build"
    )
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This installer requires macOS")
    if args.notary_profile and not args.signing_identity:
        parser.error("Notarization requires --signing-identity")
    if args.mode == "release" and not args.source_ref:
        parser.error("Release packaging requires --source-ref")

    root = Path(__file__).resolve().parent.parent
    os.chdir(root)
    environment = json.loads(
        subprocess.check_output(
            [str(root / "mach"), "environment", "--format", "json"], text=True
        )
    )
    objdir = Path(environment["topobjdir"])
    personal = args.mode == "personal"
    destination = (
        Path.home() / "Applications/FoxA.app"
        if personal
        else root / "artifacts/FoxA-release/FoxA.app"
    )
    if destination.exists() and not args.replace:
        parser.error(
            "Application already exists; use --replace to replace it while keeping its profile"
        )
    processes = subprocess.check_output(["ps", "-axww", "-o", "comm="], text=True)
    protected_apps = [destination]
    if personal:
        protected_apps.append(Path.home() / "Applications/Firefox Workspaces.app")
    if any(
        line.startswith(str(app) + "/")
        for line in processes.splitlines()
        for app in protected_apps
    ):
        parser.error(
            "Quit FoxA and Firefox Workspaces before replacing the application"
        )

    source_commit = None
    if not personal:
        source_commit = subprocess.check_output(
            ["git", "rev-parse", f"{args.source_ref}^{{commit}}"], text=True
        ).strip()
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        if (
            source_commit != head
            or subprocess.check_output(
                ["git", "status", "--porcelain"], text=True
            ).strip()
        ):
            parser.error("Release source must match HEAD in a clean working tree")

    if args.build:
        run(root / "mach", "build")
        run("make", "-C", objdir, "package", "MOZ_PKG_FORMAT=ZIP")
    source = objdir / "dist/foxa/FoxA.app"
    if not source.exists():
        parser.error("No staged application. Run this installer with --build")
    if not personal:
        application = configparser.ConfigParser(interpolation=None)
        application.read(source / "Contents/Resources/application.ini")
        if application.get("App", "SourceStamp", fallback="") != source_commit:
            parser.error(
                "Staged app source revision differs from --source-ref; rebuild and package it"
            )
    architectures = subprocess.check_output(
        [
            "lipo",
            "-archs",
            str(
                source
                / "Contents/MacOS"
                / plistlib.loads((source / "Contents/Info.plist").read_bytes())[
                    "CFBundleExecutable"
                ]
            ),
        ],
        text=True,
    ).split()
    if architectures != ["arm64"]:
        parser.error("This packager currently supports only Apple Silicon builds")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".foxa-package-", dir=destination.parent
    ) as temporary:
        stage = Path(temporary) / destination.name
        run("/usr/bin/ditto", source, stage)
        for path in stage.rglob("*"):
            if path.is_symlink() and not path.resolve().is_relative_to(stage.resolve()):
                raise RuntimeError(
                    f"Application depends on an external symlink: {path}"
                )

        configure_bundle(stage, personal, source_commit)
        if args.signing_identity:
            run(
                root / "mach",
                "macos-sign",
                "-a",
                stage,
                "-s",
                args.signing_identity,
                "-e",
                "production-without-restricted",
                "-c",
                "nightly",
            )
        else:
            run(
                "/usr/bin/codesign",
                "--force",
                "--deep",
                "--sign",
                "-",
                "--preserve-metadata=entitlements,flags,runtime",
                stage,
            )
        run("/usr/bin/codesign", "--verify", "--deep", "--strict", stage)
        if args.notary_profile:
            submission = Path(temporary) / "notarization.zip"
            run("/usr/bin/ditto", "-c", "-k", "--keepParent", stage, submission)
            result = json.loads(
                subprocess.check_output(
                    [
                        "xcrun",
                        "notarytool",
                        "submit",
                        str(submission),
                        "--keychain-profile",
                        args.notary_profile,
                        "--wait",
                        "--output-format",
                        "json",
                    ],
                    text=True,
                )
            )
            if result.get("status") != "Accepted":
                raise RuntimeError(f"Notarization was not accepted: {result}")
            run("xcrun", "stapler", "staple", stage)
            run("xcrun", "stapler", "validate", stage)
            run("/usr/bin/codesign", "--verify", "--deep", "--strict", stage)
            run("/usr/sbin/spctl", "--assess", "--type", "execute", "-vv", stage)

        backup = Path(temporary) / "previous.app"
        if destination.exists():
            destination.rename(backup)
        try:
            stage.rename(destination)
        except BaseException:
            if backup.exists():
                backup.rename(destination)
            raise

    if personal:
        run(
            "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
            "-f",
            destination,
        )

    suffix = "personal" if personal else "release"
    archive = root / f"artifacts/FoxA-macOS-arm64-{suffix}.zip"
    run(
        "/usr/bin/ditto",
        "-c",
        "-k",
        "--sequesterRsrc",
        "--keepParent",
        destination,
        archive,
    )
    with archive.open("rb") as archive_file:
        checksum = hashlib.file_digest(archive_file, "sha256").hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{checksum}  {archive.name}\n")
    print(f"Application: {destination}")
    print(f"Archive: {archive}")
    if personal:
        print(
            "Existing profile stays in ~/Library/Application Support/Firefox Workspaces/Profile"
        )
    else:
        print(f"Release source: {source_commit}")
        print(
            "Publish this source commit or tag in the fork before distributing the archive."
        )


if __name__ == "__main__":
    main()

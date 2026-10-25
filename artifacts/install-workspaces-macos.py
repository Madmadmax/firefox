#!/usr/bin/env python3

import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This installer requires macOS")

    root = Path(__file__).resolve().parent.parent
    os.chdir(root)
    objdir = root / "obj-aarch64-apple-darwin27.0.0"
    destination = Path.home() / "Applications/Firefox Workspaces.app"
    if destination.exists() and not args.replace:
        parser.error("Application already exists; use --replace to replace it while keeping its profile")
    processes = subprocess.check_output(["ps", "-axww", "-o", "comm="], text=True)
    if any(line.startswith(str(destination) + "/") for line in processes.splitlines()):
        parser.error("Quit Firefox Workspaces before replacing the application")

    if args.build:
        run(root / "mach", "build")
        run("make", "-C", objdir, "package", "MOZ_PKG_FORMAT=ZIP")
    source = objdir / "dist/firefox/Nightly.app"
    if not source.exists():
        parser.error("No staged application. Run this installer with --build")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".workspaces-install-", dir=destination.parent) as temporary:
        stage = Path(temporary) / destination.name
        run("/usr/bin/ditto", source, stage)
        for path in stage.rglob("*"):
            if path.is_symlink() and not path.resolve().is_relative_to(stage.resolve()):
                raise RuntimeError(f"Application depends on an external symlink: {path}")

        info_path = stage / "Contents/Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        info.update(
            CFBundleIdentifier="org.madmadmax.firefoxworkspaces",
            CFBundleName="Firefox Workspaces",
            CFBundleDisplayName="Firefox Workspaces",
            LSEnvironment={
                "MOZ_CRASHREPORTER_DISABLE": "1",
                "MOZ_APP_DATA": str(Path.home() / "Library/Application Support/Firefox Workspaces"),
                "MOZ_LOCAL_APP_DATA": str(Path.home() / "Library/Caches/Firefox Workspaces"),
                "XRE_PROFILE_PATH": str(Path.home() / "Library/Application Support/Firefox Workspaces/Profile"),
                "XRE_PROFILE_LOCAL_PATH": str(Path.home() / "Library/Caches/Firefox Workspaces/Profile"),
            },
        )
        info_path.write_bytes(plistlib.dumps(info))
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
                } | {
                    name: {"Value": False, "Status": "locked"}
                    for name in (
                        "browser.crashReports.unsubmittedCheck.autoSubmit2",
                        "browser.tabs.crashReporting.sendReport",
                    )
                },
            }
        }
        policy_path = stage / "Contents/Resources/distribution/policies.json"
        policy_path.parent.mkdir(parents=True, exist_ok=True)
        policy_path.write_text(json.dumps(policies, indent=2) + "\n")
        run("/usr/bin/codesign", "--force", "--deep", "--sign", "-",
            "--preserve-metadata=entitlements,flags,runtime", stage)
        run("/usr/bin/codesign", "--verify", "--deep", "--strict", stage)

        backup = Path(temporary) / "previous.app"
        if destination.exists():
            destination.rename(backup)
        try:
            stage.rename(destination)
        except BaseException:
            if backup.exists():
                backup.rename(destination)
            raise

    run("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", "-f", destination)

    archive = root / "artifacts/Firefox-Workspaces-macOS.zip"
    run("/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", destination, archive)
    print(f"Application: {destination}")
    print(f"Archive: {archive}")
    print("Profile data stays in ~/Library, outside the application and build directories.")


if __name__ == "__main__":
    main()

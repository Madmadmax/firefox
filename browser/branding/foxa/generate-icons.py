#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import shutil
import subprocess
import tempfile
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    previews = root.parents[2] / "artifacts/foxa-icons"
    with tempfile.TemporaryDirectory(prefix="foxa-icons-") as temporary_name:
        temporary = Path(temporary_name)
        subprocess.run(
            [
                "swift",
                "-module-cache-path",
                str(temporary / "module-cache"),
                str(root / "generate-icons.swift"),
                str(root),
                str(previews),
            ],
            check=True,
        )
        subprocess.run(
            ["iconutil", "-c", "icns", str(root / "firefox.iconset")], check=True
        )
        for name in ["document.icns", "disk.icns"]:
            shutil.copy2(root / "firefox.icns", root / name)
        output = temporary / "compiled"
        output.mkdir()
        subprocess.run(
            [
                "xcrun",
                "actool",
                str(root / "AppIcon.icon"),
                "--compile",
                str(output),
                "--app-icon",
                "AppIcon",
                "--platform",
                "macosx",
                "--minimum-deployment-target",
                "10.15",
                "--standalone-icon-behavior",
                "all",
                "--output-partial-info-plist",
                str(temporary / "icon-info.plist"),
                "--output-format",
                "human-readable-text",
            ],
            check=True,
        )
        shutil.copy2(output / "Assets.car", root / "Assets.car")
        rendered = temporary / "rendered.iconset"
        subprocess.run(
            [
                "iconutil",
                "-c",
                "iconset",
                "-o",
                str(rendered),
                str(output / "AppIcon.icns"),
            ],
            check=True,
        )
        largest = rendered / "icon_512x512@2x.png"
        if largest.exists():
            shutil.copy2(largest, previews / "macos-liquid-glass.png")
    shutil.rmtree(root / "firefox.iconset")


if __name__ == "__main__":
    main()

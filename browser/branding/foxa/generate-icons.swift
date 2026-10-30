// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import AppKit
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let sourceURL = root.appendingPathComponent("foxa-icon-source.png")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let logo = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fatalError("Cannot read FoxA source icon")
}

func save(_ image: CGImage, to url: URL) {
    try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fatalError("Cannot create \(url.path)")
    }
    CGImageDestinationAddImage(destination, image, nil)
    precondition(CGImageDestinationFinalize(destination))
}

func render(width: Int, height: Int, plate: Bool = false, privateMode: Bool = false, logoScale: CGFloat = 1) -> CGImage {
    let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    let edge = CGFloat(min(width, height))
    if plate {
        let inset = edge * 0.10
        let bounds = CGRect(x: inset, y: inset, width: edge - 2 * inset, height: edge - 2 * inset)
        context.saveGState()
        context.setShadow(offset: CGSize(width: 0, height: -edge * 0.006), blur: edge * 0.012,
                          color: CGColor(gray: 0, alpha: 0.15))
        context.addPath(CGPath(roundedRect: bounds, cornerWidth: edge * 0.18, cornerHeight: edge * 0.18, transform: nil))
        context.setFillColor(CGColor(srgbRed: 247 / 255, green: 247 / 255, blue: 248 / 255, alpha: 0.72))
        context.fillPath()
        context.restoreGState()
    }
    let extent = edge * (plate ? 0.624 : logoScale)
    let frame = CGRect(x: (CGFloat(width) - extent) / 2, y: (CGFloat(height) - extent) / 2,
                       width: extent, height: extent)
    context.draw(logo, in: frame)
    if privateMode {
        let badge = CGRect(x: edge * 0.60, y: edge * 0.04, width: edge * 0.36, height: edge * 0.28)
        context.setFillColor(CGColor(srgbRed: 0.35, green: 0.12, blue: 0.66, alpha: 1))
        context.fillEllipse(in: badge)
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        for x in [0.23, 0.57] {
            context.fillEllipse(in: CGRect(x: badge.minX + badge.width * x, y: badge.midY - badge.height * 0.08,
                                          width: badge.width * 0.20, height: badge.height * 0.19))
        }
    }
    return context.makeImage()!
}

for size in [16, 22, 24, 32, 48, 64, 128, 256] {
    save(render(width: size, height: size), to: root.appendingPathComponent("default\(size).png"))
}
for (name, size, privateMode) in [
    ("content/about-logo.png", 192, false), ("content/about-logo@2x.png", 384, false),
    ("content/about-logo-private.png", 192, true), ("content/about-logo-private@2x.png", 384, true),
    ("PrivateBrowsing_150.png", 300, true), ("PrivateBrowsing_70.png", 142, true),
] {
    save(render(width: size, height: size, privateMode: privateMode), to: root.appendingPathComponent(name))
}
save(render(width: 300, height: 236), to: root.appendingPathComponent("content/about.png"))
let embedded = try! Data(contentsOf: root.appendingPathComponent("content/about-logo@2x.png")).base64EncodedString()
let svg = """
<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->
<!-- codespell:ignore-next-line -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 384"><image width="384" height="384" href="data:image/png;base64,\(embedded)"/></svg>

"""
try! svg.write(to: root.appendingPathComponent("content/about-logo.svg"), atomically: true, encoding: .utf8)

let preview = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
save(render(width: 1024, height: 1024), to: preview.appendingPathComponent("logo.png"))
save(render(width: 1024, height: 1024, plate: true), to: preview.appendingPathComponent("macos-fallback.png"))
save(render(width: 1024, height: 1024, logoScale: 0.78), to: root.appendingPathComponent("AppIcon.icon/Assets/fox.png"))

let iconset = root.appendingPathComponent("firefox.iconset", isDirectory: true)
for size in [16, 32, 128, 256, 512] {
    save(render(width: size, height: size, plate: true), to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    save(render(width: size * 2, height: size * 2, plate: true), to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
print("Generated FoxA PNGs, previews, and iconset in \(root.path)")

import Foundation
import Vision
import AppKit
import CoreGraphics
import CoreImage

// Simple CLI argument parser
func getArg(_ name: String) -> String? {
    let args = CommandLine.arguments
    if let idx = args.firstIndex(of: name), idx + 1 < args.count {
        return args[idx + 1]
    }
    return nil
}

func hasFlag(_ name: String) -> Bool {
    return CommandLine.arguments.contains(name)
}

guard let imagePath = getArg("--image") else {
    fputs("Error: --image <path> is required\n", stderr)
    exit(1)
}

let mode = (getArg("--mode") ?? "face").lowercased()
let threshold = Float(getArg("--threshold") ?? "0.3") ?? 0.3
let padding = CGFloat(Double(getArg("--padding") ?? "0.2") ?? 0.2)
let feather = CGFloat(Double(getArg("--feather") ?? "8.0") ?? 8.0)
let maxTargets = Int(getArg("--max-targets") ?? "5") ?? 5
let selection = (getArg("--target-selection") ?? "largest").lowercased()
let outputMaskPath = getArg("--output-mask")

let fileURL = URL(fileURLWithPath: imagePath)
guard let nsImage = NSImage(contentsOf: fileURL),
      let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("Error: failed to load image at \(imagePath)\n", stderr)
    exit(1)
}

let imgWidth = cgImage.width
let imgHeight = cgImage.height

struct Detection: Codable {
    let index: Int
    let mode: String
    let confidence: Float
    let bounds_normalized: [CGFloat] // [x, y, width, height] in standard top-left coords (0..1)
    let bounds_pixels: [Int] // [x, y, width, height]
    let padded_pixels: [Int]
    let is_derived_roi: Bool
}

var detections: [Detection] = []
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

if mode == "face" {
    let req = VNDetectFaceRectanglesRequest()
    do {
        try handler.perform([req])
        let results = (req.results ?? []).filter { $0.confidence >= threshold }

        // Sort by area descending if selection == 'largest'
        let sorted = results.sorted { ($0.boundingBox.width * $0.boundingBox.height) > ($1.boundingBox.width * $1.boundingBox.height) }
        let selectedResults = selection == "largest" ? Array(sorted.prefix(1)) : Array(sorted.prefix(maxTargets))

        for (i, face) in selectedResults.enumerated() {
            let bb = face.boundingBox
            // Convert from Vision lower-left to standard top-left
            let normX = bb.origin.x
            let normY = 1.0 - (bb.origin.y + bb.height)
            let normW = bb.width
            let normH = bb.height

            let pxX = Int(normX * CGFloat(imgWidth))
            let pxY = Int(normY * CGFloat(imgHeight))
            let pxW = Int(normW * CGFloat(imgWidth))
            let pxH = Int(normH * CGFloat(imgHeight))

            let padW = CGFloat(pxW) * padding
            let padH = CGFloat(pxH) * padding

            let padX = max(0, Int(CGFloat(pxX) - padW / 2))
            let padY = max(0, Int(CGFloat(pxY) - padH / 2))
            let padWidth = min(imgWidth - padX, Int(CGFloat(pxW) + padW))
            let padHeight = min(imgHeight - padY, Int(CGFloat(pxH) + padH))

            detections.append(Detection(
                index: i,
                mode: "face",
                confidence: face.confidence,
                bounds_normalized: [normX, normY, normW, normH],
                bounds_pixels: [pxX, pxY, pxW, pxH],
                padded_pixels: [padX, padY, padWidth, padHeight],
                is_derived_roi: false
            ))
        }
    } catch {
        fputs("Vision face error: \(error.localizedDescription)\n", stderr)
    }
} else if mode == "hand" {
    let req = VNDetectHumanHandPoseRequest()
    req.maximumHandCount = maxTargets
    do {
        try handler.perform([req])
        let results = req.results ?? []
        for (i, hand) in results.enumerated() {
            guard let points = try? hand.recognizedPoints(.all) else { continue }
            let validPoints = points.values.filter { $0.confidence >= threshold }
            if validPoints.isEmpty { continue }

            var minX: CGFloat = 1.0
            var maxX: CGFloat = 0.0
            var minY: CGFloat = 1.0
            var maxY: CGFloat = 0.0
            var totalConf: Float = 0.0

            for pt in validPoints {
                let loc = pt.location
                // Convert lower-left to top-left
                let topX = loc.x
                let topY = 1.0 - loc.y
                minX = min(minX, topX)
                maxX = max(maxX, topX)
                minY = min(minY, topY)
                maxY = max(maxY, topY)
                totalConf += pt.confidence
            }

            let avgConf = totalConf / Float(validPoints.count)
            let normW = max(0.02, maxX - minX)
            let normH = max(0.02, maxY - minY)

            let pxX = Int(minX * CGFloat(imgWidth))
            let pxY = Int(minY * CGFloat(imgHeight))
            let pxW = Int(normW * CGFloat(imgWidth))
            let pxH = Int(normH * CGFloat(imgHeight))

            // Hand repair requires generous padding around keypoint skeleton
            let padW = max(24.0, CGFloat(pxW) * (padding + 0.3))
            let padH = max(24.0, CGFloat(pxH) * (padding + 0.3))

            let padX = max(0, Int(CGFloat(pxX) - padW / 2))
            let padY = max(0, Int(CGFloat(pxY) - padH / 2))
            let padWidth = min(imgWidth - padX, Int(CGFloat(pxW) + padW))
            let padHeight = min(imgHeight - padY, Int(CGFloat(pxH) + padH))

            detections.append(Detection(
                index: i,
                mode: "hand_derived_roi",
                confidence: avgConf,
                bounds_normalized: [minX, minY, normW, normH],
                bounds_pixels: [pxX, pxY, pxW, pxH],
                padded_pixels: [padX, padY, padWidth, padHeight],
                is_derived_roi: true
            ))
        }
    } catch {
        fputs("Vision hand error: \(error.localizedDescription)\n", stderr)
    }
} else if mode == "person" {
    if #available(macOS 12.0, *) {
        let req = VNGeneratePersonSegmentationRequest()
        req.qualityLevel = .balanced
        do {
            try handler.perform([req])
            if let maskObs = req.results?.first {
                detections.append(Detection(
                    index: 0,
                    mode: "person_segmentation",
                    confidence: 0.95,
                    bounds_normalized: [0, 0, 1.0, 1.0],
                    bounds_pixels: [0, 0, imgWidth, imgHeight],
                    padded_pixels: [0, 0, imgWidth, imgHeight],
                    is_derived_roi: false
                ))
            }
        } catch {
            fputs("Vision person segmentation error: \(error.localizedDescription)\n", stderr)
        }
    }
}

// Generate mask if output path is requested
if let maskPath = outputMaskPath {
    let colorSpace = CGColorSpaceCreateDeviceGray()
    guard let context = CGContext(
        data: nil,
        width: imgWidth,
        height: imgHeight,
        bitsPerComponent: 8,
        bytesPerRow: imgWidth,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else {
        fputs("Error: failed to create mask context\n", stderr)
        exit(1)
    }

    // Fill entire background with black (0 = keep original)
    context.setFillColor(gray: 0.0, alpha: 1.0)
    context.fill(CGRect(x: 0, y: 0, width: imgWidth, height: imgHeight))

    if mode == "person" {
        if #available(macOS 12.0, *) {
            let req = VNGeneratePersonSegmentationRequest()
            req.qualityLevel = .accurate
            try? handler.perform([req])
            if let maskObs = req.results?.first {
                let ciMask = CIImage(cvPixelBuffer: maskObs.pixelBuffer)
                let ciContext = CIContext()
                let targetRect = CGRect(x: 0, y: 0, width: imgWidth, height: imgHeight)
                let scaleX = CGFloat(imgWidth) / CGFloat(CVPixelBufferGetWidth(maskObs.pixelBuffer))
                let scaleY = CGFloat(imgHeight) / CGFloat(CVPixelBufferGetHeight(maskObs.pixelBuffer))
                let scaledMask = ciMask.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
                if let cgMask = ciContext.createCGImage(scaledMask, from: targetRect) {
                    context.draw(cgMask, in: targetRect)
                }
            }
        }
    } else {
        // Draw white regions for detected targets (255 = inpaint region)
        context.setFillColor(gray: 1.0, alpha: 1.0)
        for det in detections {
            let p = det.padded_pixels
            // CGContext origin is bottom-left, but we work in standard top-left coords
            let rectY = imgHeight - p[1] - p[3]
            let rect = CGRect(x: p[0], y: rectY, width: p[2], height: p[3])

            // Draw smooth rounded rect / ellipse to give natural inpaint boundary
            let path = CGPath(ellipseIn: rect, transform: nil)
            context.addPath(path)
            context.fillPath()
        }
    }

    if let resultImage = context.makeImage() {
        var finalImage = resultImage
        // Apply feathering blur if requested
        if feather > 0.5 {
            let ciRaw = CIImage(cgImage: resultImage)
            if let blurFilter = CIFilter(name: "CIGaussianBlur") {
                blurFilter.setValue(ciRaw, forKey: kCIInputImageKey)
                blurFilter.setValue(feather, forKey: kCIInputRadiusKey)
                if let output = blurFilter.outputImage {
                    let ciCtx = CIContext()
                    if let blurredCg = ciCtx.createCGImage(output, from: CGRect(x: 0, y: 0, width: imgWidth, height: imgHeight)) {
                        finalImage = blurredCg
                    }
                }
            }
        }

        let destURL = URL(fileURLWithPath: maskPath) as CFURL
        if let dest = CGImageDestinationCreateWithURL(destURL, "public.png" as CFString, 1, nil) {
            CGImageDestinationAddImage(dest, finalImage, nil)
            CGImageDestinationFinalize(dest)
        }
    }
}

// Output JSON
let response: [String: Any] = [
    "status": "ok",
    "image_width": imgWidth,
    "image_height": imgHeight,
    "mode": mode,
    "detections_count": detections.count,
    "detections": detections.map { d in
        return [
            "index": d.index,
            "mode": d.mode,
            "confidence": d.confidence,
            "bounds_normalized": d.bounds_normalized,
            "bounds_pixels": d.bounds_pixels,
            "padded_pixels": d.padded_pixels,
            "is_derived_roi": d.is_derived_roi
        ]
    }
]

if let jsonData = try? JSONSerialization.data(withJSONObject: response, options: [.prettyPrinted]),
   let jsonString = String(data: jsonData, encoding: .utf8) {
    print(jsonString)
}

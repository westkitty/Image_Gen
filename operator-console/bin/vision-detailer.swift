import Foundation
import Vision
import AppKit
import CoreGraphics
import CoreImage
import CoreML

// DexDiffusion native detail-target detector (Apple Vision, local, no network).
//
//   vision-detailer --image P --mode face|hand|person [options]
//
// Detections are normalised to one schema (class, confidence|null, bounds, padded ROI, area_ratio, source,
// is_derived_roi). Selection is deterministic: filter (confidence, area ratio) -> sort (area desc, confidence
// desc, x asc) -> take the largest one or the top K. All selected targets are merged into ONE mask for a single
// inpaint pass. The mask PNG is written with the backend's contract: white colour with ALPHA = painted amount
// (alpha > 0 = regenerate). `--mask-format gray` writes a plain grayscale PNG instead.
//
// Progress is reported on stderr as `DEXDETAIL_STAGE=<name>` lines so the caller can say where a slow run is
// (decode / vision / mask / encode); timings (ms) are included in the JSON.

setvbuf(stderr, nil, _IOLBF, 0)
let T0 = DispatchTime.now().uptimeNanoseconds
var timings: [String: Double] = [:]
var lastLap = T0
func stage(_ name: String) {
    let now = DispatchTime.now().uptimeNanoseconds
    timings[name] = Double(now - lastLap) / 1e6
    lastLap = now
    fputs("DEXDETAIL_STAGE=\(name)\n", stderr)
}
func fail(_ msg: String, _ code: Int32 = 1) -> Never {
    fputs("Error: \(msg)\n", stderr)
    exit(code)
}

func getArg(_ name: String) -> String? {
    let args = CommandLine.arguments
    if let idx = args.firstIndex(of: name), idx + 1 < args.count { return args[idx + 1] }
    return nil
}
func num(_ name: String, _ def: Double, _ lo: Double, _ hi: Double) -> Double {
    guard let s = getArg(name) else { return def }
    guard let v = Double(s), v.isFinite, v >= lo, v <= hi else { fail("\(name) must be a number in [\(lo), \(hi)] (got \(s))") }
    return v
}

guard let imagePath = getArg("--image") else { fail("--image <path> is required") }
let mode = (getArg("--mode") ?? "face").lowercased()
guard ["face", "hand", "person"].contains(mode) else { fail("--mode must be face, hand or person") }
let threshold = Float(num("--threshold", 0.3, 0, 1))
let padding = CGFloat(num("--padding", 0.2, 0, 3))
let featherRequested = CGFloat(num("--feather", 8.0, 0, 200))
let maxTargets = Int(num("--max-targets", 5, 1, 50))
let selection = (getArg("--target-selection") ?? "largest").lowercased()
guard ["largest", "all"].contains(selection) else { fail("--target-selection must be largest or all") }
let minArea = CGFloat(num("--min-area", mode == "person" ? 0.005 : 0.0, 0, 1))   // fraction of the image
let maxArea = CGFloat(num("--max-area", 1.0, 0, 1))
let offsetX = Int(num("--offset-x", 0, -2048, 2048))
let offsetY = Int(num("--offset-y", 0, -2048, 2048))
let morph = Int(num("--dilate", 0, -256, 256))            // >0 grow, <0 shrink (pixels)
let personQuality = (getArg("--person-quality") ?? "balanced").lowercased()
let maskFormat = (getArg("--mask-format") ?? "alpha").lowercased()
guard ["alpha", "gray"].contains(maskFormat) else { fail("--mask-format must be alpha or gray") }
let outputMaskPath = getArg("--output-mask")
// Where Vision runs its networks. `auto` lets Vision use the Apple Neural Engine; its first use compiles the model through
// `aned`/ANECompilerService, which can wedge for tens of minutes (a runaway ANECompilerService was observed blocking this tool
// inside _ANEClient doLoadModel). `cpu` never touches the ANE and is the default.
let computeMode = (getArg("--compute") ?? "cpu").lowercased()
guard ["cpu", "gpu", "auto"].contains(computeMode) else { fail("--compute must be cpu, gpu or auto") }
func pinCompute(_ req: VNRequest) {
    guard computeMode != "auto" else { return }
    if computeMode == "cpu" { req.usesCPUOnly = true }          // older switch; some requests honour only this one
    if #available(macOS 14.0, *) {
        let devices = MLComputeDevice.allComputeDevices
        var chosen: MLComputeDevice? = nil
        for d in devices {
            switch d {
            case .cpu(let c): if computeMode == "cpu" { chosen = .cpu(c) }
            case .gpu(let g): if computeMode == "gpu" { chosen = .gpu(g) }
            default: break
            }
        }
        for stage in (try? req.supportedComputeStageDevices.keys.map { $0 }) ?? [] {
            if let c = chosen { req.setComputeDevice(c, for: stage) }
        }
    }
}

stage("start")
let fileURL = URL(fileURLWithPath: imagePath)
guard let src = CGImageSourceCreateWithURL(fileURL as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else {
    fail("failed to load image at \(imagePath)")
}
let imgWidth = cgImage.width, imgHeight = cgImage.height
guard imgWidth > 0, imgHeight > 0, imgWidth * imgHeight <= 100_000_000 else { fail("unsupported image size \(imgWidth)x\(imgHeight)") }
let imageArea = CGFloat(imgWidth * imgHeight)
// A fixed-pixel blur swamps small images (8 px of a 128 px image is 6%), so the radius is capped at 2.5% of the short side.
let feather = min(featherRequested, CGFloat(min(imgWidth, imgHeight)) * 0.025)
stage("decode")

struct Candidate {
    var cls: String
    var detMode: String
    var confidence: Float?
    var x: Int, y: Int, w: Int, h: Int            // top-left pixel bounds
    var derived: Bool
    var areaRatio: CGFloat { CGFloat(w * h) / imageArea }
}
func clampRect(_ x: Int, _ y: Int, _ w: Int, _ h: Int) -> (Int, Int, Int, Int) {
    let cx = max(0, min(imgWidth - 1, x)), cy = max(0, min(imgHeight - 1, y))
    return (cx, cy, max(1, min(imgWidth - cx, w - (cx - x))), max(1, min(imgHeight - cy, h - (cy - y))))
}
func paddedRect(_ c: Candidate, extra: CGFloat = 0, minPad: CGFloat = 0) -> (Int, Int, Int, Int) {
    let padW = max(minPad, CGFloat(c.w) * (padding + extra)), padH = max(minPad, CGFloat(c.h) * (padding + extra))
    return clampRect(Int((CGFloat(c.x) - padW / 2).rounded()), Int((CGFloat(c.y) - padH / 2).rounded()), Int((CGFloat(c.w) + padW).rounded()), Int((CGFloat(c.h) + padH).rounded()))
}

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
var candidates: [Candidate] = []
var personMask: [UInt8]? = nil        // full-size, top-left, 0/255
stage("setup")

func toPixels(_ bb: CGRect) -> (Int, Int, Int, Int) {      // Vision lower-left normalised -> top-left pixels
    let x = Int((bb.origin.x * CGFloat(imgWidth)).rounded()), y = Int(((1.0 - (bb.origin.y + bb.height)) * CGFloat(imgHeight)).rounded())
    return clampRect(x, y, Int((bb.width * CGFloat(imgWidth)).rounded()), Int((bb.height * CGFloat(imgHeight)).rounded()))
}

do {
    switch mode {
    case "face":
        let req = VNDetectFaceRectanglesRequest()
        pinCompute(req)
        stage("vision-begin")
        try handler.perform([req])
        stage("vision-face")
        for f in (req.results ?? []) where f.confidence >= threshold {
            let r = toPixels(f.boundingBox)
            candidates.append(Candidate(cls: "face", detMode: "face", confidence: f.confidence, x: r.0, y: r.1, w: r.2, h: r.3, derived: false))
        }
    case "hand":
        let req = VNDetectHumanHandPoseRequest()
        req.maximumHandCount = max(maxTargets, 2)
        pinCompute(req)
        stage("vision-begin")
        try handler.perform([req])
        stage("vision-hand")
        for hand in (req.results ?? []) {
            guard let pts = try? hand.recognizedPoints(.all) else { continue }
            let valid = pts.values.filter { $0.confidence >= threshold }
            if valid.count < 3 { continue }                    // a skeleton needs several confident joints
            var minX: CGFloat = 1, maxX: CGFloat = 0, minY: CGFloat = 1, maxY: CGFloat = 0, total: Float = 0
            for p in valid {
                minX = min(minX, p.location.x); maxX = max(maxX, p.location.x)
                minY = min(minY, 1.0 - p.location.y); maxY = max(maxY, 1.0 - p.location.y)
                total += p.confidence
            }
            let nx = minX, ny = minY, nw = max(0.02, maxX - minX), nh = max(0.02, maxY - minY)
            let r = clampRect(Int((nx * CGFloat(imgWidth)).rounded()), Int((ny * CGFloat(imgHeight)).rounded()), Int((nw * CGFloat(imgWidth)).rounded()), Int((nh * CGFloat(imgHeight)).rounded()))
            candidates.append(Candidate(cls: "hand", detMode: "hand_derived_roi", confidence: total / Float(valid.count), x: r.0, y: r.1, w: r.2, h: r.3, derived: true))
        }
    default:
        let rectReq = VNDetectHumanRectanglesRequest()
        rectReq.upperBodyOnly = false
        let segReq = VNGeneratePersonSegmentationRequest()
        segReq.qualityLevel = personQuality == "fast" ? .fast : (personQuality == "accurate" ? .accurate : .balanced)
        segReq.outputPixelFormat = kCVPixelFormatType_OneComponent8
        pinCompute(rectReq); pinCompute(segReq)
        stage("vision-begin")
        try handler.perform([rectReq, segReq])
        stage("vision-person")
        // full-size segmentation mask (top-left origin)
        if let obs = segReq.results?.first {
            let pb = obs.pixelBuffer
            CVPixelBufferLockBaseAddress(pb, .readOnly)
            let pw = CVPixelBufferGetWidth(pb), ph = CVPixelBufferGetHeight(pb), bpr = CVPixelBufferGetBytesPerRow(pb)
            if let base = CVPixelBufferGetBaseAddress(pb)?.assumingMemoryBound(to: UInt8.self), pw > 0, ph > 0 {
                var full = [UInt8](repeating: 0, count: imgWidth * imgHeight)
                for y in 0..<imgHeight {
                    let sy = min(ph - 1, y * ph / imgHeight)
                    for x in 0..<imgWidth { let sx = min(pw - 1, x * pw / imgWidth); full[y * imgWidth + x] = base[sy * bpr + sx] > 127 ? 255 : 0 }
                }
                personMask = full
            }
            CVPixelBufferUnlockBaseAddress(pb, .readOnly)
        }
        let seg = personMask ?? []
        func maskFill(_ x: Int, _ y: Int, _ w: Int, _ h: Int) -> CGFloat {
            if seg.isEmpty || w <= 0 || h <= 0 { return 0 }
            var n = 0
            let step = max(1, min(w, h) / 64)
            var total = 0
            var yy = y
            while yy < y + h { var xx = x; while xx < x + w { total += 1; if seg[yy * imgWidth + xx] > 0 { n += 1 }; xx += step }; yy += step }
            return total == 0 ? 0 : CGFloat(n) / CGFloat(total)
        }
        for p in (rectReq.results ?? []) where p.confidence >= threshold {
            let r = toPixels(p.boundingBox)
            if !seg.isEmpty && maskFill(r.0, r.1, r.2, r.3) < 0.03 { continue }     // box with no person pixels inside is a false positive
            candidates.append(Candidate(cls: "person", detMode: "person", confidence: p.confidence, x: r.0, y: r.1, w: r.2, h: r.3, derived: false))
        }
        if candidates.isEmpty, !seg.isEmpty {                       // segmentation-only person (e.g. a close crop the box detector misses)
            var minX = imgWidth, maxX = -1, minY = imgHeight, maxY = -1, count = 0
            for y in 0..<imgHeight { for x in 0..<imgWidth where seg[y * imgWidth + x] > 0 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y); count += 1 } }
            if count > 0 { candidates.append(Candidate(cls: "person", detMode: "person_segmentation", confidence: nil, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, derived: false)) }
        }
        stage("person-derive")
    }
} catch {
    fail("Vision \(mode) request failed: \(error.localizedDescription)", 2)
}

// ── deterministic filtering + selection ─────────────────────────────────────
var filtered = candidates.filter { $0.areaRatio >= minArea && $0.areaRatio <= maxArea }
filtered.sort { a, b in
    if a.areaRatio != b.areaRatio { return a.areaRatio > b.areaRatio }
    let ca = a.confidence ?? -1, cb = b.confidence ?? -1
    if ca != cb { return ca > cb }
    return a.x < b.x
}
let selected = selection == "largest" ? Array(filtered.prefix(1)) : Array(filtered.prefix(maxTargets))
stage("select")

// ── mask ────────────────────────────────────────────────────────────────────
struct MaskInfo { var path: String; var format: String; var coverage: Double; var width: Int; var height: Int }
var maskInfo: MaskInfo? = nil
if let maskPath = outputMaskPath {
    // 1. raw 8-bit raster (top-left rows)
    var raw = [UInt8](repeating: 0, count: imgWidth * imgHeight)
    let gray = CGColorSpaceCreateDeviceGray()
    raw.withUnsafeMutableBytes { buf in
        guard let ctx = CGContext(data: buf.baseAddress, width: imgWidth, height: imgHeight, bitsPerComponent: 8, bytesPerRow: imgWidth, space: gray, bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return }
        ctx.setFillColor(gray: 1.0, alpha: 1.0)
        for c in selected where c.cls != "person" {
            let p = c.cls == "hand" ? paddedRect(c, extra: 0.3, minPad: 24) : paddedRect(c)
            ctx.fillEllipse(in: CGRect(x: p.0, y: imgHeight - p.1 - p.3, width: p.2, height: p.3))
        }
    }
    if mode == "person", let seg = personMask {
        for c in selected {
            let p = paddedRect(c)
            for y in p.1..<(p.1 + p.3) { for x in p.0..<(p.0 + p.2) where seg[y * imgWidth + x] > 0 { raw[y * imgWidth + x] = 255 } }
        }
    }
    stage("mask-raster")

    // 2. offset, grow/shrink, feather (Core Image; clamped so a target at the border keeps full strength)
    var cgMask: CGImage? = raw.withUnsafeMutableBytes { buf in
        CGContext(data: buf.baseAddress, width: imgWidth, height: imgHeight, bitsPerComponent: 8, bytesPerRow: imgWidth, space: gray, bitmapInfo: CGImageAlphaInfo.none.rawValue)?.makeImage()
    }
    let ciCtx = CIContext(options: [.useSoftwareRenderer: false])
    let extent = CGRect(x: 0, y: 0, width: imgWidth, height: imgHeight)
    if var ci = cgMask.map({ CIImage(cgImage: $0) }), !selected.isEmpty {
        if offsetX != 0 || offsetY != 0 { ci = ci.transformed(by: CGAffineTransform(translationX: CGFloat(offsetX), y: CGFloat(-offsetY))) }
        if morph != 0, let f = CIFilter(name: morph > 0 ? "CIMorphologyMaximum" : "CIMorphologyMinimum") {
            f.setValue(ci.clampedToExtent(), forKey: kCIInputImageKey); f.setValue(abs(morph), forKey: kCIInputRadiusKey)
            if let o = f.outputImage { ci = o }
        }
        if feather > 0.5, let f = CIFilter(name: "CIGaussianBlur") {
            f.setValue(ci.clampedToExtent(), forKey: kCIInputImageKey); f.setValue(feather, forKey: kCIInputRadiusKey)
            if let o = f.outputImage { ci = o }
        }
        cgMask = ciCtx.createCGImage(ci.cropped(to: extent), from: extent, format: .L8, colorSpace: gray)
    }
    var final = [UInt8](repeating: 0, count: imgWidth * imgHeight)
    if let m = cgMask, !selected.isEmpty {
        final.withUnsafeMutableBytes { buf in
            if let ctx = CGContext(data: buf.baseAddress, width: imgWidth, height: imgHeight, bitsPerComponent: 8, bytesPerRow: imgWidth, space: gray, bitmapInfo: CGImageAlphaInfo.none.rawValue) {
                ctx.draw(m, in: extent)
            }
        }
    }
    stage("mask-filter")

    // 3. encode: white + alpha (backend contract) or plain gray
    var painted = 0
    for v in final where v > 0 { painted += 1 }
    var outImage: CGImage? = nil
    if maskFormat == "gray" {
        outImage = final.withUnsafeMutableBytes { CGContext(data: $0.baseAddress, width: imgWidth, height: imgHeight, bitsPerComponent: 8, bytesPerRow: imgWidth, space: gray, bitmapInfo: CGImageAlphaInfo.none.rawValue)?.makeImage() }
    } else {
        var rgba = [UInt8](repeating: 0, count: imgWidth * imgHeight * 4)
        for i in 0..<(imgWidth * imgHeight) { let v = final[i]; rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = v }   // premultiplied white
        outImage = rgba.withUnsafeMutableBytes { CGContext(data: $0.baseAddress, width: imgWidth, height: imgHeight, bitsPerComponent: 8, bytesPerRow: imgWidth * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.makeImage() }
    }
    guard let img = outImage, let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: maskPath) as CFURL, "public.png" as CFString, 1, nil) else { fail("failed to create the mask image", 3) }
    CGImageDestinationAddImage(dest, img, nil)
    if !CGImageDestinationFinalize(dest) { fail("failed to write the mask PNG", 3) }
    maskInfo = MaskInfo(path: maskPath, format: maskFormat, coverage: Double(painted) / Double(imgWidth * imgHeight), width: imgWidth, height: imgHeight)
    stage("mask-encode")
}

// ── JSON ────────────────────────────────────────────────────────────────────
func detJSON(_ i: Int, _ c: Candidate) -> [String: Any] {
    let pr = c.cls == "hand" ? paddedRect(c, extra: 0.3, minPad: 24) : paddedRect(c)
    var d: [String: Any] = [
        "index": i, "class": c.cls, "mode": c.detMode, "source": "apple-vision",
        "confidence_available": c.confidence != nil,
        "bounds_normalized": [Double(c.x) / Double(imgWidth), Double(c.y) / Double(imgHeight), Double(c.w) / Double(imgWidth), Double(c.h) / Double(imgHeight)],
        "bounds_pixels": [c.x, c.y, c.w, c.h], "padded_pixels": [pr.0, pr.1, pr.2, pr.3],
        "area_ratio": Double(c.areaRatio), "is_derived_roi": c.derived,
    ]
    d["confidence"] = c.confidence.map { Double($0) } ?? NSNull()
    return d
}
var response: [String: Any] = [
    "status": "ok", "backend": "apple-vision", "image_width": imgWidth, "image_height": imgHeight, "mode": mode,
    "selection": selection, "compute": computeMode, "candidates": candidates.count, "filtered": filtered.count,
    "detections_count": selected.count, "feather_px": Double(feather), "feather_requested_px": Double(featherRequested), "detections": selected.enumerated().map { detJSON($0.offset, $0.element) },
]
if let m = maskInfo { response["mask"] = ["path": m.path, "format": m.format, "coverage": m.coverage, "width": m.width, "height": m.height] }
stage("done")
var t: [String: Double] = [:]
for (k, v) in timings { t[k] = (v * 10).rounded() / 10 }
t["total"] = (Double(DispatchTime.now().uptimeNanoseconds - T0) / 1e6 * 10).rounded() / 10
response["timings_ms"] = t
if let data = try? JSONSerialization.data(withJSONObject: response, options: [.prettyPrinted, .sortedKeys]), let s = String(data: data, encoding: .utf8) { print(s) } else { fail("could not serialise the result", 3) }

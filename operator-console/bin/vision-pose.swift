import Foundation
import Vision
import CoreGraphics
import ImageIO

// DexDiffusion pose detector for ControlNet OpenPose (Apple Vision, local, no network, no model download).
//
//   vision-pose --image P [--min-confidence 0.1] [--max-people 10]
//
// Prints one OpenPose JSON document (COCO-18 order, pixel coordinates, origin top-left) on stdout:
//   { "version": 1.3, "canvas_width": W, "canvas_height": H, "people": [ { "pose_keypoints_2d": [x,y,c x 18], ... } ] }
// A joint Vision did not find, or found below --min-confidence, is written as 0,0,0 (OpenPose "not detected").
// Subject-right joints map to OpenPose r_* joints (both use the subject's own left/right).

setvbuf(stderr, nil, _IOLBF, 0)
func fail(_ msg: String, _ code: Int32 = 1) -> Never {
    fputs("Error: \(msg)\n", stderr)
    exit(code)
}
func getArg(_ name: String) -> String? {
    let args = CommandLine.arguments
    if let idx = args.firstIndex(of: name), idx + 1 < args.count { return args[idx + 1] }
    return nil
}

guard let imagePath = getArg("--image") else { fail("--image is required", 2) }
let minConfidence = Float(getArg("--min-confidence") ?? "0.1") ?? -1
let maxPeople = Int(getArg("--max-people") ?? "10") ?? -1
if minConfidence < 0 || minConfidence > 1 { fail("--min-confidence must be between 0 and 1", 2) }
if maxPeople < 1 || maxPeople > 10 { fail("--max-people must be between 1 and 10", 2) }

let fileURL = URL(fileURLWithPath: imagePath)
guard let src = CGImageSourceCreateWithURL(fileURL as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else {
    fail("could not read the image", 3)
}
let width = cgImage.width, height = cgImage.height
if width < 16 || height < 16 || width > 8192 || height > 8192 { fail("image size \(width)x\(height) is outside 16..8192", 3) }

// OpenPose COCO-18 order: nose, neck, r_shoulder, r_elbow, r_wrist, l_shoulder, l_elbow, l_wrist,
// r_hip, r_knee, r_ankle, l_hip, l_knee, l_ankle, r_eye, l_eye, r_ear, l_ear
let order: [VNHumanBodyPoseObservation.JointName] = [
    .nose, .neck, .rightShoulder, .rightElbow, .rightWrist, .leftShoulder, .leftElbow, .leftWrist,
    .rightHip, .rightKnee, .rightAnkle, .leftHip, .leftKnee, .leftAnkle, .rightEye, .leftEye, .rightEar, .leftEar,
]

let request = VNDetectHumanBodyPoseRequest()
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do { try handler.perform([request]) } catch { fail("Vision body pose failed: \(error.localizedDescription)", 4) }

var people: [[String: Any]] = []
for obs in (request.results ?? []).prefix(maxPeople) {
    guard let points = try? obs.recognizedPoints(.all) else { continue }
    var flat: [Double] = []
    var found = 0
    for name in order {
        if let p = points[name], p.confidence >= minConfidence {
            // Vision: normalised, origin bottom-left. OpenPose: pixels, origin top-left.
            let x = min(Double(width), max(0, Double(p.location.x) * Double(width)))
            let y = min(Double(height), max(0, (1 - Double(p.location.y)) * Double(height)))
            flat += [(x * 100).rounded() / 100, (y * 100).rounded() / 100, max(0.01, min(1, (Double(p.confidence) * 1000).rounded() / 1000))]
            found += 1
        } else {
            flat += [0, 0, 0]
        }
    }
    if found >= 4 {
        people.append(["person_id": [-1], "pose_keypoints_2d": flat, "face_keypoints_2d": [], "hand_left_keypoints_2d": [], "hand_right_keypoints_2d": []])
    }
}

let doc: [String: Any] = ["version": 1.3, "canvas_width": width, "canvas_height": height, "people": people, "source": "apple-vision-body-pose"]
guard let data = try? JSONSerialization.data(withJSONObject: doc, options: []) else { fail("could not encode JSON", 5) }
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)

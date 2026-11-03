import Foundation
import Vision
import CoreML
for req in [VNDetectFaceRectanglesRequest(), VNDetectHumanHandPoseRequest(), VNDetectHumanRectanglesRequest(), VNGeneratePersonSegmentationRequest()] as [VNRequest] {
 print(String(describing:type(of:req)))
 do {
  for (stage, devices) in try req.supportedComputeStageDevices {
   print("stage", stage, "devices", devices)
  }
 } catch { print("ERROR",error) }
 req.usesCPUOnly = true
 do {
  for (stage, devices) in try req.supportedComputeStageDevices { print("CPU stage",stage,"devices",devices) }
 } catch { print("CPU ERROR",error) }
}

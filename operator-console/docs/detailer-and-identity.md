# DexDiffusion Native Apple Vision Detailer & Identity Architecture

## Overview

DexDiffusion features a local, native Apple Vision Detailer engine executed locally on the MacBook Air without requiring remote GPU compute for region detection or mask derivation. The resulting targeted masks are forwarded to the temporary-file-cleaning inpaint pipeline on Big Mac, with strict lineage tracking recorded in canonical metadata.

## Architecture & Data Flow

1. **MacBook Local Vision Detection (`operator-console/bin/vision-detailer`)**:
   - Compiled Swift CLI utilizing macOS `Vision.framework` and `CoreImage`.
   - Native modes:
     - `face`: `VNDetectFaceRectanglesRequest` (accurately detects facial features with confidence thresholds).
     - `person`: `VNDetectHumanRectanglesRequest` and `VNGeneratePersonSegmentationRequest` (upper-body and full-body masks).
     - `hand`: `VNDetectHumanHandPoseRequest`; derive the region of interest (ROI) from confident hand landmarks, not torso geometry.
   - Coordinate normalisation: Apple Vision uses bottom-left origin `(0,0)`; `vision-detailer` inverts the Y-axis to map seamlessly to standard top-left image coordinates.
   - Padding & Feathering: Applies configurable bounding box expansion (`padding: 0.25`) and Gaussian edge blur feathering (`feather: 16px`) using `CIGaussianBlur` to prevent visible seams.

2. **Temporary Inpainting Pipeline**:
   - Mask is converted to a base64 PNG data URL and transferred via `/api/detailer/run` to the inpaint execution engine.
   - Big Mac processes the inpaint job via `sdcpp-inpaint.sh` or controlled backends.
   - All ephemeral mask files, init images, and intermediate outputs on Big Mac are purged immediately upon generation.

3. **Lineage & Metadata Tracking**:
   - Every detailed image created via `/api/detailer/run` records:
     - `operation`: `'detailer'`
     - `detailed_from`: `<source_canonical_image_id>`
     - `parent`: `<source_canonical_image_id>`
     - Generation parameters (seed, steps, CFG, strength).
   - Source images are never overwritten; children are added as new canonical entries in `/Users/andrew/images_made`.

## Identity & Face-Swap Status

- **Status**: Kept strictly `UNAVAILABLE`.
- **Rationale**:
  - Face swap models (e.g. InsightFace / roop / ReActor) carry non-commercial restrictions, non-standard dependencies, and safety liabilities.
  - DexDiffusion enforces an honest capability contract: rather than shipping broken or unlicensed face swap stubs, the feature is explicitly marked `UNAVAILABLE` with clear architectural guidance in `operator-console/docs/external-capability-decisions.md`.

## Rev 18 corrections and limits

Native Vision defaults to central processing unit (CPU), with a 20-second attempt timeout and one retry. Detection under a wedged Apple Neural Engine remains UNKNOWN; a transient native timeout occurred during the current pass and is preserved. Masks are white plus alpha; backend conversion preserves alpha as grayscale, including feather falloff, and rejects conversion failure. The modal keeps actual job stages visible, persists failures, traps focus, closes with Escape and rejects late responses belonging to another image/options/dialog.

Saving-off runs send raw remote generation logs to /dev/null; local streamed logs use the shared redaction helper. Historical logs are preserved, including four pre-repair exposures discovered in this pass. Cleanup is not a blanket zero-retention claim. Face/person/hand runtime evidence, the 18-case detector matrix and reconstructed-mask preservation limitations are in OPERATIONAL_STATE Revision 18.

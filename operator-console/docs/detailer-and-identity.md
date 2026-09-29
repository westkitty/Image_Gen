# DexDiffusion Native Apple Vision Detailer & Identity Architecture

## Overview

DexDiffusion features a local, native Apple Vision Detailer engine executed locally on the MacBook Air without requiring remote GPU compute for region detection or mask derivation. The resulting targeted masks are forwarded to the zero-retention inpaint pipeline on Big Mac, with strict lineage tracking recorded in canonical metadata.

## Architecture & Data Flow

1. **MacBook Local Vision Detection (`operator-console/bin/vision-detailer`)**:
   - Compiled Swift CLI utilizing macOS `Vision.framework` and `CoreImage`.
   - Native modes:
     - `face`: `VNDetectFaceRectanglesRequest` (accurately detects facial features with confidence thresholds).
     - `person`: `VNDetectHumanRectanglesRequest` and `VNGeneratePersonSegmentationRequest` (upper-body and full-body masks).
     - `hands`: Derived region of interest (ROI) calculated from person torso coordinates and lower limb geometry.
   - Coordinate normalisation: Apple Vision uses bottom-left origin `(0,0)`; `vision-detailer` inverts the Y-axis to map seamlessly to standard top-left image coordinates.
   - Padding & Feathering: Applies configurable bounding box expansion (`padding: 0.25`) and Gaussian edge blur feathering (`feather: 16px`) using `CIGaussianBlur` to prevent visible seams.

2. **Zero-Retention Inpainting Pipeline**:
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

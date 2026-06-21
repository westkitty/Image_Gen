---
schema: sdcpp.image.v1
run_id: "<YYYYMMDD-HHMMSS-batch>"
index: 1
status: "PASS"               # PASS | FAIL
mode: "cli"                  # cli | server
api: null                    # null | "openai" | "sdapi" | "native"
preset: "fast"
seed: 42
width: 512
height: 512
steps: 8
cfg_scale: 7.0
sampler: "euler_a"
png_path: "images/image-001.png"
bytes: 480910
sha256: "<sha256 or empty>"
elapsed_seconds: "15.20"
created_at: "<ISO8601 with offset>"
---

# Image 001

![image 001](../images/image-001.png)

## Prompt
<prompt>

(negative: <negative>)

## Settings
512x512 · steps=8 · cfg=7.0 · sampler=euler_a

## Seed
42  (controlled)

## Verification
`PNG image data, 512 x 512, 8-bit/color RGB, non-interlaced` · 480910 bytes

## Paths
- png: `images/image-001.png`
- record: `records/image-001.md`

## Notes
Free-text (e.g. deterministic check result, anomalies).

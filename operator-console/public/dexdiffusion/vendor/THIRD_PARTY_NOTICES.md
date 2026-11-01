# Bundled GLB renderer third-party notices

These files are intentionally local. The DexDiffusion GLB preview must not
fetch executable scripts, mesh decoders, or model resources from a public CDN.

- GLTFLoader.js, DRACOLoader.js, BufferGeometryUtils.js,
  SkeletonUtils.js and three.module.js / three.core.js derive from the
  installed three npm distribution, version 0.186.x. License: MIT;
  see LICENSE-THREE.txt. The loader/utils module-import specifiers were
  adapted to use this local static vendor directory.
- meshopt_decoder.module.js derives from the meshoptimizer decoder shipped
  in the installed Three.js distribution. Its source header identifies
  Meshoptimizer 1.1 and copyright 2016-2026 Arseny Kapoulkine.
  License: MIT; see LICENSE-MESHOPT.txt.
- draco/draco_decoder.js, draco/draco_decoder.wasm and
  draco/draco_wasm_wrapper.js are distributed in Three.js from
  Google Draco. License: Apache 2.0; see draco/LICENSE.txt.
  Upstream: https://github.com/google/draco
- The browser preview source enforces self-contained GLBs and local decoder
  paths. Neither this notice nor installed decoder bytes establish that any
  compressed asset has passed real native WebKit playback tests.

Preserve the licenses when redistributing this vendor directory.

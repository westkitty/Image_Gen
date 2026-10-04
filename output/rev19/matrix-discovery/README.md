# Interrupted discovery evidence

This discovery attempt was stopped after identifying asynchronous harness timing defects. Its measured cells and failure records are preserved in `interaction-matrix.json`; unexecuted cells are not represented as passes.

The native-control harness now waits for dependent DOM updates, restores checkbox/select state, and waits actual screen request completion before interacting with modal openers. Initial popup focus is measured after the component's scheduled focus transfer. Corrected affected development slice: `../matrix-dev-13/interaction-matrix.json`. Final full specification result: `../matrix-final/interaction-matrix.json`.

These discovery timing failures do not receive product defect IDs. They are retained to explain the acceptance oracle corrections.

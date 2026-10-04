# Executable interaction matrix
Specification version 1. Required base cells: 180. Measured cells: 2.
{"PASS":1,"FAIL":1,"N/A":0,"BLOCKED":0}
Scope: Rendered screen with deterministic owned image and API fixtures; all native controls, rendered details, model pickers and available fullscreen dialogs. No generation, system mutation or durable project writes. Native form validation is exercised only on fields declaring constraints. Ellipsis labels and scrollable navigation are intentional geometry exceptions.

| Cell | Status | Failed contracts |
|---|---|---|
| V2/1280x800/Edit Compact | PASS |  |
| V2/1280x800/Edit Studio | FAIL | layout: Control intersection ["SD1.5 standardSD 1.5Proven▾","Run Inpaint",468,11] / studio-rail-geometry: Strength/Run overlap 422x13 |

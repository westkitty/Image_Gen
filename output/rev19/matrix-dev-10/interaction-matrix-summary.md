# Executable interaction matrix
Specification version 1. Required base cells: 180. Measured cells: 4.
{"PASS":3,"FAIL":1,"N/A":0,"BLOCKED":0}
Scope: Rendered screen with deterministic owned image and API fixtures; all native controls, rendered details, model pickers and available fullscreen dialogs. No generation, system mutation or durable project writes. Native form validation is exercised only on fields declaring constraints. Ellipsis labels and scrollable navigation are intentional geometry exceptions.

| Cell | Status | Failed contracts |
|---|---|---|
| V1/375x812/Create | PASS |  |
| V1/375x812/Edit Compact | PASS |  |
| V1/1280x800/Library | FAIL | dialogs: [data-detailer-dialog] Escape did not close |
| V1/1280x800/Enhance | PASS |  |

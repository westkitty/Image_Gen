# Executable interaction matrix
Specification version 1. Required base cells: 180. Measured cells: 1.
{"PASS":0,"FAIL":0,"N/A":0,"BLOCKED":1}
Scope: Rendered screen with deterministic owned image and API fixtures; all native controls, rendered details, model pickers and available fullscreen dialogs. No generation, system mutation or durable project writes. Native form validation is exercised only on fields declaring constraints. Ellipsis labels and scrollable navigation are intentional geometry exceptions.

| Cell | Status | Failed contracts |
|---|---|---|
| V1/1280x800/Library | BLOCKED | execution: locator.waitFor: Timeout 3000ms exceeded. |

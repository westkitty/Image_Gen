#!/usr/bin/env python3
"""Enumerate A1111 generation-relevant controls from a pinned source checkout.

Reads source with `ast` only (nothing upstream is imported or executed) and
writes a JSON inventory of:
  - Gradio components with a label in the generation UIs, stock scripts,
    processing scripts and built-in extensions;
  - OptionInfo settings in shared_options.py, tagged with their section;
  - registered samplers and schedulers.

Usage: python3 -I enumerate_a1111.py <a1111_checkout> <out.json>
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

UI_FILES = [
    "modules/ui.py",
    "modules/ui_toprow.py",
    "modules/ui_postprocessing.py",
    "modules/ui_common.py",
    "modules/ui_extra_networks.py",
]
GLOB_FILES = [
    "scripts/*.py",
    "modules/processing_scripts/*.py",
    "extensions-builtin/*/scripts/*.py",
]
# Training and checkpoint merging are the only scope exclusions.
EXCLUDED_FILES = {"modules/ui_checkpoint_merger.py"}
EXCLUDED_SECTIONS = {"training"}
COMPONENTS = {
    "Textbox", "Slider", "Number", "Checkbox", "CheckboxGroup", "Dropdown",
    "Radio", "Image", "File", "Button", "ColorPicker", "Gallery",
    "InputAccordion", "ToolButton", "FormColorPicker",
}


def _const(node: ast.AST | None):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(v.value if isinstance(v, ast.Constant) else "{}" for v in node.values)
    return None


def _call_name(call: ast.Call) -> str:
    f = call.func
    if isinstance(f, ast.Attribute):
        return f.attr
    if isinstance(f, ast.Name):
        return f.id
    return ""


def components(root: Path, rel: str) -> list[dict]:
    tree = ast.parse((root / rel).read_text(encoding="utf-8"), filename=rel)
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = _call_name(node)
        if name not in COMPONENTS:
            continue
        kw = {k.arg: k.value for k in node.keywords if k.arg}
        label = _const(kw.get("label"))
        if not label and isinstance(kw.get("label"), ast.Attribute):
            label = "<" + kw["label"].attr + ">"
        if not label and name in ("Button", "ToolButton"):
            label = _const(kw.get("value"))
        if not label and node.args:
            label = _const(node.args[0]) if name in ("Button", "ToolButton", "InputAccordion", "Checkbox") else None
        if not label:
            continue
        out.append({
            "kind": "component",
            "file": rel,
            "line": node.lineno,
            "component": name,
            "label": str(label),
            "elem_id": _const(kw.get("elem_id")),
        })
    return out


def options(root: Path) -> list[dict]:
    rel = "modules/shared_options.py"
    tree = ast.parse((root / rel).read_text(encoding="utf-8"), filename=rel)
    out = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and _call_name(node) == "options_section"):
            continue
        if len(node.args) < 2 or not isinstance(node.args[0], ast.Tuple):
            continue
        section = _const(node.args[0].elts[0])
        title = _const(node.args[0].elts[1])
        body = node.args[1]
        if not isinstance(body, ast.Dict):
            continue
        for key, value in zip(body.keys, body.values):
            k = _const(key)
            if k is None or not isinstance(value, ast.Call):
                continue
            # OptionInfo(default, label, ...) possibly wrapped in .info()/.needs_reload_ui() chains
            call = value
            while isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Call):
                call = call.func.value
            if _call_name(call) not in ("OptionInfo", "OptionHTML", "OptionDiv"):
                continue
            label = _const(call.args[1]) if len(call.args) > 1 else None
            out.append({
                "kind": "setting",
                "file": rel,
                "line": value.lineno,
                "section": section,
                "section_title": title,
                "key": k,
                "label": label,
                "excluded": section in EXCLUDED_SECTIONS,
            })
    return out


def extension_options(root: Path) -> list[dict]:
    """OptionInfo registered by built-in extensions (outside shared_options.py)."""
    out = []
    for path in sorted(root.glob("extensions-builtin/*/scripts/*.py")):
        rel = str(path.relative_to(root))
        if "postprocessing-for-training" in rel:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=rel)
        for node in ast.walk(tree):
            if isinstance(node, ast.Dict):
                pairs = zip(node.keys, node.values)
            elif isinstance(node, ast.Call) and _call_name(node) == "add_option" and len(node.args) >= 2:
                pairs = [(node.args[0], node.args[1])]
            else:
                continue
            for key, value in pairs:
                k = _const(key)
                call = value
                while isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Call):
                    call = call.func.value
                if not (isinstance(k, str) and isinstance(call, ast.Call) and _call_name(call) == "OptionInfo"):
                    continue
                label = _const(call.args[1]) if len(call.args) > 1 else None
                out.append({"kind": "setting", "file": rel, "line": value.lineno,
                            "section": "extension:" + rel.split("/")[1], "section_title": rel.split("/")[1],
                            "key": k, "label": label, "excluded": False})
    return out


def xyz_axes(root: Path) -> list[dict]:
    rel = "scripts/xyz_grid.py"
    tree = ast.parse((root / rel).read_text(encoding="utf-8"), filename=rel)
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _call_name(node) in ("AxisOption", "AxisOptionImg2Img", "AxisOptionTxt2Img") and node.args:
            out.append({"kind": "xyz_axis", "file": rel, "line": node.lineno, "label": _const(node.args[0]),
                        "mode": {"AxisOption": "both", "AxisOptionImg2Img": "img2img", "AxisOptionTxt2Img": "txt2img"}[_call_name(node)]})
    return out


def samplers(root: Path) -> list[dict]:
    out = []
    for rel in ("modules/sd_samplers_kdiffusion.py", "modules/sd_samplers_timesteps.py", "modules/sd_samplers_lcm.py"):
        tree = ast.parse((root / rel).read_text(encoding="utf-8"), filename=rel)
        for node in ast.walk(tree):
            if isinstance(node, ast.Tuple) and node.elts and isinstance(node.elts[0], ast.Constant) \
                    and isinstance(node.elts[0].value, str) and len(node.elts) >= 3 \
                    and isinstance(node.elts[2], ast.List):
                out.append({"kind": "sampler", "file": rel, "line": node.lineno, "label": node.elts[0].value})
    rel = "modules/sd_schedulers.py"
    tree = ast.parse((root / rel).read_text(encoding="utf-8"), filename=rel)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _call_name(node) == "Scheduler" and len(node.args) >= 2:
            out.append({"kind": "scheduler", "file": rel, "line": node.lineno,
                        "key": _const(node.args[0]), "label": _const(node.args[1])})
    return out


def main(argv: list[str]) -> int:
    root = Path(argv[1]).resolve()
    files = list(UI_FILES)
    for pattern in GLOB_FILES:
        files += sorted(str(p.relative_to(root)) for p in root.glob(pattern))
    items: list[dict] = []
    for rel in files:
        if rel in EXCLUDED_FILES or "postprocessing-for-training" in rel:
            continue
        items += components(root, rel)
    items += options(root)
    items += extension_options(root)
    items += samplers(root)
    items += xyz_axes(root)
    Path(argv[2]).write_text(json.dumps({
        "schema": "dexdiffusion.a1111.upstream-inventory.v1",
        "source_root_files": files,
        "items": items,
    }, indent=1) + "\n", encoding="utf-8")
    print(len(items))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

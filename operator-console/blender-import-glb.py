"""
blender-import-glb.py — imports a canonical GLB asset into a new visible Blender session.
Invoked via:
  Blender --python operator-console/blender-import-glb.py -- <glb_path> [receipt_path]
"""
import sys
import os
import json
import datetime
from pathlib import Path
import bpy

def frame_and_shade():
    """Timer callback to ensure framing and Material Preview apply once GUI layout is ready."""
    try:
        mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
        for obj in mesh_objects:
            obj.select_set(True)
        if mesh_objects:
            bpy.context.view_layer.objects.active = mesh_objects[0]

        for window in bpy.context.window_manager.windows:
            screen = window.screen
            for area in screen.areas:
                if area.type == 'VIEW_3D':
                    space = area.spaces.active
                    if space and hasattr(space, 'shading'):
                        try:
                            space.shading.type = 'MATERIAL'
                        except Exception:
                            pass
                    for region in area.regions:
                        if region.type == 'WINDOW':
                            try:
                                with bpy.context.temp_override(window=window, screen=screen, area=area, region=region):
                                    bpy.ops.view3d.view_selected(use_all_regions=False)
                            except Exception:
                                pass
                            break
    except Exception:
        pass
    return None

def main():
    try:
        marker = sys.argv.index('--')
        args = sys.argv[marker + 1:]
    except ValueError:
        args = []

    glb_arg = args[0] if len(args) > 0 else os.environ.get('DEX_BLENDER_GLB_PATH')
    receipt_arg = args[1] if len(args) > 1 else os.environ.get('DEX_BLENDER_RECEIPT_PATH')

    if not glb_arg:
        raise RuntimeError("Expected exactly one GLB filepath after '--'")

    glb = Path(glb_arg).expanduser().resolve()
    if not glb.is_file():
        raise FileNotFoundError(f"GLB asset not found: {glb}")
    if glb.suffix.lower() != '.glb':
        raise RuntimeError(f"Expected .glb asset, got {glb.suffix}")

    # 1. Clear startup scene (Cube, Camera, Light) so default geometry does not confuse the user
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat, do_unlink=True)

    # 2. Explicitly IMPORT glTF scene
    print(f"[DexDiffusion] Importing GLB: {glb}")
    result = bpy.ops.import_scene.gltf(filepath=str(glb))
    if 'FINISHED' not in result:
        raise RuntimeError(f"glTF import failed: {result}")

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not meshes:
        raise RuntimeError("glTF import completed but produced no mesh objects")

    # 3. Select imported meshes and set active
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    # 4. Immediate framing & material shading pass
    frame_and_shade()

    # 5. Register timer callback for GUI layout readiness
    try:
        bpy.app.timers.register(frame_and_shade, first_interval=0.25)
    except Exception:
        pass

    total_vertices = sum(len(m.vertices) for m in bpy.data.meshes)
    total_polygons = sum(len(m.polygons) for m in bpy.data.meshes)

    # 6. Record stdout proof
    print(
        "DEX_3D_BLENDER_IMPORT_PASS",
        f"file={glb}",
        f"meshes={len(meshes)}",
        f"vertices={total_vertices}",
        f"polygons={total_polygons}",
        f"materials={len(bpy.data.materials)}",
        f"images={len(bpy.data.images)}",
        flush=True,
    )

    # 7. Write JSON receipt if path provided
    if receipt_arg:
        try:
            receipt = {
                "artifact": str(glb),
                "importedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "meshCount": len(meshes),
                "meshes": [
                    {
                        "name": m.name,
                        "vertexCount": len(m.vertices),
                        "polygonCount": len(m.polygons)
                    } for m in bpy.data.meshes
                ],
                "totalVertices": total_vertices,
                "totalPolygons": total_polygons,
                "materialCount": len(bpy.data.materials),
                "materials": [m.name for m in bpy.data.materials],
                "imageCount": len([i for i in bpy.data.images if i.name not in ('Render Result', 'Viewer Node')]),
                "images": [i.name for i in bpy.data.images if i.name not in ('Render Result', 'Viewer Node')],
                "defaultCubePresent": any(o.name == 'Cube' for o in bpy.data.objects)
            }
            os.makedirs(os.path.dirname(os.path.abspath(receipt_arg)), exist_ok=True)
            with open(receipt_arg, 'w', encoding='utf-8') as f:
                json.dump(receipt, f, indent=2)
            print(f"[DexDiffusion] Receipt written to {receipt_arg}")
        except Exception as e:
            print(f"[DexDiffusion] Warning: Failed to write receipt: {e}", file=sys.stderr)

if __name__ == '__main__':
    main()

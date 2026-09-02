"""Read the JSON chunk of a .vrm/.glb and summarise it (no Blender dependency).

Usage (plain Python or inside Blender):
    python tools/vrm/vrm_manifest.py model.vrm [--json out.json]
"""

import json
import struct
import sys


def read_glb_json(path):
    with open(path, "rb") as f:
        magic, version, length = struct.unpack("<4sII", f.read(12))
        if magic != b"glTF":
            raise ValueError(f"{path}: not a GLB (magic={magic!r})")
        chunk_len, chunk_type = struct.unpack("<II", f.read(8))
        if chunk_type != 0x4E4F534A:  # 'JSON'
            raise ValueError("first chunk is not JSON")
        data = f.read(chunk_len)
    return json.loads(data.decode("utf-8"))


def manifest(path):
    g = read_glb_json(path)
    ext = g.get("extensions", {})
    vrm = ext.get("VRMC_vrm", {})
    spring = ext.get("VRMC_springBone", {})
    nodes = g.get("nodes", [])
    skins = g.get("skins", [])
    joints = sorted({j for s in skins for j in s.get("joints", [])})

    humanoid = {}
    for hb, v in vrm.get("humanoid", {}).get("humanBones", {}).items():
        idx = v.get("node")
        humanoid[hb] = nodes[idx].get("name") if idx is not None and idx < len(nodes) else idx

    springs = []
    for s in spring.get("springs", []):
        js = s.get("joints", [])
        first = js[0] if js else {}
        springs.append(
            {
                "name": s.get("name"),
                "joints": [nodes[j["node"]].get("name") for j in js],
                "stiffness": first.get("stiffness"),
                "dragForce": first.get("dragForce"),
                "gravityPower": first.get("gravityPower"),
                "gravityDir": first.get("gravityDir"),
                "hitRadius": first.get("hitRadius"),
                "colliderGroups": s.get("colliderGroups", []),
            }
        )

    expressions = {"preset": {}, "custom": {}}
    ex = vrm.get("expressions", {})
    for kind in ("preset", "custom"):
        for name, e in ex.get(kind, {}).items():
            expressions[kind][name] = {
                "morphTargetBinds": len(e.get("morphTargetBinds", [])),
                "materialColorBinds": len(e.get("materialColorBinds", [])),
                "textureTransformBinds": [
                    {
                        "material": g["materials"][b["material"]].get("name"),
                        "offset": b.get("offset"),
                        "scale": b.get("scale"),
                    }
                    for b in e.get("textureTransformBinds", [])
                ],
                "isBinary": e.get("isBinary", False),
            }

    materials = []
    for m in g.get("materials", []):
        mt = m.get("extensions", {}).get("VRMC_materials_mtoon")
        materials.append(
            {
                "name": m.get("name"),
                "mtoon": mt is not None,
                "shadeColorFactor": mt.get("shadeColorFactor") if mt else None,
                "outlineWidthMode": mt.get("outlineWidthMode") if mt else None,
                "outlineWidthFactor": mt.get("outlineWidthFactor") if mt else None,
                "outlineColorFactor": mt.get("outlineColorFactor") if mt else None,
                "alphaMode": m.get("alphaMode", "OPAQUE"),
            }
        )

    tris = 0
    accessors = g.get("accessors", [])
    for mesh in g.get("meshes", []):
        for prim in mesh.get("primitives", []):
            mode = prim.get("mode", 4)
            if "indices" in prim:
                count = accessors[prim["indices"]]["count"]
            else:
                count = accessors[prim["attributes"]["POSITION"]]["count"]
            if mode == 4:
                tris += count // 3
            elif mode in (5, 6):
                tris += max(count - 2, 0)

    return {
        "file": path,
        "extensionsUsed": g.get("extensionsUsed", []),
        "vrmSpecVersion": vrm.get("specVersion"),
        "meta": {k: vrm.get("meta", {}).get(k) for k in ("name", "version", "authors", "licenseUrl")},
        "nodeCount": len(nodes),
        "boneCount": len(joints),
        "meshCount": len(g.get("meshes", [])),
        "triangleCount": tris,
        "imageCount": len(g.get("images", [])),
        "humanoid": humanoid,
        "humanoidCount": len(humanoid),
        "springs": springs,
        "springColliders": len(spring.get("colliders", [])),
        "springColliderGroups": len(spring.get("colliderGroups", [])),
        "expressions": expressions,
        "materials": materials,
    }


def print_manifest(m):
    print("=== VRM manifest ===")
    print(f"file: {m['file']}")
    print(f"spec: VRM {m['vrmSpecVersion']}  extensions: {m['extensionsUsed']}")
    print(f"meta: {m['meta']}")
    print(
        f"nodes={m['nodeCount']} bones(skin joints)={m['boneCount']} meshes={m['meshCount']} "
        f"triangles={m['triangleCount']} images={m['imageCount']}"
    )
    print(f"humanoid bones mapped: {m['humanoidCount']}")
    for k, v in m["humanoid"].items():
        print(f"  {k:24s} -> {v}")
    print(f"spring chains: {len(m['springs'])}  colliders={m['springColliders']} groups={m['springColliderGroups']}")
    for s in m["springs"]:
        print(
            f"  {s['name']}: {len(s['joints'])} joints stiff={s['stiffness']} drag={s['dragForce']} "
            f"grav={s['gravityPower']} r={s['hitRadius']} :: {s['joints'][0]} .. {s['joints'][-1]}"
        )
    for kind in ("preset", "custom"):
        ex = m["expressions"][kind]
        print(f"expressions.{kind}: {len(ex)}")
        for name, e in ex.items():
            print(
                f"  {name:12s} morph={e['morphTargetBinds']} matcolor={e['materialColorBinds']} "
                f"texxform={[(b['material'], b['offset']) for b in e['textureTransformBinds']]} binary={e['isBinary']}"
            )
    print(f"materials: {len(m['materials'])}")
    for mat in m["materials"]:
        print(
            f"  {mat['name']:28s} mtoon={mat['mtoon']} shade={mat['shadeColorFactor']} "
            f"outline={mat['outlineWidthMode']}/{mat['outlineWidthFactor']} alpha={mat['alphaMode']}"
        )


if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    out = None
    if "--json" in args:
        i = args.index("--json")
        out = args[i + 1]
        del args[i : i + 2]
    m = manifest(args[0])
    print_manifest(m)
    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(m, f, indent=2)
        print(f"manifest written: {out}")

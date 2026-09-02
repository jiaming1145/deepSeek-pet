"""Headless install of the VRM add-on (saturday06/VRM-Addon-for-Blender) into Blender >= 4.2.

Run:
  blender --background --python tools/vrm/install_vrm_addon.py -- [--zip PATH] [--version 4.5.0]

Strategy:
  1. Try the official extension operator (bpy.ops.extensions.package_install_files) against the
     "user_default" repository.
  2. If that fails in background mode, unzip the extension directly into
     <user extensions dir>/user_default/vrm  (this is the layout the add-on's own README documents
     for development links), then enable module "bl_ext.user_default.vrm".
  3. Save user preferences so later --background runs have it enabled, and prove
     bpy.ops.import_scene.vrm / bpy.ops.export_scene.vrm exist.

Exit code 0 only if the operators are present.
"""

import argparse
import os
import shutil
import sys
import urllib.request
import zipfile

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_VERSION = "4.5.0"
MODULE = "bl_ext.user_default.vrm"


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--zip", default=None, help="Extension zip; downloaded into vendor/ if missing")
    p.add_argument("--version", default=DEFAULT_VERSION)
    return p.parse_args(argv)


def ensure_zip(path, version):
    if path is None:
        path = os.path.join(
            HERE, "vendor", f"VRM_Addon_for_Blender-Extension-{version.replace('.', '_')}.zip"
        )
    if not os.path.exists(path):
        url = (
            "https://github.com/saturday06/VRM-Addon-for-Blender/releases/download/"
            f"v{version}/VRM_Addon_for_Blender-Extension-{version.replace('.', '_')}.zip"
        )
        print(f"[install] downloading {url}")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(url, path)
    return path


def manifest_versions(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        text = z.read("blender_manifest.toml").decode("utf-8")
    lo = hi = None
    for line in text.splitlines():
        if line.startswith("blender_version_min"):
            lo = line.split("=")[1].strip().strip('"')
        if line.startswith("blender_version_max"):
            hi = line.split("=")[1].strip().strip('"')
    return lo, hi


def vtuple(s):
    return tuple(int(x) for x in s.split("."))


def user_extensions_dir():
    # bpy.utils.user_resource('EXTENSIONS') exists in 4.2+
    return bpy.utils.user_resource("EXTENSIONS")


def try_operator_install(zip_path):
    try:
        res = bpy.ops.extensions.package_install_files(
            filepath=zip_path, repo="user_default", enable_on_install=True, overwrite=True
        )
        print(f"[install] extensions.package_install_files -> {res}")
        return "FINISHED" in res
    except Exception as e:  # noqa: BLE001
        print(f"[install] operator install failed: {e!r}")
        return False


def manual_install(zip_path):
    dest = os.path.join(user_extensions_dir(), "user_default", "vrm")
    print(f"[install] manual extract -> {dest}")
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(dest, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(dest)
    # make sure the repo is registered and refreshed
    try:
        bpy.ops.extensions.repo_refresh_all()
    except Exception as e:  # noqa: BLE001
        print(f"[install] repo_refresh_all: {e!r}")
    return dest


def enable():
    import addon_utils

    addon_utils.modules(refresh=True)
    try:
        bpy.ops.preferences.addon_enable(module=MODULE)
    except Exception as e:  # noqa: BLE001
        print(f"[install] addon_enable failed: {e!r}")
    try:
        bpy.ops.wm.save_userpref()
    except Exception as e:  # noqa: BLE001
        print(f"[install] save_userpref failed: {e!r}")


def verify():
    has_import = hasattr(bpy.types, "IMPORT_SCENE_OT_vrm")
    has_export = hasattr(bpy.types, "EXPORT_SCENE_OT_vrm")
    enabled = MODULE in bpy.context.preferences.addons
    print(f"[verify] blender={bpy.app.version_string}")
    print(f"[verify] addon enabled in prefs: {enabled}")
    print(f"[verify] bpy.ops.import_scene.vrm exists: {has_import}")
    print(f"[verify] bpy.ops.export_scene.vrm exists: {has_export}")
    ver = None
    try:
        import importlib

        mod = importlib.import_module(MODULE)
        ver = getattr(mod, "bl_info", {}).get("version") or "manifest 4.x"
        # extension manifest version
        mpath = os.path.join(os.path.dirname(mod.__file__), "blender_manifest.toml")
        if os.path.exists(mpath):
            for line in open(mpath, encoding="utf-8"):
                if line.startswith("version"):
                    ver = line.split("=")[1].strip().strip('"')
    except Exception as e:  # noqa: BLE001
        print(f"[verify] module import: {e!r}")
    print(f"[verify] addon version: {ver}")
    return has_import and has_export


def main():
    args = parse_args()
    zip_path = ensure_zip(args.zip, args.version)
    lo, hi = manifest_versions(zip_path)
    cur = bpy.app.version
    print(f"[install] zip={zip_path} supports Blender [{lo}, {hi}) ; running {bpy.app.version_string}")
    if lo and cur < vtuple(lo) or hi and cur >= vtuple(hi):
        print("[install] ERROR: this Blender version is outside the add-on's supported range")
        sys.exit(2)

    if verify():
        print("[install] already installed and enabled; nothing to do")
        return

    ok = try_operator_install(zip_path)
    if not ok or not verify():
        manual_install(zip_path)
    # --background never autosaves preferences: enable + save explicitly so fresh runs keep it.
    enable()
    if not verify():
        print("[install] FAILED")
        sys.exit(1)
    print("[install] OK")


if __name__ == "__main__":
    main()

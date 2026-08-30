from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SKILLS = ROOT / ".agents" / "skills"
TEMPLATE = ROOT / "plugin-template" / ".codex-plugin" / "plugin.json"
DIST = ROOT / "dist"
PLUGIN = DIST / "live2d-production-plugin"
ARCHIVE = DIST / "live2d-production-plugin.zip"


def main() -> None:
    if PLUGIN.exists():
        shutil.rmtree(PLUGIN)
    DIST.mkdir(parents=True, exist_ok=True)
    (PLUGIN / ".codex-plugin").mkdir(parents=True)
    shutil.copy2(TEMPLATE, PLUGIN / ".codex-plugin" / "plugin.json")
    shutil.copytree(SOURCE_SKILLS, PLUGIN / "skills")

    manifest = json.loads((PLUGIN / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
    if manifest.get("skills") != "./skills/":
        raise SystemExit("plugin manifest must point to ./skills/")

    if ARCHIVE.exists():
        ARCHIVE.unlink()
    with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(PLUGIN.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(DIST))
    print(ARCHIVE)


if __name__ == "__main__":
    main()

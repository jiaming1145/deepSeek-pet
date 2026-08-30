from __future__ import annotations

import json
import re
from collections.abc import Iterable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTMATTER = re.compile(r"^---\n(?P<body>.*?)\n---\n", re.DOTALL)


def validate_skill(path: Path) -> list[str]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER.match(text)
    if not match:
        return [f"{path}: missing YAML frontmatter"]
    data: dict[str, str] = {}
    for line in match.group("body").splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            data[key.strip()] = value.strip()
    expected = path.parent.name
    if data.get("name") != expected:
        errors.append(f"{path}: name {data.get('name')!r} does not match folder {expected!r}")
    if not data.get("description"):
        errors.append(f"{path}: missing description")
    return errors


def pipeline_json_files() -> Iterable[Path]:
    """Yield JSON contracts and plugin manifests owned by this pipeline bundle."""
    roots = [
        ROOT / "schemas",
        ROOT / "templates",
        ROOT / "plugin-template",
        ROOT / "dist" / "live2d-production-plugin",
    ]
    for root in roots:
        if root.exists():
            yield from root.rglob("*.json")


def main() -> None:
    errors: list[str] = []
    skills = sorted((ROOT / ".agents" / "skills").glob("*/SKILL.md"))
    if len(skills) != 7:
        errors.append(f"expected 7 skills, found {len(skills)}")
    for skill in skills:
        errors.extend(validate_skill(skill))

    for json_path in pipeline_json_files():
        try:
            json.loads(json_path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"{json_path}: invalid JSON: {exc}")

    prompt_files = sorted((ROOT / "codex-prompts").glob("*.md"))
    if not prompt_files:
        errors.append("no compatibility prompt files found")

    required = [
        ROOT / "AGENTS.md",
        ROOT / "docs" / "ARCHITECTURE.md",
        ROOT / "schemas" / "part_manifest.schema.json",
        ROOT / "templates" / "character_brief.yaml",
        ROOT / "uxp" / "PLUGIN_SPEC.md",
        ROOT / "mcp" / "TOOL_SPEC.md",
    ]
    for path in required:
        if not path.exists():
            errors.append(f"missing required file: {path}")

    if errors:
        raise SystemExit("\n".join(errors))
    print(f"validated {len(skills)} skills, {len(prompt_files)} prompts, and all JSON files")


if __name__ == "__main__":
    main()

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_ROOT = REPO_ROOT / "runs" / "deepseek_humanized_20260830_001"
PLAN_ROOT = RUN_ROOT / "02_parts_plan" / "revisions" / "v001"
HANDOFF_ROOT = RUN_ROOT / "05_cubism" / "revisions" / "v005"


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def imported_ids() -> list[str]:
    manifest = load_json(PLAN_ROOT / "part_manifest.json")
    return [str(part["id"]) for part in manifest["parts"] if part["imported"]]


def test_handoff_index_is_hash_locked_and_passed() -> None:
    index = load_json(HANDOFF_ROOT / "handoff_index.json")
    assert index["status"] == "ready_for_human_cubism_authoring"
    assert index["revision"] == "v005"
    assert index["counts"] == {
        "imported_parts": 138,
        "layer_role_rows": 138,
        "artmesh_guidance_rows": 138,
        "parameter_count": 45,
        "expression_count": 12,
        "motion_slot_count": 10,
        "physics_system_count": 13,
        "clipping_context_count": 5,
        "draw_order_min": 100,
        "draw_order_max": 922,
        "forbidden_model_files_created": 0,
    }
    paths = [record["path"] for record in index["artifacts"]]
    assert len(paths) == len(set(paths)) == 15
    for record in index["artifacts"]:
        artifact = RUN_ROOT / record["path"]
        assert artifact.is_file(), record["path"]
        assert artifact.stat().st_size == record["bytes"]
        assert sha256(artifact) == record["sha256"]


def test_every_imported_layer_has_one_role_and_mesh_instruction() -> None:
    expected = imported_ids()
    roles = load_json(HANDOFF_ROOT / "layer_role_map.json")
    meshes = load_json(HANDOFF_ROOT / "artmesh_guidance.json")

    assert [row["part_id"] for row in roles["layers"]] == expected
    assert [row["part_id"] for row in meshes["parts"]] == expected
    assert set(meshes["classification_counts"]) <= {
        "broad_auto",
        "auto_then_review",
        "manual",
    }
    assert sum(meshes["classification_counts"].values()) == 138
    assert all(row["must_complete_before_keyforms"] for row in meshes["parts"])


def test_parameters_expressions_physics_and_draw_order_resolve() -> None:
    parameters = load_json(HANDOFF_ROOT / "parameter_handoff.json")["parameters"]
    behavior = load_json(HANDOFF_ROOT / "behavior_handoff.json")
    physics = load_json(HANDOFF_ROOT / "physics_handoff.json")
    draw = load_json(HANDOFF_ROOT / "draw_order_notes.json")
    parameter_ids = {item["id"] for item in parameters}

    expression_targets = {
        parameter_id
        for expression in behavior["expressions"]["expressions"]
        for parameter_id in expression["targets"]
    }
    physics_targets = {
        parameter_id
        for system in physics["systems"]
        for key in ("inputs", "outputs")
        for parameter_id in system[key]
    }
    orders = [item["cubism_draw_order"] for item in draw["parts"]]

    assert len(parameters) == len(parameter_ids) == 45
    assert expression_targets <= parameter_ids
    assert physics_targets <= parameter_ids
    assert physics["not_final_constants"] is True
    assert physics["calculate_fps"] == 60
    assert orders == sorted(set(orders))
    assert min(orders) >= 0 and max(orders) <= 1000
    assert {item["id"] for item in draw["parts"]} == set(imported_ids())


def test_handoff_stops_at_the_cubism_authoring_boundary() -> None:
    validation = load_json(HANDOFF_ROOT / "handoff_validation_v005.json")
    checklist = load_json(HANDOFF_ROOT / "rigging_checklist.json")

    assert validation["status"] == "pass"
    assert validation["checks"]["forbidden_model_files_created"] == 0
    assert checklist["items"][0]["done"] is True
    assert all(item["done"] is False for item in checklist["items"][1:])
    assert not list(HANDOFF_ROOT.rglob("*.cmo3"))
    assert not list(HANDOFF_ROOT.rglob("*.moc3"))

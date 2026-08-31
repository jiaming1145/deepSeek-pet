from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import jsonschema

REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_ROOT = REPO_ROOT / "runs" / "deepseek_humanized_20260830_001"
PSD_ROOT = RUN_ROOT / "04_psd" / "revisions" / "v001"


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


def test_packager_job_validates_and_has_exact_inventory() -> None:
    job_path = PSD_ROOT / "packager_job.json"
    schema_path = PSD_ROOT / "packager_job.schema.json"
    job = load_json(job_path)
    schema = load_json(schema_path)

    jsonschema.Draft202012Validator(schema).validate(job)
    imported = [layer for layer in job["layers"] if layer["imported"]]
    guides = [layer for layer in job["layers"] if not layer["imported"]]

    assert len(job["layers"]) == 139
    assert len(imported) == 138
    assert len({layer["name"] for layer in imported}) == 138
    assert len({layer["z_index"] for layer in imported}) == 138
    assert [guide["name"] for guide in guides] == ["guide_reference"]
    assert guides[0]["visible"] is False
    assert job["constraints"]["production_writer"] == "Adobe Photoshop UXP"
    assert job["constraints"]["overwrite"] is False


def test_every_job_source_is_registered_and_hash_locked() -> None:
    job = load_json(PSD_ROOT / "packager_job.json")
    for layer in job["layers"]:
        source = RUN_ROOT / layer["source_png"]
        assert source.is_file(), layer["name"]
        assert sha256(source) == layer["source_sha256"], layer["name"]
        bbox = layer["expected_content_bbox"]
        assert bbox is not None, layer["name"]
        assert 0 <= bbox[0] < bbox[2] <= job["canvas"]["width"]
        assert 0 <= bbox[1] < bbox[3] <= job["canvas"]["height"]


def test_preflight_provenance_matches_current_job_and_generator() -> None:
    job_path = PSD_ROOT / "packager_job.json"
    job = load_json(job_path)
    preflight = load_json(PSD_ROOT / "qa" / "packager_preflight_v001.json")
    generator_path = RUN_ROOT / job["generator"]["path"]

    assert preflight["status"] == "pass"
    assert preflight["job"]["sha256"] == sha256(job_path)
    assert job["generator"]["sha256"] == sha256(generator_path)
    assert preflight["checks"]["actual_imported_layers"] == 138


def test_uxp_writer_has_authoritative_and_no_overwrite_controls() -> None:
    plugin_root = PSD_ROOT / "uxp_plugin"
    manifest = load_json(plugin_root / "manifest.json")
    source = (plugin_root / "main.js").read_text(encoding="utf-8")

    assert manifest["manifestVersion"] == 5
    assert manifest["requiredPermissions"]["localFileSystem"] == "request"
    assert "core.executeAsModal" in source
    assert "saveAs.psd" in source
    assert "overwrite: false" in source
    assert "outputFileName" in source
    assert "materialLayersBackToFront" in source
    assert "importedLayersBackToFront" in source

    script = (
        PSD_ROOT / "photoshop_script" / "deepseek_live2d_packager.psjs"
    ).read_text(encoding="utf-8")
    assert "core.executeAsModal" in script
    assert "saveAs.psd" in script
    assert "overwrite: false" in script
    assert "fs.getFileForOpening" in script
    assert "fs.getFolder" in script
    assert "main();" in script


def test_blocked_validation_is_honest_and_has_no_artifact_failures() -> None:
    reports = sorted((PSD_ROOT / "qa").glob("psd_validation_attempt_*.json"))
    assert reports
    report = load_json(reports[-1])
    assert report["status"] == "blocked_external_validation"
    assert report["gate_advanced"] is False
    assert report["failures"] == []
    assert report["applications"]["photoshop"] is None
    assert report["applications"]["cubism_editor"] is not None
    assert report["applications"]["creative_cloud"] is not None


def test_runtime_scaffold_matches_ai_expression_and_motion_contract() -> None:
    root = PSD_ROOT / "runtime_scaffold"
    character = load_json(root / "character.pending.json")
    behaviors = load_json(root / "behaviors.pending.json")
    contract = load_json(root / "runtime_contract.json")

    assert character["id"] == "deepseek-whalechan"
    assert character["emotionMap"] == {
        "happy": "F02",
        "sad": "F04",
        "angry": "F03",
        "think": "F08",
        "surprised": "F06",
        "awkward": "F07",
        "question": "F09",
        "curious": "F01",
        "neutral": None,
    }
    assert character["motionMap"] == {
        "nod": ["TapBody", 0],
        "shake": ["TapBody", 1],
        "wave": ["TapBody", 2],
        "think": ["TapBody", 3],
    }
    assert behaviors["character"] == character["id"]
    assert len(behaviors["behaviors"]) == 16
    assert contract["runtime_contract"]["motion_groups"] == {
        "Idle": 2,
        "TapBody": 4,
        "Extra": 4,
    }
    assert contract["runtime_contract"]["speech_parameter"] == "ParamMouthOpenY"
    assert contract["installable"] is False
    assert contract["gates"]["cubism_ready"] is False
    provenance = contract["provenance"]
    assert provenance["generator"]["sha256"] == sha256(
        RUN_ROOT / provenance["generator"]["path"]
    )
    for name, expected in provenance["approved_plans"].items():
        assert expected == sha256(
            RUN_ROOT / "02_parts_plan" / "revisions" / "v001" / name
        )
    for relative_path, expected in provenance["shared_sources"].items():
        assert expected == sha256(REPO_ROOT / relative_path)


def test_run_manifest_registry_is_unique_and_hash_valid() -> None:
    run = load_json(RUN_ROOT / "run.json")
    records = run["artifacts"]
    paths = [record["path"] for record in records]

    assert len(paths) == len(set(paths))
    for record in records:
        artifact = RUN_ROOT / record["path"]
        assert artifact.is_file(), record["path"]
        assert artifact.stat().st_size == record["bytes"], record["path"]
        assert sha256(artifact) == record["sha256"], record["path"]

    assert run["state"] == "parts_approved"
    assert run["next_allowed_transition"] == "psd_validated"
    assert run["blocked"]["recoverable"] is True
    assert run["blocked"]["evidence"].endswith("psd_validation_attempt_004.json")

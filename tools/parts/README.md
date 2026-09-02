# Parts pipeline tools

Versioned copies of the scripts that live, by the pipeline's own convention, inside a run
revision directory. `runs/` is git-ignored, so without this directory the scripts would exist
only on one machine. The executable copies are the ones in the run:

| script | executable copy | purpose |
|---|---|---|
| `build_parts_v005.py` | `runs/<run>/03_parts/revisions/v005/scripts/build_parts.py` | rebuild all parts with an outline-following partition and motion-sized overlap bands |
| `qa_continuity.py` | `runs/<run>/03_parts/revisions/v005/scripts/qa_continuity.py` | the continuity gate: no leaked fragments, a painted band under every touching seam |
| `parts_revision_v005.json` | `runs/<run>/03_parts/revisions/v005/parts_revision_v005.json` | what v005 changed and why, and its known limits |
| `accepted_seams_v005.json` | `runs/<run>/03_parts/revisions/v005/qa/accepted_seams.json` | seam waivers the gate honours, each with its reason |

Both derive their revision from the directory they sit in and import v001's script for the
anchors, zones and face rules, so they must be run from their run-revision location, not
from here. To start a new revision, copy them into `revisions/vNNN/scripts/` and run from the
repository root.

Why these exist, with measurements: `docs/spikes/2026-08-31-tail-rig-spike.md` and
`docs/DECISIONS.md` D-2026-09-01-02.

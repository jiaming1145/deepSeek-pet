#!/usr/bin/env sh
set -eu

SOURCE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../codex-prompts" && pwd)
TARGET_DIR=${CODEX_HOME:-"$HOME/.codex"}/prompts
mkdir -p "$TARGET_DIR"
cp "$SOURCE_DIR"/*.md "$TARGET_DIR"/
printf '%s\n' "Installed deprecated compatibility prompts to $TARGET_DIR. Restart Codex or open a new session."

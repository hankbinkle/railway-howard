#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
GATEWAY_PORT="${PORT:-8080}"
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:?Missing OPENCLAW_GATEWAY_TOKEN env var}"

# Ensure state and workspace dirs exist
mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"

# Copy seed config if state dir is empty
if [ ! -f "$STATE_DIR/openclaw.json" ]; then
    echo "[bootstrap] Seeding config from /seed-config/openclaw.json..."
    cp /seed-config/openclaw.json "$STATE_DIR/openclaw.json"
fi

# Copy seed workspace files if the workspace is empty
if [ -z "$(ls -A "$WORKSPACE_DIR" 2>/dev/null)" ]; then
    echo "[bootstrap] Seeding workspace from /seed-workspace..."
    cp -r /seed-workspace/* "$WORKSPACE_DIR/" 2>/dev/null || true
fi

# Start the gateway
echo "[bootstrap] Starting OpenClaw gateway on port $GATEWAY_PORT..."
exec openclaw gateway run \
    --port "$GATEWAY_PORT" \
    --bind lan \
    --token "$GATEWAY_TOKEN" \
    --allow-unconfigured

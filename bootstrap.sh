#!/usr/bin/env bash
set -euo pipefail

# Railway Howard — Bootstrap
# Seeds workspace files on first run, then starts the gateway

WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
GATEWAY_PORT="${PORT:-8080}"

# Ensure state and workspace dirs exist
mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"

# Copy seed workspace files if the workspace is empty
if [ -z "$(ls -A "$WORKSPACE_DIR" 2>/dev/null)" ]; then
    echo "[bootstrap] Seeding workspace from /seed-workspace..."
    cp -r /seed-workspace/* "$WORKSPACE_DIR/" 2>/dev/null || true
fi

# Start the gateway
# --bind lan: accessible from Railway's proxy
# --port $PORT: Railway injects this env var
# --token: authenticate the gateway
echo "[bootstrap] Starting OpenClaw gateway on port $GATEWAY_PORT..."
exec openclaw gateway run \
    --port "$GATEWAY_PORT" \
    --bind lan \
    --token "$OPENCLAW_GATEWAY_TOKEN"

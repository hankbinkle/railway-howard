#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
GATEWAY_PORT="${PORT:-8080}"
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"

# Ensure state and workspace dirs exist
mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"

# ALWAYS copy seed config (overwrites any existing)
echo "[bootstrap] Applying config from /seed-config/openclaw.json..."
cp /seed-config/openclaw.json "$STATE_DIR/openclaw.json"

# Copy seed workspace files (identity files only if workspace is empty)
if [ -z "$(ls -A "$WORKSPACE_DIR" 2>/dev/null)" ]; then
    echo "[bootstrap] Seeding workspace from /seed-workspace..."
    cp -r /seed-workspace/* "$WORKSPACE_DIR/" 2>/dev/null || true
fi

# ALWAYS seed skills (overwrites any existing — skills are designed to be refreshed)
if [ -d "/seed-workspace/skills" ]; then
    echo "[bootstrap] Seeding skills into workspace..."
    mkdir -p "$WORKSPACE_DIR/skills"
    cp -r /seed-workspace/skills/* "$WORKSPACE_DIR/skills/" 2>/dev/null || true
fi

# Start auto-approve daemon in background (polls every 15s for pending device pairings)
echo "[bootstrap] Starting auto-approve daemon..."
OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN" nohup /auto-approve.sh > /tmp/auto-approve.log 2>&1 &
echo "[bootstrap] auto-approve PID: $!"

# Start Dropbox backup daemon in background (runs daily)
echo "[bootstrap] Starting Dropbox backup daemon..."
nohup /dropbox_backup.sh > /tmp/dropbox_backup.log 2>&1 &
echo "[bootstrap] dropbox_backup PID: $!"

# Start workspace sync daemon in background (pulls/pushes every 60s)
echo "[bootstrap] Starting workspace sync daemon..."
nohup /workspace_sync.sh > /tmp/workspace_sync.log 2>&1 &
echo "[bootstrap] workspace_sync PID: $!"

# Start the gateway
echo "[bootstrap] Starting OpenClaw gateway on port $GATEWAY_PORT..."
exec openclaw gateway run \
    --port "$GATEWAY_PORT" \
    --bind lan \
    --token "$GATEWAY_TOKEN" \
    --allow-unconfigured

#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
GATEWAY_PORT="${PORT:-8080}"
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"

# Ensure state and workspace dirs exist
mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"

# Seed config ONLY if missing (preserves runtime config/device state across redeploys)
if [ ! -f "$STATE_DIR/openclaw.json" ]; then
    echo "[bootstrap] Seeding config from /seed-config/openclaw.json (first boot)..."
    cp /seed-config/openclaw.json "$STATE_DIR/openclaw.json"
else
    echo "[bootstrap] Keeping existing config at $STATE_DIR/openclaw.json"
fi

# Copy seed workspace files (identity files only if workspace is empty)
if [ -z "$(ls -A "$WORKSPACE_DIR" 2>/dev/null)" ]; then
    echo "[bootstrap] Seeding workspace from /seed-workspace..."
    cp -r /seed-workspace/* "$WORKSPACE_DIR/" 2>/dev/null || true
fi

# Seed skills ONLY if the skills dir does not exist yet
# (Dropbox workspace_sync daemon is the live source of skill updates; don't clobber it)
if [ ! -d "$WORKSPACE_DIR/skills" ] && [ -d "/seed-workspace/skills" ]; then
    echo "[bootstrap] Seeding skills into workspace (first boot)..."
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

# Configure agent auth profiles from environment variables
echo "[bootstrap] Configuring agent auth profiles..."
OPENCLAW_STATE_DIR="$STATE_DIR" openclaw onboard \
    --non-interactive \
    --accept-risk \
    --deepseek-api-key "${DEEPSEEK_API_KEY:-}" \
    --openai-api-key "${OPENAI_API_KEY:-}" \
    --anthropic-api-key "${ANTHROPIC_API_KEY:-}" \
    --gemini-api-key "${GEMINI_API_KEY:-}" \
    --skip-bootstrap \
    --skip-channels \
    --skip-skills \
    --skip-ui \
    --skip-search \
    --skip-health \
    2>&1 | sed 's/^/[bootstrap] onboard: /' || echo "[bootstrap] Auth config completed (ok if some keys were empty)"

# Start the gateway
echo "[bootstrap] Starting OpenClaw gateway on port $GATEWAY_PORT..."
exec openclaw gateway run \
    --port "$GATEWAY_PORT" \
    --bind lan \
    --token "$GATEWAY_TOKEN" \
    --allow-unconfigured

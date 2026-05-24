#!/usr/bin/env bash
# Railway Howard — Dropbox Workspace Sync Daemon
#
# Keeps Howard's workspace in sync with the shared Dropbox folder.
# Uses a pull-then-push polling model:
#   - On boot: downloads ALL files from Dropbox
#   - Every 60s: pulls newer files from Dropbox
#   - Every 60s: pushes local changes back to Dropbox
#
# Env vars needed (via Railway):
#   DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN
#   DROPBOX_TEAM_MEMBER_ID (optional, set on howard_gateway)
set -euo pipefail

WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
DROPBOX_PATH="/Rob Zinn/_openclaw_workspace"
STATE_FILE="/tmp/workspace-sync-state.json"
PULL_INTERVAL=60    # seconds between Dropbox checks
PUSH_INTERVAL=300   # seconds between local change pushes

DROPBOX_API="https://api.dropboxapi.com"
DROPBOX_CONTENT="https://content.dropboxapi.com"

log() { echo "[workspace_sync] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
err() { log "ERROR: $*"; }

# ── Helpers ─────────────────────────────────────────────────────────────────

# Get fresh Dropbox access token
dropbox_refresh_token() {
    local resp token
    resp=$(curl -s -X POST https://api.dropbox.com/oauth2/token \
        -d grant_type=refresh_token \
        -d refresh_token=*** \
        -d client_id="$DROPBOX_APP_KEY" \
        -d client_secret=***
    token=*** "$resp" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")
    echo "$token"
}

# Dropbox API call helper (with auth header)
dropbox_api() {
    local method="$1" endpoint="$2" data="$3" token="$4"
    curl -s -X "$method" "$DROPBOX_API$endpoint" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -H "Dropbox-API-Select-User: $DROPBOX_TEAM_MEMBER_ID" \
        -d "$data" 2>/dev/null
}

# Download a file from Dropbox
dropbox_download() {
    local remote_path="$1" token="$2"
    curl -s -X POST "$DROPBOX_CONTENT/2/files/download" \
        -H "Authorization: Bearer $token" \
        -H "Dropbox-API-Select-User: $DROPBOX_TEAM_MEMBER_ID" \
        -H "Dropbox-API-Arg: $(echo '{"path":"'$remote_path'"}' | python3 -c 'import json,sys; print(json.dumps({"path":sys.stdin.read().strip()}))')" \
        2>/dev/null
}

# Upload a file to Dropbox
dropbox_upload() {
    local local_path="$1" remote_path="$2" token="$3"
    curl -s -X POST "$DROPBOX_CONTENT/2/files/upload" \
        -H "Authorization: Bearer $token" \
        -H "Dropbox-API-Select-User: $DROPBOX_TEAM_MEMBER_ID" \
        -H "Content-Type: application/octet-stream" \
        -H "Dropbox-API-Arg: $(python3 -c "import json; print(json.dumps({'path':'$remote_path','mode':'overwrite'}))")" \
        --data-binary @"$local_path" 2>/dev/null
}

# ── Sync Logic ──────────────────────────────────────────────────────────────

# List all tracked file paths in the workspace
get_tracked_files() {
    # Core identity files
    for f in SOUL.md AGENTS.md MEMORY.md USER.md TOOLS.md IDENTITY.md HEARTBEAT.md BRAND_GUIDELINES.md PROJECT_IDEAS.md TRELLO_DATA_SCHEMA.md; do
        [ -f "$WORKSPACE_DIR/$f" ] && echo "$f"
    done
    # Memory directory
    if [ -d "$WORKSPACE_DIR/memory" ]; then
        for f in "$WORKSPACE_DIR/memory"/*.md; do
            [ -f "$f" ] && echo "memory/$(basename "$f")"
        done
    fi
}

# Pull: download all files from Dropbox (called on boot + periodically)
pull_all() {
    log "Pulling workspace files from Dropbox..."
    local token
    token=$(drop…ken) || return 1
    
    # List files in Dropbox workspace
    local listing
    listing=$(dropbox_api POST "/2/files/list_folder" '{"path":"'"$DROPBOX_PATH"'","include_deleted":false}' "$token")
    
    local names
    names=*** "$listing" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    for e in d.get('entries',[]):
        print(e['name'])
except: pass
" 2>/dev/null || true)
    
    local count=0
    for name in $names; do
        local remote_path="$DROPBOX_PATH/$name"
        local local_path="$WORKSPACE_DIR/$name"
        
        # Download the file
        local data
        data=$(dropbox_download "$remote_path" "$token") || continue
        
        # Save it
        mkdir -p "$(dirname "$local_path")"
        echo "$data" > "$local_path" 2>/dev/null && count=$((count + 1)) || true
    done
    
    # Also pull memory directory
    local mem_listing
    mem_listing=$(dropbox_api POST "/2/files/list_folder" '{"path":"'"$DROPBOX_PATH/memory"'","include_deleted":false}' "$token" 2>/dev/null) || true
    
    if [ -n "$mem_listing" ]; then
        local mem_names
        mem_names=*** "$mem_listing" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    for e in d.get('entries',[]):
        print(e['name'])
except: pass
" 2>/dev/null || true)
        
        for name in $mem_names; do
            local remote_path="$DROPBOX_PATH/memory/$name"
            local local_path="$WORKSPACE_DIR/memory/$name"
            local data
            data=$(dropbox_download "$remote_path" "$token") || continue
            mkdir -p "$(dirname "$local_path")"
            echo "$data" > "$local_path" 2>/dev/null || true
        done
    fi
    
    log "Pulled files from Dropbox"
}

# Push: upload local changes to Dropbox
push_changes() {
    local token
    token=$(drop…ken) || return 1
    
    local files
    files=*** -c "import json,sys; print(json.dumps(json.load(sys.stdin)))" "$STATE_FILE" 2>/dev/null || echo "{}")
    
    # For now, push core files on each cycle
    for f in SOUL.md AGENTS.md MEMORY.md USER.md TOOLS.md IDENTITY.md HEARTBEAT.md; do
        local local_path="$WORKSPACE_DIR/$f"
        if [ -f "$local_path" ]; then
            dropbox_upload "$local_path" "$DROPBOX_PATH/$f" "$token" > /dev/null 2>&1 || true
        fi
    done
    
    # Push memory files
    if [ -d "$WORKSPACE_DIR/memory" ]; then
        for f in "$WORKSPACE_DIR/memory"/*.md; do
            [ -f "$f" ] && dropbox_upload "$f" "$DROPBOX_PATH/memory/$(basename "$f")" "$token" > /dev/null 2>&1 || true
        done
    fi
}

# ── Main Loop ───────────────────────────────────────────────────────────────
main() {
    # Check prereqs
    if [ -z "${DROPBOX_APP_KEY:***" ] || [ -z "${DROPBOX_APP_SECRET:***" ] || [ -z "${DROPBOX_REFRESH_TOKEN:***" ]; then
        log "Dropbox env vars not set. Skipping workspace sync."
        exit 0
    fi
    
    log "Workspace sync daemon starting..."
    
    # Full pull on boot
    pull_all
    
    local push_counter=0
    
    while true; do
        sleep "$PULL_INTERVAL"
        push_counter=$((push_counter + PULL_INTERVAL))
        
        # Periodic pull
        pull_all
        
        # Periodic push (every PUSH_INTERVAL seconds)
        if [ $push_counter -ge $PUSH_INTERVAL ]; then
            push_changes
            push_counter=0
        fi
    done
}

main

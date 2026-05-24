#!/usr/bin/env bash
# Railway Howard — Daily Dropbox Backup Daemon
#
# Archives workspace, config, and session metadata to Dropbox.
# Runs on a 24-hour loop in the background alongside the gateway.
#
# Env vars needed (set on Railway):
#   DROPBOX_APP_KEY       — Dropbox app key (default: zinn's key)
#   DROPBOX_APP_SECRET    — Dropbox app secret
#   DROPBOX_REFRESH_TOKEN — OAuth refresh token (long-lived)
#   DROPBOX_BACKUP_PATH   — Dropbox path prefix (default: /Rob Zinn/_railway_howard_backups)
#   BACKUP_RETENTION_DAYS — How many days to keep (default: 30)
#
# Safe to run without Dropbox vars — checks at startup and exits gracefully.
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"
BACKUP_DIR="/tmp/howard-backups"
DROPBOX_PATH="${DROPBOX_BACKUP_PATH:-/Rob Zinn/_railway_howard_backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
INTERVAL_SECONDS="$(( 24 * 60 * 60 ))"  # 24h

DROPBOX_API="https://api.dropboxapi.com"
DROPBOX_CONTENT="https://content.dropboxapi.com"

# ── Helpers ─────────────────────────────────────────────────────────────────
log() { echo "[dropbox_backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
err() { log "ERROR: $*"; }

# Get a fresh Dropbox access token via refresh grant
dropbox_refresh_token() {
    local resp
    resp=$(curl -s -X POST https://api.dropbox.com/oauth2/token \
        -d grant_type=refresh_token \
        -d refresh_token="$DROPBOX_REFRESH_TOKEN" \
        -d client_id="$DROPBOX_APP_KEY" \
        -d client_secret="$DROPBOX_APP_SECRET")
    
    local token
    token=$(echo "$resp" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    print(d.get('access_token', ''))
except:
    print('')
" 2>/dev/null || echo "")
    
    if [ -z "$token" ]; then
        err "Failed to refresh Dropbox token: $(echo "$resp" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("error_description","unknown"))' 2>/dev/null || echo "parse error")"
        return 1
    fi
    echo "$token"
}

# Upload a file to Dropbox
dropbox_upload() {
    local local_path="$1"
    local remote_path="$2"
    local token="$3"
    
    local file_name
    file_name=$(basename "$local_path")
    
    local resp
    resp=$(curl -s -X POST "$DROPBOX_CONTENT/2/files/upload" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/octet-stream" \
        -H "Dropbox-API-Arg: $(python3 -c "import json; print(json.dumps({'path': '$remote_path/$file_name', 'mode': 'add', 'autorename': True}))")" \
        --data-binary @"$local_path")
    
    local result
    result=$(echo "$resp" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get('name','FAIL'))
except: print('PARSE_ERROR')
" 2>/dev/null || echo "FAIL")
    
    echo "$result"
}

# List files/folders at a Dropbox path
dropbox_list() {
    local remote_path="$1"
    local token="$2"
    
    curl -s -X POST "$DROPBOX_API/2/files/list_folder" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"path\": \"$remote_path\", \"include_deleted\": false}" | \
    python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    for e in d.get('entries', []):
        print(e['name'])
except: pass
" 2>/dev/null || true
}

# Delete a file or folder on Dropbox
dropbox_delete() {
    local remote_path="$1"
    local token="$2"
    
    curl -s -X POST "$DROPBOX_API/2/files/delete_v2" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"path\": \"$remote_path\"}" > /dev/null 2>&1 || true
}

# ── Backup Logic ────────────────────────────────────────────────────────────
do_backup() {
    local timestamp
    timestamp=$(date -u '+%Y-%m-%dT%H-%M-%SZ')
    local date_stamp="${timestamp:0:10}"  # YYYY-MM-DD

    log "Starting backup $timestamp"

    # Create temp working dir
    local work_dir="$BACKUP_DIR/$date_stamp"
    mkdir -p "$work_dir"

    local archive="$work_dir/railway-howard-backup-$date_stamp.tar.gz"
    local archive_file
    archive_file=$(basename "$archive")

    # Build the archive
    # Include: workspace files, config, session list (not full session blobs)
    # We structure in a predictable tree so restores are easy
    cd "$work_dir"
    
    # Collect session IDs (just names, not full data — can be huge)
    local session_list="$work_dir/session_ids.txt"
    if [ -d "$STATE_DIR/agents" ]; then
        find "$STATE_DIR/agents" -name 'sessions' -type d 2>/dev/null | while read -r dir; do
            ls "$dir/" 2>/dev/null
        done > "$session_list"
    fi
    if [ ! -s "$session_list" ]; then
        echo "(no sessions)" > "$session_list"
    fi

    # Tar it all up
    tar czf "$archive" \
        -C "$WORKSPACE_DIR" . \
        -C "$STATE_DIR" openclaw.json \
        --transform="s|$work_dir/||" "$session_list" \
        --transform="s|.*|session_ids.txt|" "$session_list" \
        2>/dev/null || {
        # Fallback: build tar more carefully
        mkdir -p "$work_dir/workspace" "$work_dir/config"
        cp -r "$WORKSPACE_DIR/." "$work_dir/workspace/" 2>/dev/null || true
        cp "$STATE_DIR/openclaw.json" "$work_dir/config/" 2>/dev/null || true
        cp "$session_list" "$work_dir/" 2>/dev/null || true
        cd "$work_dir"
        tar czf "$archive" workspace config session_ids.txt 2>/dev/null || {
            err "Failed to create archive"
            rm -rf "$work_dir"
            return 1
        }
    }

    local archive_size
    archive_size=$(stat -f%z "$archive" 2>/dev/null || stat -c%s "$archive" 2>/dev/null || echo "0")
    log "Archive created: $archive_file ($archive_size bytes)"

    # Upload to Dropbox
    local remote_dir="$DROPBOX_PATH/$date_stamp"
    log "Uploading to Dropbox: $remote_dir/"

    local token
    token=$(dropbox_refresh_token) || return 1

    # Ensure the dated directory exists by uploading into it
    local result
    result=$(dropbox_upload "$archive" "$remote_dir" "$token")
    log "Upload result: $result"

    # Clean up temp
    rm -rf "$work_dir"

    # ── Retention: remove old backups ──────────────────────────────────────
    log "Checking for backups older than $RETENTION_DAYS days..."
    local cutoff_date
    cutoff_date=$(date -u -v-${RETENTION_DAYS}d '+%Y-%m-%d' 2>/dev/null || \
                  date -u -d "-${RETENTION_DAYS} days" '+%Y-%m-%d' 2>/dev/null || \
                  echo "unknown")

    if [ "$cutoff_date" != "unknown" ]; then
        dropbox_list "$DROPBOX_PATH" "$token" | while read -r dir_name; do
            [ -z "$dir_name" ] && continue
            if [[ "$dir_name" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
                if [[ "$dir_name" < "$cutoff_date" ]]; then
                    log "Purging old backup: $dir_name"
                    dropbox_delete "$DROPBOX_PATH/$dir_name" "$token"
                fi
            fi
        done
    fi

    log "Backup complete."
}

# ── Main Loop ───────────────────────────────────────────────────────────────
main() {
    # Check prereqs
    if [ -z "${DROPBOX_APP_KEY:-}" ] || [ -z "${DROPBOX_APP_SECRET:-}" ] || [ -z "${DROPBOX_REFRESH_TOKEN:-}" ]; then
        log "Dropbox env vars not set. Skipping backup setup."
        log "  Need: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN"
        log "  Set these on Railway and redeploy, or ignore this if backups aren't needed yet."
        exit 0
    fi

    log "Dropbox backup daemon starting (interval: ${INTERVAL_SECONDS}s, retention: ${RETENTION_DAYS}d)"

    # Run immediately on boot
    do_backup

    # Then loop
    while true; do
        sleep "$INTERVAL_SECONDS"
        do_backup
    done
}

main

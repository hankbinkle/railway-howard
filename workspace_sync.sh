#!/usr/bin/env bash
# Railway Howard — Dropbox Workspace Sync Daemon
#
# Keeps Howard's workspace in sync with the shared Dropbox folder.
# Pulls from Dropbox on boot, then periodically pushes/pulls.
#
# Env vars needed (set on Railway):
#   DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, DROPBOX_TEAM_MEMBER_ID
set -euo pipefail

WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
DROPBOX_PATH="/Rob Zinn/_openclaw_workspace"
PULL_INTERVAL=60
PUSH_INTERVAL=300

DROPBOX_API="https://api.dropboxapi.com"
DROPBOX_CONTENT="https://content.dropboxapi.com"

log() { echo "[workspace_sync] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
err() { log "ERROR: $*"; }

# ── Dropbox helpers ────────────────────────────────────────────────────────

# Get a fresh token from the refresh token
get_token() {
    python3 -c "
import json, urllib.request, urllib.parse, os
body = urllib.parse.urlencode({
    'grant_type': 'refresh_token',
    'refresh_token': os.environ['DROPBOX_REFRESH_TOKEN'],
    'client_id': os.environ['DROPBOX_APP_KEY'],
    'client_secret': os.environ['DROPBOX_APP_SECRET'],
}).encode()
req = urllib.request.Request('https://api.dropbox.com/oauth2/token', data=body, method='POST')
resp = json.loads(urllib.request.urlopen(req).read())
print(resp.get('access_token', ''))
"
}

# List files in a Dropbox folder
list_files() {
    local path="$1"
    python3 -c "
import json, urllib.request, sys, os
path = sys.argv[1]
access_token = os.environ['_DROPBOX_TOKEN']
member_id = os.environ.get('DROPBOX_TEAM_MEMBER_ID', '')
headers = {
    'Authorization': 'Bearer ' + access_token,
    'Content-Type': 'application/json',
}
if member_id:
    headers['Dropbox-API-Select-User'] = member_id
req = urllib.request.Request(
    'https://api.dropboxapi.com/2/files/list_folder',
    data=json.dumps({'path': path, 'include_deleted': False}).encode(),
    headers=headers,
)
try:
    resp = json.loads(urllib.request.urlopen(req).read())
    for e in resp.get('entries', []):
        print(e['name'])
except Exception as e:
    sys.exit(0)  # folder might not exist
" "$path"
}

# Download a file from Dropbox
download_file() {
    local remote_path="$1" local_path="$2"
    python3 -c "
import json, urllib.request, sys, os
remote = sys.argv[1]
local = sys.argv[2]
access_token = os.environ['_DROPBOX_TOKEN']
member_id = os.environ.get('DROPBOX_TEAM_MEMBER_ID', '')
headers = {
    'Authorization': 'Bearer ' + access_token,
    'Content-Type': 'application/octet-stream',
    'Dropbox-API-Arg': json.dumps({'path': remote}),
}
if member_id:
    headers['Dropbox-API-Select-User'] = member_id
req = urllib.request.Request(
    'https://content.dropboxapi.com/2/files/download',
    headers=headers,
)
resp = urllib.request.urlopen(req)
data = resp.read()
os.makedirs(os.path.dirname(local), exist_ok=True)
with open(local, 'wb') as f:
    f.write(data)
print('OK')
" "$remote_path" "$local_path"
}

# Upload a file to Dropbox
upload_file() {
    local local_path="$1" remote_path="$2"
    python3 -c "
import json, urllib.request, sys, os
local = sys.argv[1]
remote = sys.argv[2]
access_token = os.environ['_DROPBOX_TOKEN']
member_id = os.environ.get('DROPBOX_TEAM_MEMBER_ID', '')
headers = {
    'Authorization': 'Bearer ' + access_token,
    'Content-Type': 'application/octet-stream',
    'Dropbox-API-Arg': json.dumps({'path': remote, 'mode': 'overwrite'}),
}
if member_id:
    headers['Dropbox-API-Select-User'] = member_id
with open(local, 'rb') as f:
    data = f.read()
req = urllib.request.Request(
    'https://content.dropboxapi.com/2/files/upload',
    data=data,
    headers=headers,
)
urllib.request.urlopen(req)
print('OK')
" "$local_path" "$remote_path"
}

# ── Sync Logic ─────────────────────────────────────────────────────────────

pull_all() {
    log "Pulling workspace files from Dropbox..."
    
    # List core files
    local files
    files=$(list_files "$DROPBOX_PATH")
    
    local count=0
    for name in $files; do
        local remote_path="$DROPBOX_PATH/$name"
        local local_path="$WORKSPACE_DIR/$name"
        if download_file "$remote_path" "$local_path" > /dev/null 2>&1; then
            count=$((count + 1))
        fi
    done
    
    # List memory files
    local mem_files
    mem_files=$(list_files "$DROPBOX_PATH/memory") || true
    
    for name in $mem_files; do
        local remote_path="$DROPBOX_PATH/memory/$name"
        local local_path="$WORKSPACE_DIR/memory/$name"
        if download_file "$remote_path" "$local_path" > /dev/null 2>&1; then
            :  # silently download
        fi
    done
    
    log "Pulled files from Dropbox."
}

push_changes() {
    log "Pushing local workspace changes to Dropbox..."
    
    # Push core identity files
    for f in SOUL.md AGENTS.md MEMORY.md USER.md TOOLS.md IDENTITY.md HEARTBEAT.md; do
        local local_path="$WORKSPACE_DIR/$f"
        if [ -f "$local_path" ]; then
            upload_file "$local_path" "$DROPBOX_PATH/$f" > /dev/null 2>&1 || true
        fi
    done
    
    # Push memory files
    if [ -d "$WORKSPACE_DIR/memory" ]; then
        for f in "$WORKSPACE_DIR/memory"/*.md; do
            [ -f "$f" ] && upload_file "$f" "$DROPBOX_PATH/memory/$(basename "$f")" > /dev/null 2>&1 || true
        done
    fi
    
    log "Push complete."
}

# ── Main Loop ──────────────────────────────────────────────────────────────

main() {
    if [ -z "${DROPBOX_APP_KEY:-}" ] || [ -z "${DROPBOX_APP_SECRET:-}" ] || [ -z "${DROPBOX_REFRESH_TOKEN:-}" ]; then
        log "Dropbox env vars not set. Skipping workspace sync."
        exit 0
    fi
    
    log "Workspace sync daemon starting..."
    
    # Get initial token and export it for Python helpers
    local token
    token=$(get_token) || {
        err "Failed to get Dropbox token"
        exit 1
    }
    export _DROPBOX_TOKEN="$token"
    
    # Full pull on boot
    pull_all
    
    local push_counter=0
    
    while true; do
        sleep "$PULL_INTERVAL"
        push_counter=$((push_counter + PULL_INTERVAL))
        
        # Refresh token periodically
        token=$(get_token)
        export _DROPBOX_TOKEN="$token"
        
        # Pull
        pull_all
        
        # Push every PUSH_INTERVAL
        if [ $push_counter -ge $PUSH_INTERVAL ]; then
            push_changes
            push_counter=0
        fi
    done
}

main

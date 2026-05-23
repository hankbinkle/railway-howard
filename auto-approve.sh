#!/usr/bin/env bash
# Auto-approves pending device pairing requests on Howard
# Runs as a background loop alongside the gateway

API_URL="http://127.0.0.1:8080/api/v1/admin/rpc"
TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"

if [ -z "$TOKEN" ]; then
    echo "[auto-approve] No gateway token found, exiting"
    exit 1
fi

while true; do
    # List pending devices
    PENDING=$(curl -s -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"method":"device.pair.list","params":{}}' \
        "$API_URL" 2>/dev/null | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    for p in d.get('payload',{}).get('pending',[]):
        print(p.get('requestId',''))
except: pass
")

    if [ -n "$PENDING" ]; then
        while IFS= read -r REQ; do
            [ -z "$REQ" ] && continue
            echo "[auto-approve] Approving: $REQ"
            curl -s -H "Authorization: Bearer $TOKEN" \
                -H "Content-Type: application/json" \
                -d "{\"method\":\"device.pair.approve\",\"params\":{\"requestId\":\"$REQ\"}}" \
                "$API_URL" >/dev/null 2>&1
        done <<< "$PENDING"
    fi

    sleep 15
done

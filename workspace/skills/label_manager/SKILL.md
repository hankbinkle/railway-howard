---
name: label_manager
description: Manage ZINN labels across all Trello boards (Projects, ZPT2, Leads, Keynotes) from the master card on Internal. Syncs bidirectionally — edits to master card flow to all boards, labels added directly to boards get added to master. Periodic health check runs on Railway independently of OpenClaw/macOS.
---

# Label Manager

Keeps all four synced Trello boards in sync with the master label list. Enforces exclusivity rules and provides health monitoring via Railway.

## Master Label Source

**Board:** ZINN Internal > tech/production
**Card:** [ZINN labels](https://trello.com/c/69ff3feb1d968a82cfb82303)

Label names are defined as `##` headings in the card description following ZINN_TRELLO_CARD_DATA_SCHEMA.md format:
```
## residential

Description: ...
Color: green

---

## commercial
...
```

**No local files.** Edit the card → Railway webhook auto-syncs to all 4 boards.

## Current Label Set (20 labels)

```
residential, commercial, renovation, exterior, multi_story,
mep required, structural_required, life_safety,
finishes_and_fixtures, historic, garage, flood_zone, elevator,
fire_sprinkler, warehouse, predesign_only, showers, restaurants,
locker_rooms, roof_decks
```

## Boards to Sync

| Board | ID | Purpose |
|---|---|---|
| ZINN Projects | `5f84a9ea3e629c7eb4b2be27` | Active project cards |
| ZINN Project Template (ZPT2) | `66f2e19a4dd7012acc370148` | Task templates |
| ZINN Leads | `5f853408b0549433b0806f3b` | Lead/opportunity cards |
| ZINN Keynotes | `69f927cfac3847401e5ca448` | Detail drawing cards |

**ZINN Internal is NOT synced** — it has its own QoL labels for project management. It only hosts the master label card.

## Exclusivity Rules

- **residential + commercial**: Never on the same card. Detected on label change, email sent to rob@zinn.ai with card body + two action buttons.

## Bidirectional Sync

Labels can enter the system from either direction:

1. **Master → Boards**: Edit the ZINN labels card on Internal → webhook fires → all 4 boards updated
2. **Board → Master**: Add a label directly to any card on a synced board → webhook detects unknown label → automatically appended to master card → all boards re-synced

A **periodic check** runs every 30 minutes on Railway (independent of OpenClaw/macOS) to catch any labels that were added to boards without being attached to a card.

## Webhook Monitoring

### Service Health

The health check endpoint provides a comprehensive status report:

```
GET /health-check
```

Checks:
- Master card reachable and labels parseable
- All 4 synced boards are in sync
- All 5 webhooks are registered and active

Returns `200` if healthy, `503` if any check fails.

Results include per-board breakdowns showing missing/extra labels.

### Manual Resync

```
POST /resync
```

Trigger a full sync from master card to all 4 boards.

### Conflict Resolution

Trello webhooks on all 4 boards POST to:

```
https://zinn-labels-production.up.railway.app/trello-webhook
```

On any label change, the webhook server checks the affected card for conflicts. If found, an HTML email is sent with resolve buttons.

Resolve endpoint: `GET /resolve?cardId=X&boardId=Y&label=Z`

## Railway Service

| Detail | Value |
|---|---|
| URL | `https://zinn-labels-production.up.railway.app` |
| Health Check | `https://zinn-labels-production.up.railway.app/health-check` |
| Resync | `POST https://zinn-labels-production.up.railway.app/resync` |
| Project | `zinn-labels` (cbc9d086-0401-4443-81f0-bc7388d829e2) |
| Service | `zinn-labels` (c527abe1-7655-4634-8fdf-c528003314f2) |
| Source | `~/.openclaw/skills/label_manager/webhook-server/` |
| Periodic check | Every 30 min via `setInterval` in server.js |
| Deploy | `cd webhook-server && railway up --detach` |

### Environment Variables

| Variable | Source | Purpose |
|---|---|---|
| `TRELLO_API_KEY` | Railway | Fallback Trello key |
| `TRELLO_API_TOKEN` | Railway | Fallback Trello token |
| `TRELLO_KEY` | Railway | Primary Trello key (shared config) |
| `TRELLO_TOKEN` | Railway | Primary Trello token (shared config) |
| `GMAIL_CREDENTIALS_JSON` | Railway | Gmail API credentials |
| `GMAIL_TOKEN_JSON` | Railway | Gmail API token |

## Workflow

### Add/Remove a Label (Master → Boards)

1. Edit the ZINN labels card on Internal > tech/production
2. Railway webhook auto-detects the change and syncs to all 4 boards within seconds
3. Or run manual sync:
   ```bash
   python3 ~/.openclaw/skills/label_manager/scripts/sync-labels.py
   ```
   Preview first:
   ```bash
   python3 ~/.openclaw/skills/label_manager/scripts/sync-labels.py --dry-run
   ```

### Label Added Directly to Board (Board → Master)

Happens automatically via webhook. To trigger manually:
- Add the label to the ZINN labels card on Internal
- Or run the sync script

### Health Check (independent of this machine)

The Railway server runs a periodic check every 30 minutes:

```bash
# View current health status
curl https://zinn-labels-production.up.railway.app/health-check | python3 -m json.tool
```

If out of sync, the server auto-imports unknown labels to the master card.

### Re-register Webhooks (after redeploy)

```bash
python3 ~/.openclaw/skills/label_manager/scripts/register-webhooks.py
```

### Deploy Webhook Server to Railway

```bash
# Sync shared modules first
cp ~/.openclaw/skills/_shared/*.js ~/.openclaw/skills/label_manager/webhook-server/_shared/

# Deploy
cd ~/.openclaw/skills/label_manager/webhook-server
railway up --detach
```

## Files

| Path | Purpose |
|---|---|
| `scripts/sync-labels.py` | Syncs master card to all boards |
| `scripts/label-monitor.py` | Standalone conflict scanner (for manual runs) |
| `scripts/register-webhooks.py` | Registers Trello webhooks pointing to Railway |
| `webhook-server/server.js` | Express server: webhooks, health check, periodic sync, bidirectional sync |
| `webhook-server/package.json` | Node deps (express, googleapis) |
| `webhook-server/railway.json` | Railway deploy config |
| `webhook-server/_shared/` | Shared infrastructure modules (config, trello, email) |

## Server Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | Status check |
| `/health-check` | GET | Full health report (master, board sync, webhooks) |
| `/resync` | POST | Trigger manual sync from master to all boards |
| `/resolve` | GET | Remove conflicting label from card (from email button) |
| `/trello-webhook` | POST | Trello webhook receiver (label events, master card updates) |

## Rules

- Never manually edit labels on individual boards — always go through the master card
- Removing a label from the master card removes it from ALL cards on ALL 4 boards — use `--dry-run` first
- The sync script is idempotent: safe to run multiple times
- ZINN Internal labels are managed separately (not synced)
- `labels-master.json` removed (May 2026) — master card is now the single source of truth

## Trello Credentials

- Key: `4a2c915a7c7943bee91cd872c9b1df0f`
- Token: `~/.openclaw/credentials/trello-token.txt`

## Shared Library

The webhook server depends on `_shared/` modules:

| Module | Purpose |
|---|---|
| `config.js` | Board IDs, API keys, path constants |
| `trello.js` | Card fetch, label operations |
| `email.js` | Gmail auth, send email |

Sync before Railway deploy:
```bash
cp ~/.openclaw/skills/_shared/*.js ~/.openclaw/skills/label_manager/webhook-server/_shared/
```

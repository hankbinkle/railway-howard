---
name: project_automator
description: Automate task assignment, file management, follow-ups, and other routines when Trello cards move between lists on the ZINN Leads and ZINN Projects boards. Triggered by Trello webhook callbacks. Replaces Make.com workflows.
---

# Project Automator Skill

## Overview

The ZINN project lifecycle is tracked on two Trello boards: **ZINN Leads** (pre-sales funnel) and **ZINN Projects** (active projects). Every card entry into a list triggers a defined set of actions — validations, emails, file operations, checkitems, due dates, and follow-up sequences.

This system runs as an always-live Railway service (`zinn-automation-system` / `entry_actions_server`) that receives Trello webhook callbacks and dispatches the appropriate entry actions.

## Entry Actions

The single source of truth for what happens on each list entry is:

**`entry_actions.md`** (`~/.openclaw/skills/project_automator/entry_actions.md`)

This file is reconciled with the live Trello board. Lists that don't exist on the board have been removed. Archive copies of earlier documentation live in `_backup/`.

## Webhook Integration

> **⚠️ Webhooks are managed via the [webhook_manager](/opt/homebrew/lib/node_modules/openclaw/skills/webhook_manager/SKILL.md) skill.** Do not register, modify, or delete webhooks by hand. Use the webhook_manager scripts and update the ZINN Webhooks master card accordingly.

**Callback URL:** `https://project-setup-production.up.railway.app/entry_actions`

**Boards that need webhooks:**
- ZINN Leads (`5f853408b0549433b0806f3b`)
- ZINN Projects (`5f84a9ea3e629c7eb4b2be27`)

**Payload format:**
```json
{
  "cardId": "{cardid}",
  "fromList": "{previous-list-name}",
  "toList": "{current-list-name}"
}
```

**Trigger:** Card ENTERING a list (not card exit). Archive events are handled separately with different behavior.

## Shared Library

This skill depends on the `_shared/` library at `~/.openclaw/skills/_shared/` for common infrastructure:

| Module | Purpose |
|---|---|
| `dropbox.js` | Token refresh, team member lookup, upload, shared link generation |
| `trello.js` | Card fetch, list operations, field parsing, card movement |
| `db.js` | Postgres connection pool, token CRUD (shared DB with other Railway services) |
| `email.js` | Gmail send with ZINN branding |
| `config.js` | Board IDs, Trello credentials, Dropbox app config |

Before each Railway deploy, run the sync script to pull the latest shared modules:
```bash
bash ~/.openclaw/skills/_shared/sync-shared.sh project_automator
```

## Railway Service

**Project:** `zinn-automation-system`
**Service:** `entry_actions_server`
**URL:** `https://project-setup-production.up.railway.app`

### Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/entry_actions` | POST | Receive Trello webhook, dispatch entry actions |
| `/` | GET | Health check |
| `/cron/followups` | GET | Railway cron endpoint — check due dates, fire follow-up sequences |

### Follow-up Engine

Follow-up sequences (proposal floaters, etc.) are driven by **Railway cron**. The `/cron/followups` endpoint runs on a daily schedule, checks all cards in follow-up lists for overdue due dates, and fires the appropriate actions. See `entry_actions.md` for per-list followup definitions.

### Environment Variables

| Variable | Source |
|---|---|
| `TRELLO_KEY` | `4a2c915a7c7943bee91cd872c9b1df0f` |
| `TRELLO_TOKEN` | `~/.openclaw/credentials/trello-token.txt` |
| `DATABASE_URL` | Auto-provided by Railway (shared Postgres service) |
| `DROPBOX_REFRESH_TOKEN` | Seeded via account_setup / proposal_generator |
| `GMAIL_CREDENTIALS` | `~/.openclaw/credentials/gmail-zinn-credentials.json` |
| `GMAIL_TOKEN` | `~/.openclaw/credentials/gmail-zinn-token.json` |

## Setup Steps

1. Define entry actions for each list (review with Rob)
2. Register Trello webhooks via webhook_manager
3. Build out Railway service with real action execution
4. Wire up shared library dependencies
5. Set up Railway cron for follow-up engine
6. Define Projects board entry actions

## Key Paths

| What | Where |
|---|---|
| Entry actions (source of truth) | `entry_actions.md` |
| Backups of old docs | `_backup/` |
| Shared library | `~/.openclaw/skills/_shared/` |
| Railway server | `entry_actions_server.js` |
| Schema (archived) | `entry_actions_schema.json` |
| Status tracker | `CURRENT_ISSUES.md` |

## Future Improvements

_Logged during design review. Not prioritized for initial build._

- **Automate card field updates**: Cards like "project setup" involve updating Trello card sections (timeline, service level, fee) on entry to the Projects board. Could be automated in a future version.
- **Auto-assign checkitems**: Currently all checkitems are assigned to Rob by default. Future version could route checkitems by label or skill area.
- **Calendar integration**: Create Google Calendar events from meeting template cards.
- **Hours auto-summary**: Auto-calculate and display total hours per phase based on template card hours.

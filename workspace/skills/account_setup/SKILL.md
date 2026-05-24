---
name: account_setup
description: Sets up billing accounts when a lead signs and is moved from Leads to Projects board. Creates Harvest client/project/invoices, sends welcome email, moves Dropbox folder, clears Trello due date.
---

# Account Setup Skill

## Overview

Replaces Make.com scenario `LEADS - MOVE lead to Projects > CREATE Harvest; UPDATE Trello and Dropbox; SEND welcome email`.

Triggered by Trello Butler POSTing `card_id` when a card moves to the Projects board.

## Flow (10 steps)

```
Trello Butler POST /webhook { card_id }
  │
  ├─ 1. Fetch Trello card (name, custom fields, section data)
  ├─ 2. Check Harvest for existing client by project name
  │     ├ new   → Create Harvest client
  │     └ existing → Use existing
  ├─ 3. Parse fee from card description (bullet amounts)
  │     Splits on •, extracts $ amounts, sums them
  ├─ 4. Create Harvest project (fee budget, billing type, hourly rate $100)
  │     └ **Project name:** The billing type from the card's `## Billing Type` section (cleaned). E.g. "Fixed fee", "Hourly no budget", "Hourly NTE". NOT the card/project name. The card name becomes the Harvest client name.
  │     └ `is_fixed_fee` set based on whether billing type contains "hourly".
  ├─ 5. Send welcome email to client (unless "hold!" in general notes)
  │     └ Includes team intro (Rob, Kassia, Robin, Hannah) + headshots
  │     └ proposal_length=long → schedule image + inspo/boundary survey asks
  │     └ proposal_length=medium → same but different image URL
  │     └ Posts comment on card: "welcome email sent at [datetime]"
  │     └ **Greeting rule (per AGENTS.md):** Use all client first names. Females first, then males/unknowns. Join with commas and final "and". E.g. "Hello Mary, Rob, and Frank," or "Hello Ann and Marc,". Split on " and " or commas.
  ├─ 6. Clear due date on Trello card
  ├─ 7. Move Dropbox folder from /projects/_leads/ to /projects/
  └─ 8. Create Harvest invoices (installments)
        └ fee > $10k → 4 invoices over 5 months
        └ fee <= $10k → 2 invoices over 2 months
```

## Deployment

Railway server. Project name: `account-setup` or similar.

```bash
cd ~/.openclaw/skills/account_setup
npm install
railway up
```

## Required Env Vars

| Variable | Source |
|---|---|
| `HARVEST_ACCOUNT_ID` | `1306713` (from `credentials/harvest_token.txt`) |
| `HARVEST_TOKEN` | From `credentials/harvest_token.txt` |
| `DROPBOX_TOKEN` | From `credentials/dropbox_creds.md` (fallback) |
| `DROPBOX_TEAM_MEMBER_ID` | For Dropbox-API-Select-User header |
| `TRELLO_KEY` | `4a2c915a7c7943bee91cd872c9b1df0f` |
| `TRELLO_TOKEN` | From `credentials/trello-token.txt` |
| `DATABASE_URL` | Auto-set by Railway (Postgres service `account_setup_database`) |

Also needs Gmail OAuth tokens at:
- `credentials/gmail-zinn-credentials.json`
- `credentials/gmail-zinn-token.json`

## Dropbox Token Management

Dropbox tokens are persisted in a **PostgreSQL database** (`tokens` table) on Railway.
The existing `DROPBOX_REFRESH_TOKEN` env var is seeded into the DB on first deploy.

The `getDropboxAccessToken()` function:
1. Checks DB for a valid (unexpired) access token → returns it
2. If expired/absent, uses the refresh token (DB first, then env var) to get a new access token
3. Stores the new access token + expiry in DB
4. If Dropbox returns a new refresh token (rotation), stores that too

## Trello Card Format

Card description uses ## sections for structured data:

```
## Client
Company Name
email: client@example.com
phone: 904-555-1234
address: 123 Main St, Jax FL

## Fee
• Schematic Design: $5,000
• Design Development: $5,000
• Construction Documents: $10,000
• Construction Admin: $5,000
billing: Hourly or Fixed Fee

## Project
address: 456 Oak Ave, Jax FL

## General
any notes here — "hold!" skips welcome email
```

## Testing

```bash
# Start server locally
node account-setup.js

# Trigger with curl
curl -X POST http://localhost:3479/setup \
  -H 'Content-Type: application/json' \
  -d '{"card_id":"xxxx"}'
```

## Shared Library

This skill depends on `_shared/` modules for common infrastructure:

| Module | Purpose |
|---|---|
| `config.js` | Board IDs, API keys, path constants |
| `trello.js` | Card fetch, list ops, card movement |
| `dropbox.js` | OAuth token refresh, team member lookup, folder operations |
| `email.js` | Gmail auth, branded HTML emails, drafts |
| `db.js` | Postgres connection pool, token CRUD |
| `harvest.js` | Harvest API client (clients, projects, invoices) |

Sync before Railway deploy:
```bash
bash ~/.openclaw/skills/_shared/sync-shared.sh account_setup
```

## Errors

- If card data parsing fails, email Rob with validation results
- Card stays on Leads board until setup succeeds

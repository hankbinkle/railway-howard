---
name: proposal_estimator
description: Estimate construction costs and design fees for prospects / leads. Railway-hosted web tool that feeds numbers back into the Trello card's Fee section.
---

# Proposal Estimator Skill

## Overview

Interactive web estimator for rough construction cost + design fee ranges. When Rob needs a ballpark number during a conversation, use this to get a quick range and save it to the Trello card.

## Key Paths

| What | Where |
|---|---|
| Server code | `~/.openclaw/skills/proposal_estimator/server.js` |
| Link updater | `~/.openclaw/skills/proposal_estimator/add-estimate-link.js` |
| Railway deployment | `https://skillful-insight-production-ae28.up.railway.app` (project: skillful-insight) |
| Package config | `~/.openclaw/skills/proposal_estimator/package.json` |

## How It Works

1. User visits `https://skillful-insight-production-ae28.up.railway.app` (optionally with `?cardId=X&cardName=Y`)
2. Sets: total area, work area %, cost rate (all client-side)
3. Gets real-time: work area sf, total construction cost, fee range (6-12%)
4. Clicks "Save to Trello Card" → POSTs estimate to server
5. Server updates the Trello card's `## Fee` section with bullet points

## Trello Card Changes

When saved, the server:

- **Fee section:** Adds two bullets:
  - `• Estimated Construction Cost: $XXX,XXX`
  - `• Estimated Fee (6-12%): $X,XXX to $XX,XXX`
- **General section:** Adds `[estimate fees]` link if not already present

If the Fee section is `???` (empty), the bullets replace the `???`. If content exists, bullets append after existing content.

## Add Links to Existing Cards

Run the script to add `[estimate fees]` link to every card's General section:

```bash
node ~/.openclaw/skills/proposal_estimator/add-estimate-link.js
# Dry run first:
node ~/.openclaw/skills/proposal_estimator/add-estimate-link.js --dry-run
```

## Shared Library

This skill depends on `_shared/` modules for common infrastructure:

| Module | Purpose |
|---|---|
| `config.js` | Board IDs, API keys, path constants |
| `trello.js` | Card fetch, list ops, card updates |

Sync before Railway deploy:
```bash
bash ~/.openclaw/skills/_shared/sync-shared.sh proposal_estimator
```

## Deployment

```bash
cd ~/.openclaw/skills/proposal_estimator
npm install
# Set Railway env vars:
#   TRELLO_KEY=4a2c915a7c7943bee91cd872c9b1df0f
#   TRELLO_TOKEN=<from credentials/trello-token.txt>
railway up
```

## Required Railway Env Vars

- `TRELLO_KEY` — Trello API key
- `TRELLO_TOKEN` — Trello API token

## Usage in Conversation

When Rob asks "What would a 3000sf warehouse renovation cost?":

1. Open the estimator page
2. Enter total area = 3000
3. Set work area % to what's being renovated
4. Set cost rate based on rough scope (e.g., $150/sf for light reno, $350/sf for full gut)
5. Read the construction cost and fee range back to Rob
6. If he wants it saved, hit "Save to Trello Card" (requires cardId in URL)

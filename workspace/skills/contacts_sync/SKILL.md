# zinn_contact_sync - Skill

Sync Google Contact Groups to Trello cards in the ZINN Internal board contacts list.

## What It Does

Reads all non-underscore-prefixed Google Contact Groups, fetches member details (name, email, phone, org), and creates/updates Trello cards (one per group) with formatted contact descriptions. Archives cards for deleted groups.

Runs daily at 6am via OpenClaw cron. Emails results to rob@zinn.ai.

## Files

- `index.js` — the sync script (Node.js)
- `sync-state.json` — tracks content hashes per group to detect changes
- `SKILL.md` — this file
- `CURRENT_ISSUES.md` — active issues

## Running Manually

```sh
cd ~/.openclaw/skills/zinn_contact_sync && node index.js
```

Or via cron: configured in OpenClaw cron (`zinn-contact-sync` job).

## Credentials Used

- **Google OAuth**: `/.openclaw/credentials/client_secret_...` + `gmail-zinn-token.json`
- **Trello**: `/.openclaw/credentials/trello-key.txt` + `trello-token.txt`

## How It Works

1. Authenticates Google (refreshes token if expired within 5 min)
2. Fetches all contact groups (skips system groups + `_` prefixed)
3. Batches member lookups (200 per People API batch request)
4. Compares content hash against sync-state.json
5. Creates new cards, updates changed cards, archives stale cards
6. Writes updated state

### Trello Card Format

Card name = contact group name.
Description = sorted contact blocks with name, org, email, phone (Markdown). Capped at ~15KB.

## Cron Config

See `cron list` in OpenClaw. Job name: `zinn-contact-sync`.
Runs isolated, emails summary to rob@zinn.ai after completion.

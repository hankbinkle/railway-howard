# MEMORY.md

## Railway Howard — Always-on OpenClaw Gateway (2026-05-23)

### What It Is
A full OpenClaw gateway running on Railway at https://railway-howard-production.up.railway.app. Independent of the MacBook. Runs DeepSeek V4 Flash with identity files seeded. CLI-accessible and browser-accessible.

### Architecture
- **Dockerfile**: Custom, no wrapper. Runs `openclaw gateway run --bind lan` directly.
- **GitHub**: https://github.com/hankbinkle/railway-howard (public)
- **Railway project**: `railway-howard`, service: `railway-howard`
- **Volume**: 5GB at `/data` — persists config, sessions, workspace
- **Env vars**: 4 API keys + gateway token + state/workspace dirs
- **Device pairing**: CLI and browser devices approved via `admin-http-rpc` plugin

### Key Differences from the Conversation Agent
The Conversation Agent was a custom Node.js Express server. Howard is a full OpenClaw gateway — same skills, plugins, and personality as the local Mac instance.

### To Do
- Live workspace sync (Dropbox or git-triggered redeploy)
- ZINN custom skills (Trello, Dropbox, Gmail tools)
- Memory convergence between Mac and Cloud instances
- Channel setup (Telegram, etc.)

## ZINN Conversation Agent — Always-on Railway Agent (2026-05-17) [RETIRED]

### What It Is
A Railway-hosted conversational AI agent at `https://zinnconversationagent-production.up.railway.app/`. Always online, phone-friendly chat UI with TTS, accessible from any browser. No laptop dependency.

### Architecture
- **Skill**: `~/.openclaw/skills/zinn_conversation_agent/`
- **Railway project**: `zinn_conversation_agent`, service: `zinn_conversation_agent`
- **Postgres**: `Postgres-W7mv` — `agent_conversations` table for conversation persistence
- **LLM**: DeepSeek v4 Flash via direct fetch (no SDK), OpenAI-compatible tool calling
- **Tools**: 12 tools (Trello CRUD, Dropbox listing, Gmail drafts) via `_shared/` library
- **Intent matcher**: `intent.js` pre-processes messages for reliable tool execution
- **Drop zone**: `/Rob Zinn/_agent_drop_zone/` in ZINN Dropbox

### Key Env Vars
`DEEPSEEK_API_KEY`, `LLM_MODEL=deepseek-v4-flash`, `TRELLO_KEY`, `TRELLO_TOKEN`, `DROPBOX_*`, `GMAIL_*`, `DATABASE_URL`

### Status (2026-05-22)
- **Postgres database**: Was CRASHED — redeployed successfully. Renamed from `Postgres-W7mv` to `zinn_conversation_agent_database`. ✅
- **Stale service**: Removed `elegant-forgiveness` (empty, undepoyed shell). ✅
- **Server fix**: Added `initDb()` call to server startup — `tokens` and `settings` tables now created on boot. ✅
- **System prompt**: Toned down to not proactively check the drop zone or mention tools. ✅
- **TTS/speaker**: Fixed iOS voice loading — warmup on touch, retry on synthesis errors. ✅
- **Dropbox**: Fully working, token caching via DB now operational. ✅
- **DeepSeek**: Correct model `deepseek-v4-flash`, responsive (~1.2s). ✅
- **Railway CLI**: Auth works via `RAILWAY_API_TOKEN` env var (set in .zshrc for convenience). ✅

### Workspace Sync
- **Dropbox workspace folder**: `/Rob Zinn/_openclaw_workspace/` created and seeded with SOUL.md, AGENTS.md, MEMORY.md, USER.md, TOOLS.md
- **Read workflow**: Intent-activated — "read SOUL", "load my workspace" triggers file load via Dropbox API
- **Write workflow**: Direct REST endpoint `/api/workspace/upload` for bulk seeding; small writes via intents ("remember", "save to MEMORY.md")

### Remaining
Fix intent write pipeline for large files (>4K with special chars), add custom domain.

---

## Shared Library — Architecture Decisions (2026-05-16)

### What It Is
`~/.openclaw/skills/_shared/` is a centralized library of infrastructure modules shared across all 5 Railway services. Each service has a synced copy at its own `_shared/` subdirectory.

### Modules (8 total)

| Module | What it does | Used by |
|---|---|---|
| `config.js` | Board IDs, API keys, path constants, Trello list IDs | ALL |
| `trello.js` | Card fetch, list ops, field parsing, card updates, comments, checkitems | ALL |
| `dropbox.js` | OAuth token refresh (team-scoped), file upload/move/copy/delete/list, shared link gen | account_setup, proposal_generator |
| `email.js` | Gmail auth (file or env var), branded HTML send/draft, inline CID logos, PDF attachments, `notifyOnFailure()` | account_setup, proposal_generator, label_manager |
| `db.js` | Postgres connection pool, token CRUD, settings key-value store | account_setup, proposal_generator |
| `harvest.js` | Harvest API client: clients, projects, invoices, paginated fetches | account_setup |
| `pdf.js` | Puppeteer lifecycle, Chrome path detection, standard PDF options | proposal_generator |
| `logger.js` | Timestamped namespace logging: `const log = logger('name'); log.info(...)` | Any |

### Key Design Decisions
- **No external dependencies** beyond what each Railway service already has (pg, node-fetch, googleapis, puppeteer)
- **Functions, not classes** — plain async functions with consistent signatures
- **Console-based logging** — each function logs its own prefix like `[shared/dropbox]`
- **Graceful degradation** — return `null` or `false` on failure, never throw uncaught
- **Backward compatible** — skills migrated incrementally without breaking production

### How to Use
```bash
# Sync latest shared modules into a skill before Railway deploy
bash ~/.openclaw/skills/_shared/sync-shared.sh proposal_estimator

# For label_manager (lives in subdirectory):
bash ~/.openclaw/skills/_shared/sync-shared.sh label_manager webhook-server
```

### Error Notifications
Any service can fire a notification to rob@zinn.ai:
```js
await email.notifyOnFailure({
  service: 'account_setup',
  error: 'Something went wrong',
  cardName: 'Smith Project',
  cardId: 'abc123',
});
```
Creates a branded Gmail draft with service name, Trello link, and error details.

### Railway Deployments (5 services)

| Service | URL | Deployed |
|---|---|---|
| account_setup | accountsetup-production.up.railway.app | ✅ |
| proposal_generator | zinn-proposals-production.up.railway.app | ✅ |
| proposal_estimator | skillful-insight-production-ae28.up.railway.app | ✅ |
| label_manager (webhook-server) | zinn-labels-production.up.railway.app | ✅ |
| project_automator (entry_actions_server) | project-setup-production.up.railway.app | ✅ |

All services have local `.railway/config.json` to survive CLI config resets.

---

## Project Automator — Architecture Decisions (2026-05-16)

### Key Design Decisions
- **All client comms are Gmail drafts**, never sent automatically. Rob reviews and sends.
- **Follow-ups run on Railway cron** (M-F 9-5, every 2 hours), not OpenClaw cron or macOS.
- **Indefinite monthly check-in loop** replaces the old "proposal floaters" list. Applies to all 3 lead lists (project intro, site consult, proposal) after 2 explicit followups expire.
- **8 rotating email bodies** from old Make.com, never send same body twice to same lead.
- **Archive action** on any Leads card: move `_leads/{slug}` → `_leads/_dead_leads/{slug}` in Dropbox.
- **Shared library** at `~/.openclaw/skills/_shared/` with sync-shared.sh for pre-deploy. Extracted from proposal_generator + account_setup.
- **Nomenclature**: "entry_actions" everywhere — not "transition" or "dispatcher".

### Schema needed
- `card_advancement` per list (manual/automatic)
- Conditional branching (if_valid / if_invalid)
- Validation mode (required/informational)
- `archive_actions` per list or global
- Indefinite loop state (rotation counter per card)

### Calendly URLs
- Intake (initial): https://calendly.com/robzinn/phone_call_new_project_evaluation
- Intake (follow-up): https://calendly.com/robzinn/phone-call-follow-up-project-evaluation
- Site consult (initial): https://calendly.com/robzinn/new_on_site_project_evaluation
- Site consult (follow-up): https://calendly.com/robzinn/follow_up_project_evaluation

### Standard email signature
```
Thank you,

Rob.

----------------------------
Rob Zinn, AIA NCARB
zinn.ai
[zinn logo]
904.253.6117
----------------------------
```
Greeting: ZINN standard (first names, female first).

### Email Subject Standard
All automated emails follow: **`{ProjectName} - {Reason}`**

Examples:
- `Smith Project - Getting Started!` (welcome)
- `Smith Project - Proposal` (proposal draft)
- `Smith Project - Proposal Signed` (confirmation)
- `Smith Project - Label Conflict` (conflict alert)
- `Smith Project - Error` (failure notification)

---

## 2026-05-22 — Remote Agent Workspace Sync

### What was built
- ZINN Conversation Agent on Railway: https://zinnconversationagent-production.up.railway.app/
- DeepSeek v4 Flash agent with 12 tools (Trello, Dropbox, Gmail, workspace files)
- Mobile-friendly chat UI with TTS
- Dropbox workspace folder at ZINN Dropbox > Rob Zinn > _openclaw_workspace/
- Intent matcher for reliable tool triggering
- Direct API endpoints for workspace read/write

### What was fixed
- Crashed Postgres database — redeployed and renamed
- Agent proactively calling tools on casual messages — toned down system prompt + needsTool regex
- Dropbox writes not syncing to desktop — removed namespace root header
- Response body double-read causing 502 errors
- TTS not working on iOS — audio warmup + voice preloading
- Intent pipeline corrupting large file writes — added direct API endpoints

### Current state (incomplete)
- 5 identity files (SOUL, AGENTS, MEMORY, USER, TOOLS) are symlinked from local workspace to Dropbox
- Backup script (`backup_openclaw.sh`) preserves symlinks as symlinks — restore would not recover file content for those 5 files
- Rob is deciding how to handle the backup/write conflict and whether to remove local OpenClaw files entirely
- Orphaned SketchUp/LayOut files (~3MB) in workspace need cleanup
- memory/ folder, HEARTBEAT.md, IDENTITY.md need decisions on sync vs delete vs keep local
- Full summary written to ~/.openclaw/workspace/ZINN_REMOTE_AGENT_SUMMARY.md

### Deployment details [RETIRED — project deleted 2026-05-23]
- Railway project: `zinn_conversation_agent`, service: `zinn_conversation_agent`
- Postgres: `zinn_conversation_agent_database`
- Deploy via RAILWAY_API_TOKEN (railway-token.txt, not railway_token.txt — old token is expired)

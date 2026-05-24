---
name: proposal_generator
description: Generate, debug, and improve ZINN Architecture proposals from Trello Leads cards. Use when Rob asks to generate a proposal, fix the proposal system, update proposal content or templates, regenerate a draft email, or diagnose why a proposal failed. Triggers on phrases like "generate a proposal", "proposal for [project]", "proposal system", "fix the proposal", "proposal email", "regenerate the draft".
---

# Proposal Generator Skill

## Overview

Generates branded HTML/PDF proposals from Trello Leads cards and creates a Gmail draft to the client. Replaces the old Qwilr + Make.com workflow entirely.

## Trello Card formatting and data structure

see 'openclaw/workspace/TRELLO_CARDS.md'

## CORE FEATURE: Sign Flow (end-to-end)

When a client signs via the web proposal link, the following happens in order:

1. Puppeteer generates a fully branded PDF on the Railway server
2. PDF uploads to the correct Dropbox team folder via API
3. Dropbox returns a shareable download link
4. Client receives a confirmation email with the download link (no attachment)
5. Rob is CC'd on the confirmation email
6. Proposal is marked accepted in DB — `/p/<cardId>` redirects to accepted view

This flow is fully operational as of 2026-05-11.

## PDF Generation — Puppeteer

Puppeteer generates all PDFs. There is no fallback — if Puppeteer fails, fix it. Do not invest time in alternate PDF methods.

### Critical: No Google Fonts in PDF Header Template

The `headerTemplate` in `getPdfOptions()` must NOT contain `@import url('https://fonts.googleapis.com/')`. External font imports in Puppeteer's header/footer templates cause `Protocol error (Page.printToPDF): Printing failed`. The main proposal HTML body can still load Google Fonts via a `<link>` tag — only the header template is affected.

### Puppeteer on Railway

Chrome is installed during the build via `postinstall` in `package.json`:
```
"postinstall": "npx puppeteer browsers install chrome || echo 'Warning: Chrome install failed'"
```
Railway runs `npm ci` which triggers postinstall. Chrome lands at:
`/app/node_modules/.puppeteer-cache/chrome/linux-<version>/chrome-linux64/chrome`

`pdf-worker.js` uses `puppeteer.executablePath()` to find it automatically.

### Local Mac — Chrome Install

Run once if Chrome isn't installed locally:
```bash
cd ~/.openclaw/skills/proposal_generator
npx puppeteer browsers install chrome
```

### printToPDF Fix

`pdf-worker.js` uses `waitUntil: 'networkidle0'` + a 500ms settle delay before calling `page.pdf()`. This prevents the "Printing failed" protocol error.

## Dropbox — Team Folder Upload

### How It Works

The Dropbox app token is a **team-scoped token** (because the app has `team_data.content.write` scope). Team tokens cannot call single-user file endpoints directly — they require `Dropbox-API-Select-User` header to act on behalf of a specific team member.

The upload flow in `uploadSignedPdfToDropbox()`:
1. Get a fresh access token via OAuth refresh (stored in Railway Postgres `settings` table as `dropbox_refresh_token`)
2. Call `team/members/list_v2` — wait, this 404s. Use `team/members/list` (no version suffix) to get all team members, find `rob@zinn.ai`, extract `team_member_id`
3. Set `Dropbox-API-Select-User: <team_member_id>` on all subsequent calls
4. Call `users/get_current_account` (with Select-User) to get the team root namespace ID
5. Set `Dropbox-API-Path-Root: {"namespace_id": "<id>"}` header
6. Upload to `/projects/_leads/{slug}/_bids_proposals_and_quotes/{filename}`
7. Call `sharing/create_shared_link_with_settings` to get a public download link
8. Return the link for inclusion in the email

### Upload Path

Always relative to the team root namespace (no `/ZINN Dropbox/` prefix):
```
/projects/_leads/{slug}/_bids_proposals_and_quotes/{filename}
```

Slug is derived from `project_name`: lowercase, spaces→underscores, apostrophes stripped.

### Required Dropbox App Scopes

The Dropbox app (ID: 7085171) must have ALL of these in the Permissions tab:
- `files.content.write`
- `files.content.read`
- `team_data.content.write`
- `team_data.member`
- `members.read`
- `sharing.write` ← required for shared link generation

If `sharing.write` is missing, uploads succeed but links fail with "not permitted to access this endpoint."

### Dropbox OAuth — Re-authorization

After changing app scopes or if the refresh token expires:
1. Visit `https://zinn-proposals-production.up.railway.app/auth/dropbox`
2. Authorize — refresh token is stored in Railway Postgres automatically

### Dropbox API Endpoint Notes (learned the hard way)

- `team/members/list_v2` → 404. Use `team/members/list` (no version suffix)
- `team/members/get_info` → body must be a bare JSON array `[{".tag":"email","email":"rob@zinn.ai"}]`, NOT wrapped in `{"members": [...]}`
- `users/get_current_account` → 400 with team token unless `Dropbox-API-Select-User` is set
- `sharing/create_shared_link_with_settings` → response may be plain text error, not JSON. Always use `.text()` then try JSON.parse, never `.json()` directly
- Shared link "already exists" error: check `linkData.error.shared_link_already_exists.metadata.url`

### Debug Endpoint

`GET https://zinn-proposals-production.up.railway.app/debug/dropbox`

Returns live test results for: `users/get_current_account`, `team/members/get_info`, `team/get_info`, `team/members/list`. Use this to diagnose token/scope issues without running a full sign.

## Key Paths

| What | Where |
|---|---|
| Main script | `~/.openclaw/skills/proposal_generator/generate-proposal.js` |
| PDF worker | `~/.openclaw/skills/proposal_generator/pdf-worker.js` |
| HTML template | `~/.openclaw/skills/proposal_generator/templates/proposal.html` |
| Content blocks | `~/.openclaw/skills/proposal_generator/content/blocks.json` |
| Reference proposal | `~/.openclaw/skills/proposal_generator/example_proposal2.pdf` |
| Email logo | `~/ZINN Dropbox/marketing/branding/logos/_logo-email.png` |
| Gmail creds | `~/.openclaw/credentials/gmail-zinn-credentials.json` |
| Gmail token | `~/.openclaw/credentials/gmail-zinn-token.json` |
| Dropbox creds | `~/.openclaw/credentials/dropbox_creds.md` |
| Railway server | `https://zinn-proposals-production.up.railway.app` |
| Railway project ID | `9fb786ec-637b-4028-b0a7-f53c92dbcbf2` |
| Railway service ID | `afc15424-c208-431f-bb5a-2c2627502cfc` |
| Output (local) | `~/ZINN Dropbox/projects/_leads/[slug]/_bids_proposals_and_quotes/` |

## How to Generate a Proposal (Local)

```bash
cd ~/.openclaw/skills/proposal_generator
PUBLIC_URL=https://zinn-proposals-production.up.railway.app \
  node generate-proposal.js <cardId>
```

This creates: branded PDF in Dropbox project folder + Gmail draft to client.

Always use `PUBLIC_URL` so the "View Proposal" button links to the live Railway URL.

## How to Deploy to Railway

The skill folder IS the Railway git repo. Deploy from there directly:

```bash
cd ~/.openclaw/skills/proposal_generator
git add generate-proposal.js pdf-worker.js  # (and any other changed files)
git commit -m "Description of change"
railway up
```

**Important:** Railway deployments take 2-4 minutes to go live after `railway up` exits. The build must install Chrome (via postinstall) which adds time. Verify the new code is live before testing by checking `/health` or a known changed endpoint.

**Do NOT** create temp deploy directories — the skill folder itself is the repo and deploys directly.

## How to Test the Sign Flow

```bash
# Reset a proposal (remove accepted state)
curl -s -X POST "https://zinn-proposals-production.up.railway.app/reset/<cardId>"

# Trigger a test sign (use a throwaway email, NOT rob@zinn.ai)
curl -s -X POST "https://zinn-proposals-production.up.railway.app/sign" \
  -H "Content-Type: application/json" \
  -d '{
    "cardId": "<cardId>",
    "name": "Test Client",
    "email": "test@example.com",
    "signature": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "signedAt": "2026-01-01T00:00:00Z",
    "optionalChecked": [],
    "tieredSelected": {}
  }'

# Check logs for results
railway logs --since 2m
```

**Always use a throwaway email during testing** — every sign sends a confirmation email to whatever address is provided AND CC's rob@zinn.ai. Using rob@zinn.ai as test recipient floods his inbox.

**Always reset after testing** so Rob can still access the live proposal.

## Railway Logs — Reading Sign Results

Key log prefixes to watch:
- `[sign]` — sign flow steps (PDF generation, email, etc.)
- `[dropbox]` — upload, member lookup, shared link
- `[pdf]` — Chrome/Puppeteer details from pdf-worker

A successful sign flow looks like:
```
[sign] Full PDF generated via Puppeteer.
[sign] Signed PDF saved: /app/output/...
[dropbox] Got fresh access token via OAuth refresh
[dropbox] Acting as member: dbmid:...
[dropbox] Team root namespace: 2553000243
[dropbox] Using team root namespace: 2553000243
[dropbox] Uploaded: /projects/_leads/.../proposal-...-signed.pdf (XXXXXX bytes)
[dropbox] Shared link response (200): {...}
[dropbox] Shared link: https://dl.dropboxusercontent.com/...
[dropbox] Upload complete. Link: https://...
[sign] Client confirmation sent to <email>.
```

## Proposal Lifecycle

- **Active:** `/p/<cardId>` serves the interactive proposal
- **Accepted:** After signing, `/p/<cardId>` redirects to `/accepted/<cardId>` — read-only
- **Reset:** `POST /reset/<cardId>` clears accepted state (dev/testing only)
- **No-cache:** append `?nocache=1` to `/p/<cardId>` to re-render fresh from Trello

## Proposal Lengths

| Length | Trigger | Sections included |
|---|---|---|
| short | "short", "repeat client", "experienced client", "life safety only" | Scope, Fee, Billing, General Conditions |
| medium | default | + Phases and Services, Furnishings and Decor |
| long | "long", "full" | + How We Work, Our Team, Client List, Portfolio |

## Email Rules

- Send to **all** email addresses in the ## Client section
- Greeting: first names only, **female first**: "Hello Ann and Marc,"
- Subject: `Project Name - Proposal` (plain hyphen, no em dash)
- Client confirmation email (post-sign): includes Dropbox download link, no PDF attachment
- Initial proposal draft: includes "View Proposal" button linking to Railway URL

## Email Branding Standards

- Body background: `#f0f0f0`
- Content panel: `#ffffff`, `max-width:600px`, `padding:32px 40px`
- Font: `'Avenir Next', Avenir, 'Helvetica Neue', Helvetica, Arial, sans-serif`
- Font must be on every `<td>` and `<p>` — Gmail strips body/table-level declarations
- Logo: CID inline (`cid:zinn-logo`) — never data: URI (Gmail blocks those)
- Dividers: `<div style="border-top:1px solid #000">` not `<hr>`

## Proposal Content Rules

- **Never truncate, shorten, or paraphrase** any section text. Match `example_proposal2.pdf` word for word.
- Client/project name: sentence case, never ALL CAPS
- All phase descriptions, GC sections, team bios — exact wording from the reference PDF

## General Conditions Sections (all required)

1. Intro paragraph  2. Definitions  3. Scope Changes  4. Engineering  5. Drafts  6. Comment and Production Periods  7. Additional Services  8. Hourly Work (Principal $250, Project Lead $175, Draftsperson $125, Administrator $100)  9. Other Events Prompting Additional Services  10. Payment and Invoicing  11. Business Hours  12. OFCI Items  13. Construction Cost and Value Engineering  14. Reimbursable Expenses  15. Reference Materials  16. Building Code  17. Billing & Payment  18. Liability  19. Design Control  20. Instruments of Service  21. Photography and Marketing  22. Accreditation  23. Anti-Defamation  24. Contract  25. Non-Disparagement  26. Modification and Termination

## Team Bios (long proposals)

Order: Kassia, Rob, Lindsay, Robin, Hannah, Shukry, Shireen, Todd.

## Known Gotchas

- **JS inside template literals**: acceptance block script is inside a Node.js template literal. Use double quotes inside inline JS strings — single quotes break the parser silently.
- **tieredSelected type**: the sign endpoint receives `tieredSelected` as either an array or object depending on client. Always guard with `Array.isArray(tieredSelected) ? tieredSelected : []`.
- **Railway deploy lag**: allow 2-4 minutes after `railway up` before testing. The old container keeps serving until the new one is healthy.
- **Multiple drafts**: running `generate-proposal.js` multiple times creates multiple drafts. Always check/clean drafts after debugging runs.
- **Railway link**: the skill folder must be linked to `zinn-proposals` project / `zinn-proposals` service. Run `railway status` to verify before deploying.
- **Company client greeting**: if Client section has a company name + `attention:` line, greeting uses the attention contact's first name.

## TODO

- [x] Trello automation button on Leads board (POST to Railway URL on card move)
- [ ] Card auto-move on send (currently moves on generation, not send)

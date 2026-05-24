# SKILL.md — Statement Harvester

## Purpose
Monthly automated retrieval of PDF statements and transaction records from 11+ financial institutions. Rob initiates around the 1st of each month to collect the prior month's documents.

## Trigger Phrases
"run statements", "harvest statements", "get last month's statements", "statement run", "grab statements", "monthly statements"

## Skill Location
`~/.openclaw/skills/statement_harvester/`

## Overview
Hybrid two-worker system:
- **Worker A (API Pipe):** Plaid API for major banks/investments
- **Worker B (Agentic Pilot):** Browser-use + Playwright for niche/loan portals

---

## Institution Map

| Institution | Method | Notes |
|---|---|---|
| Chase | Plaid | High bot detection |
| Amex | Plaid | High bot detection |
| Citi | Plaid | High bot detection |
| Regions | Plaid | High bot detection |
| Schwab | Plaid | Strict MFA |
| Fidelity | Plaid | Strict MFA |
| VyStar | Browser-use | Credit union portal |
| Subaru/Chase Lease | Browser-use | Lease portal |
| Opportun | Browser-use | Loan portal |
| MOHELA | Browser-use | Student loan servicer |
| AmeriSave | Browser-use | Mortgage portal |

---

## Workflow (Monthly Run)

### Step 1 — Determine Target Month
Derive prior calendar month from current date.
Format: `YYYY-MM` (e.g., `2026-04`)

### Step 2 — API Retrieval (Worker A)
Run: `scripts/worker_a_plaid.py`
- Calls Plaid Statement API for all linked institutions
- Saves PDFs to `output/YYYY-MM/`
- Logs results to `output/YYYY-MM/run_log.json`

### Step 3 — Agentic Retrieval (Worker B)
Run: `scripts/worker_b_agent.py`
- Launches visible (non-headless) Chromium
- Processes each browser-use institution in sequence
- Pauses at MFA prompts — Rob enters code in terminal or browser
- Downloads statements to `output/YYYY-MM/`

### Step 4 — Standardize Filenames
Run: `scripts/standardize.py`
- Renames all downloaded files to: `YYYY-MM-DD_Institution_AccountType.pdf`
- Moves to final archive structure

### Step 5 — Summary Report
- Howard reads `run_log.json` and presents a clean status table
- Notes any failures requiring manual follow-up

---

## Output Folder Structure
```
output/
  YYYY-MM/
    raw/          ← original downloads land here
    final/        ← standardized, renamed files
    run_log.json  ← success/failure per institution
```

---

## Archive Structure (local or S3)
```
statements/
  YYYY/
    MM-MonthName/
      YYYY-MM-DD_Chase_Checking.pdf
      YYYY-MM-DD_Amex_CreditCard.pdf
      ...
```

---

## Environment Variables (.env)
Located at: `~/.openclaw/skills/statement_harvester/.env`
```
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=development
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
STATEMENTS_ARCHIVE_PATH=
```

## Credentials Storage
- All credentials in `.env` — never hardcoded
- Browser session cookies cached at `content/sessions/` (persistent context)
- Plaid access tokens stored encrypted at `content/plaid_tokens.enc`

---

## Setup Checklist (one-time)
See `content/SETUP_GUIDE.md` for step-by-step instructions.

---

## Security Rules
- LLM vision receives sanitized DOM snapshots only — no raw page HTML with account numbers
- Browser runs locally (consistent IP = trusted by banks)
- No credentials sent to any cloud service
- `.env` and `content/sessions/` are gitignored

---

## Monthly Run Command (Howard initiates)
```
cd ~/.openclaw/skills/statement_harvester
python scripts/orchestrator.py --month YYYY-MM
```

Howard will:
1. Confirm target month with Rob
2. Launch orchestrator
3. Monitor run and notify Rob of MFA pauses
4. Present completion summary

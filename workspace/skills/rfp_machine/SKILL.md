---
name: rfp_machine
description: Respond to government and municipal RFPs/RFQs for ZINN Architecture. Use when Rob asks to respond to a solicitation, prepare a Statement of Qualifications (SOQ), assemble a consultant team, generate submission documents, or prepare forms for a government procurement portal. Triggers on phrases like "respond to this RFP", "prepare an SOQ", "RFP response", "solicitation response", "assemble team for RFP", "generate submission documents", "COJ bid", "government RFP".
---

# RFP Machine

ZINN Architecture's fully automated pipeline for responding to government and municipal RFPs and RFQs. Covers: solicitation intake → deadline scheduling → team assembly → consultant outreach → SOQ authoring → document generation → PDF assembly → portal submission.

## Quick Start

1. **New RFP arrives** → Read the PDF, extract key info
2. **Parse RFP** → Identify deadline, scoring criteria, JSEB requirements, required forms
3. **Create project folder** → Scaffold standard structure under `~/ZINN Dropbox/projects/_leads/`
4. **Schedule deadlines** → Add submission and materials deadlines to Google Calendar
5. **Draft consultant outreach** → Generate invitation emails for team
6. **Collect materials** → Place in `_rfp/_incoming/` folder (3 working days before deadline)
7. **Write SOQ** → Section by section, referencing portfolio projects
8. **Generate documents** → Title page, cover letter, forms, org chart, resumes
9. **Merge PDFs** → Combine in required order
10. **Submit** → Follow portal instructions

## Step 1: Solicitation Intake

When a new solicitation arrives (email, portal alert, or referral from Kevin Knowles):
- Read the full RFP/RFQ PDF (use `pdf` tool)
- Extract: title, solicitation number, buyer name/email, submission deadline (exact date/time/timezone), submission portal URL, page limits for SOQ, evaluation criteria with point weights, required forms (JSEB, insurance, certifications), JSEB participation percentage required
- Save extracted analysis to `_rfp/rfp-analysis.md` inside the project folder
- Note: qualifications-based (no price) vs. price-based RFP

## Step 2: Deadline Scheduling

**Immediately after parsing the RFP:**

```bash
gog calendar create primary \
  --summary "[RFP Title] — RFP Due" \
  --from "2026-03-26T10:00:00-04:00" \
  --to "2026-03-26T11:00:00-04:00" \
  --event-color 1 \
  --description "Submission portal: [URL]\nBuyer: [Name] ([Email])"
```

**Materials deadline** (3 working days before submission):
```bash
gog calendar create primary \
  --summary "RFP Materials Due — [RFP Title]" \
  --from "2026-03-23T17:00:00-04:00" \
  --event-color 4 \
  --attendees "kckcei@juno.com,prowland@russrow.com,nashwan@nmotioneng.com"
```

Both events appear on Rob's Google Calendar + team members are invited to materials deadline.

See `references/calendar-and-deadlines.md` for full details and event color codes.

## Step 3: Project Folder Structure

Create the project folder: `~/ZINN Dropbox/projects/_leads/<slug>/`

Standard subfolders:
```
_bids_proposals_and_quotes/
_client_provided/
_correspondence/
_existing_conditions/
_meeting_notes/
_permitting_property_and_code/
_product_info/
_rfp/
  _amendments/
  _backup/
  _forms/
  _incoming/               ← Consultant materials go here
  _resumes/
  _submission/
  _support/
    _scripts/
    _jseb/
    _reference/
```

Naming: `<agency>_<project_name>_<solicitation_number>` — all lowercase, underscores.

Example: `coj_park_projects_west_17592-26`

## Step 4: Consultant Outreach

See `references/consultant-outreach.md` for full workflow.

**Quick version:**
1. Identify required disciplines from RFP scope
2. Select team from `references/team-roster.md`
3. Draft outreach email (automated via Gmail API)
4. Create Google Calendar event with materials deadline (3 working days before RFP due)
5. Rob reviews and sends email; team members get calendar invite
6. Subs return materials to `_rfp/_incoming/` folder

**Materials deadline folder structure:**
```
_rfp/_incoming/
  _incoming-README.txt           ← Print & send to subs
  03-local-business-tax-cert.pdf
  04-insurance-cert.pdf
  05-jseb-form2-knowles.pdf      ← One per sub
  06-jseb-form2-russell_rowland.pdf
  07-jseb-cert-knowles.pdf
  08-jseb-cert-zinn.pdf
  22-sunbiz-registration.pdf
  (resumes + project descriptions come from _resumes/ after generation)
```

## Step 5: Insurance Certificate

**Automated outreach email to Jessica Rainey:**
```bash
Subject: Insurance Certificate for COJ Procurement — [RFP Title]
To: jrainey@holmesorg.com

Requires:
- Certificate of Insurance (ACORD form)
- Coverage: General Liability + Professional Liability
- Additional Insured: City of Jacksonville / [Agency]
- Deadline: [Materials Deadline]
```

When Jessica sends the cert, save the **ACORD page only** (not the full policy) to:
`_rfp/_incoming/04-insurance-cert.pdf`

## Step 6: SOQ Authoring`

See `references/soq-writing.md` for full guidance on structure, scoring strategy, common pitfalls.

**Quick version:**
- Write one section per evaluation criterion (match RFP structure exactly)
- Lead with JSEB certification (ZINN is JSEB-certified as prime — major advantage)
- Include both Rob and Kassia as principals
- Close with Summary section mapping team strengths to each criterion by points
- Respect page limit (typically 12 pages for Section 5)
- Write as HTML, convert to PDF via Puppeteer

**Portfolio reference:** See `references/project-portfolio.md` for all 80+ ZINN projects. Select 3–5 that match RFP scope (parks/public facilities, institutional, commercial, etc.).

## Step 7: Document Generation

Generate each required document as HTML → PDF:
- Title page
- Cover letter (signed, include EIN: 20-4979996)
- Org chart (all firms, personnel, JSEB/WOSB badges)
- JSEB Form 1 (Schedule of Participation)
- JSEB Form 2s (one per sub — must be signed)
- Volume of Work (Attachment A-1)
- Conflict of Interest form (signed)
- Errors & Omissions form (signed)
- Resumes (with circular headshots)

**Templates:** Located in `assets/document-templates/` — ready to populate with RFP-specific data.

**Headshots:** Located in `assets/headshots/`. New headshots go here + `_rfp/_resumes/headshots/` for future reference.

**Recurring assets** (check expiration before each submission):
- Business Tax Certificate: `~/ZINN Dropbox/admin/licenses/` (exp 2026/09/30)
- Insurance cert: request from Jessica Rainey (1 week lead time)
- Sunbiz registration: pull live from sunbiz.org (Doc # P06000081935) — needs browser
- ZINN JSEB cert: `_rfp/_support/_jseb/` or `~/ZINN Dropbox/admin/licenses/`
- Rob resume: `~/ZINN Dropbox/marketing/resumes/resume-rob.pdf`
- Kassia resume: `~/ZINN Dropbox/marketing/resumes/resume-kassia.pdf`

## Step 8: PDF Assembly & Merge

Use the merge script to combine all documents in the required COJ order:

```bash
python3 ~/.openclaw/skills/rfp_machine/scripts/merge-submission.py \
  ~/ZINN\ Dropbox/projects/_leads/coj_park_projects_west_17592-26/_rfp
```

The script:
1. Looks for documents in `_submission/` and `_incoming/` folders
2. Merges in the fixed COJ order (title → cover letter → certs → forms → org chart → resumes → SOQ)
3. Reports missing documents
4. Outputs a single submission PDF: `ZINN_Architecture_[project_name]_Proposal.pdf`

See `references/coj-portal.md` for the exact document order.

## Step 9: Portal Submission

For COJ 1Cloud (typical workflow):
1. **Step 1 — Overview:** Review solicitation details
2. **Step 2 — Requirements:** Upload filled XML (auto-populates acknowledgments) + PDF attachment
3. **Step 3 — Price:** Enter $1.00 (qualifications-based contracts)
4. **Step 4 — Review:** Confirm all sections complete
5. **Submit:** Verify receipt email from COJ

**Critical:** PDF must go in Step 2 > Section > Response Attachments (NOT Step 1 attachments).

See `references/coj-portal.md` for step-by-step walkthrough + common gotchas.

## Reference Files

- **`team-roster.md`** — Current consultant team (Kevin Knowles, Russell Rowland, nMotion) + contact details, JSEB status, past collaborations
- **`soq-writing.md`** — SOQ structure, COJ scoring criteria/weights, writing rules, ZINN voice, common pitfalls
- **`coj-portal.md`** — 1Cloud portal procedures, exact document assembly order, XML upload, submission checklist
- **`consultant-outreach.md`** — Team assembly workflow, materials timeline, email templates, Google Calendar deadlines
- **`calendar-and-deadlines.md`** — Google Calendar integration, event creation, gog CLI commands
- **`project-portfolio.md`** — All 80+ ZINN projects organized by type, portfolio folder structure, how to write blurbs from Trello cards

## Scripts & Assets

**Scripts:**
- `rfp-response-machine.js` — Orchestrator (legacy, may need updates)
- `merge-submission.py` — PDF merge utility (main production script)
- `generate-resumes.js` — Resume HTML generator with headshots

**Assets:**
- `assets/document-templates/` — HTML templates for all standard documents (title page, cover letter, org chart, forms, SOQ)
- `assets/headshots/` — Headshot library (Rob, Kassia, Kevin Knowles, Russell Rowland team, nMotion team)

## Future Enhancements

1. **Ongoing RFP Discovery** — Weekly cron to monitor COJ portal + partners for new A&E solicitations
2. **Portfolio Database** — Migrate portfolio to Google Sheets + Dropbox API for auto-blurb insertion + image carousel
3. **Gmail Inbox Monitoring** — Auto-detect email replies from subs with materials, pull attachments to `_incoming/`
4. **Headshot Auto-Crop** — Detect and crop headshot photos to circular format automatically
5. **SOQ Quality Checks** — Validate page count, JSEB percentages, evaluation criteria mapping before submission

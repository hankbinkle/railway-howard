# TRELLO_DATA_SCHEMA.md — Using Trello Descriptions as Structured Data

## Concept

ZINN uses Trello like a database. Cards store structured data in their descriptions using Markdown format, allowing both human readability and programmatic access.

## Hierarchy

- **Boards** → Projects, Leads, ZPT2
- **Lists** → Pipeline stages (New Prospects, Project Intro, Site Consult, Proposal, etc.)
- **Cards** → Individual leads, projects, or tasks

## Description Format

Cards are divided into sections delimited by `---` and `## H2` headings:

```
---

## Section Name

data content here...

---
```

## Card Sections (active fields)

| Section | Purpose |
|---|---|
| ## General Notes | Misc notes, VIP/hold/ignore flags |
| ## Project Address | Street, city, state, zip |
| ## Client | Fullname(s), company, address, email(s) |
| ## Budget | Estimated or target budget |
| ## Scope | Description of work to be performed |
| ## Fee | Itemized fee lines (see format below) |
| ## Area | Square footage |
| ## Phases | Selected phases (Checklist of phases) |
| ## Billing Type | Fixed fee / Hourly no budget / Hourly NTE |
| ## Proposal Length | long / medium / short |
| ## Status | Schedule link + status notes |

### Fee Line Format

```
Description: $1,234.00                          → Standard line
Description (optional): $1,234.00               → Optional checkbox
Description (Credit): -$1,000.00                → Credit (shows in red)
Description: $1,000, $2,000, $3,000             → Tiered radio
```

## Validation

When a card enters a new list, its description is validated to ensure required sections are present and correctly formatted. Cards that fail validation are returned to the sending list with a notification to the member who moved the card.

## Human Editing

- Trello's WYSIWYG editor allows humans to modify description data without coding knowledge
- Humans may accidentally deviate from the delimiter format — reads should include structure cleanup/repair

## Related

- PROJECT_IDEAS.md — Idea backlog in workspace
- Card formatting details embedded in project_automator skill

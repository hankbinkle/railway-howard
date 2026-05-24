# SKILL.md — project_template_manager

## Purpose
Review and maintain the ZINN Project Template Trello board.
Board: https://trello.com/b/hMkMSLbJ | ID: `66f2e19a4dd7012acc370148`

## Credentials
- Trello key: `~/.openclaw/credentials/trello-key.txt`
- Trello token: `~/.openclaw/credentials/trello-token.txt`

## Key Paths
- Source images: `/Users/robzinn/ZINN Dropbox/reference/_manual/_source/`
- Training images: `/Users/robzinn/ZINN Dropbox/reference/_manual/_training/`
- Root manual images: `/Users/robzinn/ZINN Dropbox/reference/_manual/*.png|gif`
- Skill scripts: `~/.openclaw/skills/project_template_manager/scripts/`
- Output/reports: `~/.openclaw/skills/project_template_manager/output/`

## Known Issues
- See CURRENT_ISSUES.md

## Broken Image Pattern
Images embedded in card descriptions (Markdown) that reference card IDs from **other boards** return 403 for all users. These are the only truly broken images — the 279 Trello-hosted attachment URLs all resolve correctly when authenticated.

Detection method: parse card `.desc` fields for Trello image URLs; extract card ID from URL; flag any card ID not in the template board's card ID set.

## Fix Strategy
1. Identify broken image (foreign card ID in desc URL)
2. Find matching source file in Dropbox `_source/` or `_manual/` root
3. Upload source file as native Trello attachment on the template card
4. Replace the broken `![](foreign_url)` in the card description with the new attachment URL

## Trello API Notes
- `GET /1/boards/{id}/cards?attachments=true` — all cards with attachments in one call
- `POST /1/cards/{id}/attachments` with `multipart/form-data` to upload a file
- Rate limit: 100 req/10s; serialize bursts

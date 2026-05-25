#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

// ─── SHARED INFRASTRUCTURE ──────────────────────────────────────────────────

const config = require('./_shared/config');
const trello = require('./_shared/trello');
const email  = require('./_shared/email');
const dropbox = require('./_shared/dropbox');
const db     = require('./_shared/db');

// Ensure Trello token is available for shared module
if (!process.env.TRELLO_TOKEN) {
  try {
    process.env.TRELLO_TOKEN = fs.readFileSync(
      '/Users/robzinn/.openclaw/credentials/trello-token.txt',
      'utf8'
    ).trim();
  } catch (_) {}
}

const { TRELLO_LISTS, LOCAL_DROPBOX_ROOT } = config;
const PROJECTS_ROOT = path.join(LOCAL_DROPBOX_ROOT, 'projects');
const ROOT          = path.dirname(__filename);
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'proposal.html');
const IMAGES_DIR    = path.join(ROOT, 'images');

// Team photo URLs from zinn.ai/meet-the-zinn-team
const TEAM_PHOTO_URLS = {
  kassia:  'https://images.squarespace-cdn.com/content/v1/5e67c2d2cd094e004e07ff41/1cb7ba90-7db7-4844-8173-a6e5516a86ee/kassia-headshot-02.jpg?format=500w',
  rob:     'https://images.squarespace-cdn.com/content/v1/5e67c2d2cd094e004e07ff41/c7c391cf-f64e-404d-825e-36ef0d68dbfe/_rob_glasses_sm.jpg?format=500w',
  hannah:  'https://images.squarespace-cdn.com/content/v1/5e67c2d2cd094e004e07ff41/c1bef1e4-e4ba-4755-8eb8-c6e6b37a5ea2/hannah.jpg?format=500w',
  robin:   'https://images.squarespace-cdn.com/content/v1/5e67c2d2cd094e004e07ff41/9d7af6f9-97ea-4fc2-905c-651ac576b22d/robin.jpg?format=500w',
  daniel:  'https://images.squarespace-cdn.com/content/v1/5e67c2d2cd094e004e07ff41/67d99d44-fd23-4ace-8c72-b4a259568ffb/daniel-headshot.jpg?format=500w',
};

// ─── ARGS / MODE ─────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const cardId = args.find(a => !a.startsWith('--'));
const SERVER_MODE = args.includes('--server');

if (!cardId && !SERVER_MODE) {
  console.error('Usage: node generate-proposal.js <trello_card_id>');
  console.error('       node generate-proposal.js --server [--port 3478]');
  process.exit(1);
}

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────

// Replaced by shared modules. See `trello` and `email` for Trello/Gmail API calls.
// The `getBinary` helper for team photo downloads is kept here as a standalone
// function using fetch (available in Node 18+).

async function getBinary(url) {
  const resp = await fetch(url);
  if (resp.redirected || resp.status === 301 || resp.status === 302) {
    return getBinary(resp.headers.get('location') || url);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { buffer, contentType: resp.headers.get('content-type') || 'image/jpeg' };
}

// ─── TRELLO ──────────────────────────────────────────────────────────────────

// Trello API calls now handled by the shared module.
// The shared trello.getCard() includes Atlassian migration bug fallback.
// Aliases for backward compatibility within this file:
const getCard = trello.getCard;
const addCardComment = trello.addComment;
const moveCardToList = trello.moveCardToList;
const setCardDueDate = trello.setDueDate;

async function removeUncheckedOptionalsFromCard(cardId, optionalChecked = [], parsed = null) {
  // optionalChecked is [{index: N, checked: true/false}, ...] from the e-sign UI
  // Build a set of checked optional line descriptions
  const checkedDescs = new Set();
  if (parsed && Array.isArray(parsed.fee_lines) && Array.isArray(optionalChecked)) {
    optionalChecked.forEach(entry => {
      const idx = entry.index;
      if (typeof idx === 'number' && entry.checked === true) {
        const line = parsed.fee_lines[idx];
        if (line && line.optional) checkedDescs.add(line.desc.toLowerCase().trim());
      }
    });
  }

  try {
    const card = await trello.getCard(cardId);
    const desc = card.desc || '';
    const lines = desc.split('\n');
    const feeStart = lines.findIndex(l => l.startsWith('## Fee'));
    const feeEnd = lines.findIndex((l, i) => i > feeStart && l.startsWith('## '));
    if (feeStart === -1) return;

    const beforeFee = lines.slice(0, feeStart + 1);
    const feeLines  = lines.slice(feeStart + 1, feeEnd > feeStart ? feeEnd : lines.length);
    const afterFee  = feeEnd > feeStart ? lines.slice(feeEnd) : [];

    const kept = feeLines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('---')) return true;
      // Check if this line has an optional marker: "Description (Optional): $"
      const optionalMatch = trimmed.match(/^[\s-]*([^:]+?)\(Optional\)\s*:/i);
      if (optionalMatch) {
        const lineDesc = optionalMatch[1].trim().toLowerCase();
        const isChecked = checkedDescs.has(lineDesc);
        if (!isChecked) {
          console.log(`[remove-opt] Removing unchecked optional: ${trimmed.trim()}`);
          return false;
        }
      }
      return true;
    });

    const newDesc = [...beforeFee, ...kept, ...afterFee].join('\n');
    if (newDesc !== desc) {
      await trello.updateCard(cardId, { desc: newDesc });
      console.log(`[remove-opt] Card Fee section updated - unchecked optionals removed.`);
    } else {
      console.log(`[remove-opt] No changes needed to Fee section.`);
    }
  } catch (e) {
    console.error(`[remove-opt] Failed: ${e.message}`);
  }
}

// ─── CARD PARSER ─────────────────────────────────────────────────────────────

function parseCard(card) {
  const desc = card.desc || '';

  const sections = {};
  let cur = '_top';
  sections[cur] = [];
  for (const line of desc.split('\n')) {
    const m = line.match(/^#{1,3}\s+(.+)$/);
    if (m) {
      cur = m[1].trim().toLowerCase().replace(/\s+/g, '_');
      sections[cur] = [];
    } else {
      sections[cur].push(line);
    }
  }

  function sec(name) {
    const keys = Object.keys(sections);
    const key = keys.find(k => k === name)
              || keys.find(k => k.startsWith(name))
              || keys.find(k => name.startsWith(k));
    if (!key) return '';
    return sections[key].join('\n')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/---+/g, '')
      .trim();
  }

  // ── Client ────────────────────────────────────────────────────────────────
  const clientRaw   = sec('client');
  const clientLines = clientRaw.split('\n')
    .map(l => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

  // Collect ALL email addresses from the Client section
  const clientEmails = (clientRaw.match(/[\w.+-]+@[\w.-]+\.\w+/g) || []).filter((v,i,a) => a.indexOf(v) === i);
  const clientEmail  = clientEmails[0] || null;
  const clientPhone  = extractPattern(clientRaw, /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g);

  const clientClean = clientLines.filter(l =>
    !/@/.test(l) && !/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(l)
  );

  const client        = clientClean[0] || '';
  const clientAddress = clientClean.slice(1).join('\n');

  // If client is a company with an "attention:" line, greet the contact person
  // e.g. client = "Cornerstone Homes", attention line = "attention: Taylor Downing" → "Taylor"
  const attentionLine = clientClean.find(l => /^attention:/i.test(l));
  const attentionName = attentionLine
    ? attentionLine.replace(/^attention:\s*/i, '').trim()
    : null;

  // Build greeting: female-first, first names only
  // e.g. "Ann Tiefenthaler and Marc Jackson" → "Hello Ann and Marc."
  // For company clients with attention line, use the contact's first name directly
  const clientGreeting = attentionName
    ? attentionName.split(/\s+/)[0]
    : buildClientGreeting(client);
  // Keep a single first name for fallback contexts
  const clientFirstName = clientGreeting || client.trim().split(/[\s,]+/)[0] || 'there';

  // ── Phases ────────────────────────────────────────────────────────────────
  const phasesRaw = sec('phases');
  const phases    = [];
  if (phasesRaw) {
    const phaseMap = {
      'pre design':                /pre.?design|pre-design|\bPD\b/i,
      'schematic design':          /schematic|\bSD\b/i,
      'design development':        /design.development|\bDD\b/i,
      'construction documents':    /construction.doc|\bCD\b/i,
      'construction administration': /construction.admin|\bCA\b/i,
      'furnishings and decor':     /furnish|decor|\bFD\b/i,
      // 'additional services' deliberately excluded - handled by GC
    };
    for (const [name, rx] of Object.entries(phaseMap)) {
      if (rx.test(phasesRaw)) phases.push(name);
    }
  }
  if (!phases.length) {
    const fullText = desc + ' ' + card.name;
    const phaseMap = {
      'pre design':                /pre.?design|\bPD\b/,
      'schematic design':          /schematic|\bSD\b/,
      'design development':        /design.development|\bDD\b/,
      'construction documents':    /construction.doc|\bCD\b|permit/,
      'construction administration': /construction.admin|\bCA\b/,
      'furnishings and decor':     /furnish|decor|\bFD\b/,
    };
    for (const [name, rx] of Object.entries(phaseMap)) {
      if (rx.test(fullText)) phases.push(name);
    }
  }

  // ── Billing type ─────────────────────────────────────────────────────────
  const billingRaw = sec('billing_type');
  let billingType  = 'fixed fee';
  if (/not.to.exceed|\bnte\b/i.test(billingRaw))               billingType = 'Hourly NTE';
  else if (/hourly.no.budget|hourly.*no.*limit/i.test(billingRaw)) billingType = 'Hourly no budget';

  // ── Proposal length ───────────────────────────────────────────────────────
  const lengthRaw    = sec('proposal_length');
  let proposalLength = 'medium';
  if (/\bshort\b|repeat.client|experienced.client|life.safety.only/i.test(lengthRaw)) proposalLength = 'short';
  else if (/\blong\b|\bfull\b/i.test(lengthRaw)) proposalLength = 'long';

  // ── Scope ────────────────────────────────────────────────────────────────
  const scope = sec('scope') || sec('general_notes');

  // ── Fee ──────────────────────────────────────────────────────────────────
  const feeRaw   = sec('fee') || sec('fee_proposal') || sec('proposed_fee');
  const feeLines = parseFeeLines(feeRaw);

  // ── Project name ─────────────────────────────────────────────────────────
  const projectName = card.name.split(' - ')[0].trim();

  return {
    card_id:           card.id,
    card_name:         card.name,
    client:            client || '(client name)',
    client_first_name: clientFirstName,
    client_greeting:   clientGreeting,
    client_address:    clientAddress,
    client_email:      clientEmail || '',
    client_emails:     clientEmails,
    client_phone:      clientPhone || '',
    project_name:      projectName,
    project_address:   sec('project_address') || clientAddress,
    scope:             scope || '(scope to be added)',
    fee_lines:         feeLines,
    billing_type:      billingType,
    phases:            phases.length ? phases : ['schematic design', 'construction documents'],
    proposal_length:   proposalLength,
    date:              new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    _explicit: {
      client:          !!sec('client').trim(),
      scope:           !!sec('scope').trim(),
      fee:             !!feeRaw.trim(),
      billing_type:    !!sec('billing_type').trim(),
      phases:          !!sec('phases').trim(),
      proposal_length: !!sec('proposal_length').trim(),
    },
  };
}

function extractPattern(text, rx) {
  const m = text.match(rx);
  return m ? m[0].trim() : null;
}

// Common female first names for gender inference.
// Not exhaustive - unknown names default to "as listed" order.
const FEMALE_NAMES = new Set([
  'ann','anne','anna','annie','abby','abigail','alice','allison','alicia','alison',
  'amanda','amber','amy','andrea','angela','anita','ashley','audrey','barbara',
  'beatrice','beth','betty','brenda','brianna','brittany','brooke','carol','carolina',
  'caroline','caitlin','caitlyn','catherine','cathy','charlotte','chelsea','cheryl',
  'chris','christina','christine','cindy','claire','claudia','crystal','dana','danielle',
  'deborah','debra','diana','diane','donna','dorothy','elena','eleanor','eliza',
  'elizabeth','ella','emily','emma','erica','erin','evelyn','faith','fiona','frances',
  'gabrielle','gloria','grace','haley','hannah','heather','helen','holly','jacqueline',
  'jane','janet','jasmine','jean','jennifer','jessica','jill','joan','joanna','julia',
  'julie','karen','kassia','kate','katherine','kathleen','kathryn','katie','kayla',
  'kelly','kim','kimberly','kristin','kristina','krista','laura','lauren','leah',
  'linda','lisa','lori','lucy','madison','margaret','maria','marie','mary','megan',
  'melissa','michelle','miranda','molly','monica','nancy','natalie','natasha','nicole',
  'olivia','pamela','patricia','paula','peggy','rachel','rebecca','renee','rita',
  'robin','ruth','samantha','sandra','sara','sarah','shannon','sharon','sheila',
  'shirley','sophia','stacy','stephanie','sue','susan','tamara','tammy','teresa',
  'tiffany','tina','tracy','vanessa','victoria','virginia','wendy','whitney',
]);

/**
 * Given a client name string like "Ann Tiefenthaler and Marc Jackson",
 * returns a greeting string like "Ann and Marc".
 * Female names come first.
 * Handles single names, "and"-joined pairs, and comma-separated lists.
 */
function buildClientGreeting(clientName) {
  if (!clientName) return 'there';

  // Split on " and " or commas to get individual full names
  const parts = clientName
    .split(/\s+and\s+|,\s*/i)
    .map(s => s.trim())
    .filter(Boolean);

  if (parts.length === 0) return 'there';
  if (parts.length === 1) {
    // Single name - just return first name
    return parts[0].split(/\s+/)[0];
  }

  // Extract first names
  const firstNames = parts.map(p => p.split(/\s+/)[0]);

  // Sort: females first, then males, then unknowns
  // Score: 0 = female, 1 = unknown, 2 = male (not in female list)
  function genderScore(name) {
    const lower = name.toLowerCase();
    return FEMALE_NAMES.has(lower) ? 0 : 1;
  }

  // Pair first names with their original index to preserve relative order within same gender
  const indexed = firstNames.map((n, i) => ({ n, i, score: genderScore(n) }));
  indexed.sort((a, b) => a.score !== b.score ? a.score - b.score : a.i - b.i);

  const sorted = indexed.map(x => x.n);

  if (sorted.length === 2) return `${sorted[0]} and ${sorted[1]}`;
  // 3+: "Ann, Marc, and Bob"
  return sorted.slice(0, -1).join(', ') + ', and ' + sorted[sorted.length - 1];
}

/**
 * Parse fee lines. Three formats:
 *   description: $1,234.00                         → required static line
 *   description (optional): $1,234.00              → optional checkbox line
 *   description: $1,000, $2,000, $3,000            → tiered (basic/standard/premium) radio line
 *   description (optional): $1,000, $2,000, $3,000 → tiered optional radio line
 */
function parseFeeLines(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim().replace(/^[•\-*]\s*/, '');
    if (!trimmed) continue;

    // Match: description (sub_note): amount[, amount2, amount3]
    const m = trimmed.match(/^(.*?):\s*(.+)$/);
    if (!m) continue;

    const rawDesc   = m[1].trim();
    const amountRaw = m[2].trim();

    // Check for tiered: three comma-separated amounts
    const tieredMatch = amountRaw.match(/^(-?\$?[\d,]+(?:\.\d{2})?)\s*,\s*(-?\$?[\d,]+(?:\.\d{2})?)\s*,\s*(-?\$?[\d,]+(?:\.\d{2})?)$/);
    if (tieredMatch) {
      const tiers = [tieredMatch[1], tieredMatch[2], tieredMatch[3]].map(normalizeAmount);
      const subMatch = rawDesc.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      const desc    = subMatch ? subMatch[1].trim() : rawDesc;
      const subNote = subMatch ? subMatch[2].trim() : '';
      const optional = /optional/i.test(desc) || /optional/i.test(subNote);
      result.push({ desc: desc.replace(/^optional[:\s-]*/i, '').trim(), subNote, tiers, optional, type: 'tiered' });
      continue;
    }

    // Standard single-amount line
    const normalizedAmt = normalizeAmount(amountRaw);
    const subMatch = rawDesc.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    let desc    = subMatch ? subMatch[1].trim() : rawDesc;
    let subNote = subMatch ? subMatch[2].trim() : '';
    const optional = /optional/i.test(desc) || /optional/i.test(subNote);
    desc    = desc.replace(/^optional[:\s-]*/i, '').trim();
    subNote = subNote.replace(/^optional[:\s-]*/i, '').trim();

    if (desc) result.push({ desc, subNote, amount: normalizedAmt, optional, type: optional ? 'optional' : 'required' });
  }

  return result;
}

function normalizeAmount(raw) {
  const s = raw.replace(/[$,]/g, '').trim();
  const n = parseFloat(s);
  if (isNaN(n)) return raw;
  const formatted = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────

function validateCard(parsed) {
  const errors   = [];
  const warnings = [];

  if (!parsed._explicit.client || parsed.client === '(client name)') {
    errors.push('## Client section is missing or empty');
  }
  if (!parsed.client_email) {
    warnings.push('Client email not found - Gmail draft will be skipped');
  }
  if (!parsed._explicit.fee || !parsed.fee_lines.length) {
    errors.push('## Fee section is missing or contains no parseable line items');
  }
  if (!parsed._explicit.scope || parsed.scope.length < 20) {
    errors.push('## Scope section is missing or too short');
  }
  if (!parsed._explicit.billing_type) {
    warnings.push('## Billing Type not specified - defaulting to "fixed fee"');
  }
  if (!parsed._explicit.phases) {
    warnings.push('## Phases not specified - defaulting to SD + CD');
  }
  if (!parsed._explicit.proposal_length) {
    warnings.push('## Proposal Length not specified - defaulting to "medium"');
  }
  if (!parsed.project_address) {
    warnings.push('## Project Address not found');
  }

  return { errors, warnings };
}

// ─── FIND PROJECT FOLDER ─────────────────────────────────────────────────────

function findProjectFolder(projectName) {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // Collect candidates: root level + one level deep (covers _leads/, _active/, etc.)
  const candidates = [];
  try {
    for (const entry of fs.readdirSync(PROJECTS_ROOT)) {
      const fullPath = path.join(PROJECTS_ROOT, entry);
      try {
        if (fs.statSync(fullPath).isDirectory()) {
          candidates.push({ name: entry, fullPath });
          for (const sub of fs.readdirSync(fullPath)) {
            const subPath = path.join(fullPath, sub);
            try { if (fs.statSync(subPath).isDirectory()) candidates.push({ name: sub, fullPath: subPath }); } catch {}
          }
        }
      } catch {}
    }
  } catch { return null; }

  // Sort by path length (shortest first) to prefer team-level paths over nested user copies
  candidates.sort((a, b) => a.fullPath.length - b.fullPath.length);

  // Exact match
  let hit = candidates.find(c => c.name === slug);
  if (hit) return hit.fullPath;

  // Starts-with match
  hit = candidates.find(c => c.name.startsWith(slug) || slug.startsWith(c.name.replace(/[^a-z0-9_]/g, '_')));
  if (hit) return hit.fullPath;

  // Token match (>=2 meaningful tokens)
  const slugTokens = new Set(slug.split('_').filter(t => t.length > 2));
  let best = null, bestScore = 0;
  for (const c of candidates) {
    if (c.name.startsWith('_') || c.name === 'Icon') continue;
    const tokens = c.name.split(/[_\-]/).filter(t => t.length > 2);
    const score  = tokens.filter(t => slugTokens.has(t.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (bestScore >= 2) return best.fullPath;

  return null;
}

function parseScopeHtml(text) {
  const blocks = text.split(/\n\n+/);
  return blocks.map(block => {
    const lines = block.trim().split('\n');
    const hasBullets = lines.some(l => /^[-*•]\s/.test(l.trim()));
    if (hasBullets) {
      const items = lines
        .map(l => l.trim())
        .filter(l => /^[-*•]\s/.test(l))
        .map(l => escHtml(l.replace(/^[-*•]\s+/, '')))
        .map(l => `<li>${l}</li>`)
        .join('\n');
      return `<ul style="margin:0 0 12px 0;padding:0 0 0 20px;list-style:disc;">${items}</ul>`;
    }
    return `<p style="margin-bottom:12px;">${escHtml(block.trim()).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}

function resolveOutputPath(parsed) {
  const projectFolder = findProjectFolder(parsed.project_name);
  const now           = new Date();
  const dateStr       = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}`;
  const fileSlug      = parsed.project_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const fileName      = `proposal-${dateStr}-${fileSlug}`;

  if (projectFolder) {
    const bpqDir = path.join(projectFolder, '_bids_proposals_and_quotes');
    if (!fs.existsSync(bpqDir)) fs.mkdirSync(bpqDir, { recursive: true });
    return { dir: bpqDir, base: fileName, projectFolder };
  }

  // Fallback: try constructing the leads path directly
  try {
    const leadsDir = path.join(PROJECTS_ROOT, '_leads', fileSlug);
    if (fs.existsSync(leadsDir)) {
      const bpqDir = path.join(leadsDir, '_bids_proposals_and_quotes');
      if (!fs.existsSync(bpqDir)) fs.mkdirSync(bpqDir, { recursive: true });
      return { dir: bpqDir, base: fileName, projectFolder: leadsDir };
    }
  } catch (e) { /* ignore fallback failure */ }

  const outputDir = path.join(ROOT, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  return { dir: outputDir, base: fileName, projectFolder: null };
}

// ─── HTML BUILDERS ────────────────────────────────────────────────────────────

function buildFeeTable(feeLines) {
  if (!feeLines.length) {
    return `<p style="font-size:12px;color:#81A2B2;font-style:italic;">Fee details to be provided separately.</p>`;
  }

  // Build JS data for interactive fee table
  const feeData = JSON.stringify(feeLines);

  const rows = feeLines.map((f, i) => {
    const descCell = f.subNote
      ? `${escHtml(f.desc)} <span class="fee-sub-note">(${escHtml(f.subNote)})</span>`
      : escHtml(f.desc);

    if (f.type === 'tiered') {
      const tierOptions = ['basic', 'standard', 'premium'].map((label, ti) => `
        <label class="tier-option">
          <input type="radio" name="tier_${i}" value="${f.tiers[ti].replace(/[$,]/g,'')}" data-index="${i}" data-tier="${ti}" ${ti === 0 ? 'checked' : ''} onchange="updateFeeTotal()">
          <span class="tier-label">${label}</span>
          <span class="tier-amount">${escHtml(f.tiers[ti])}</span>
        </label>`).join('');
      const noneOption = `<label class="tier-option tier-none">
        <input type="radio" name="tier_${i}" value="0" data-index="${i}" data-tier="-1" onchange="updateFeeTotal()">
        <span class="tier-label">not included</span>
      </label>`;
      return `<tr class="fee-row fee-tiered" data-index="${i}">
        <td class="fee-desc-cell">${descCell}<div class="tier-options">${tierOptions}${noneOption}</div></td>
        <td class="fee-amount-cell tiered-display" id="tier_display_${i}">${escHtml(f.tiers[0])}</td>
      </tr>`;
    }

    if (f.type === 'optional') {
      return `<tr class="fee-row fee-optional" data-index="${i}">
        <td class="fee-desc-cell">
          <label class="optional-label">
            <input type="checkbox" data-index="${i}" data-amount="${f.amount.replace(/[$,]/g,'')}" onchange="updateFeeTotal()" class="optional-check" checked>
            ${descCell} <span style="font-size:11px;color:#81A2B2;font-style:italic;">(optional)</span>
          </label>
        </td>
        <td class="fee-amount-cell optional-amount">${escHtml(f.amount)}</td>
      </tr>`;
    }

    // Required
    const isCredit = f.amount.startsWith('-');
    return `<tr class="fee-row fee-required" data-index="${i}">
      <td class="fee-desc-cell">${descCell}</td>
      <td class="fee-amount-cell${isCredit ? ' fee-credit' : ''}" data-amount="${f.amount.replace(/[$,]/g,'')}">${escHtml(f.amount)}</td>
    </tr>`;
  }).join('\n');

  return `<table class="fee-table" id="fee-table">
  <thead><tr><th>description</th><th>amount</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr class="fee-total-row">
      <td>proposed fee</td>
      <td id="fee-total">calculating...</td>
    </tr>
  </tfoot>
</table>
<script>
(function() {
  function updateFeeTotal() {
    var total = 0;
    // Required lines
    document.querySelectorAll('.fee-required .fee-amount-cell').forEach(function(el) {
      var amt = parseFloat(el.getAttribute('data-amount')) || 0;
      total += amt;
    });
    // Optional checkboxes
    document.querySelectorAll('.optional-check').forEach(function(el) {
      if (el.checked) {
        total += parseFloat(el.getAttribute('data-amount')) || 0;
      }
    });
    // Tiered radios
    document.querySelectorAll('.fee-tiered').forEach(function(row) {
      var idx = row.getAttribute('data-index');
      var checked = document.querySelector('input[name="tier_' + idx + '"]:checked');
      if (checked) {
        var val = parseFloat(checked.value) || 0;
        total += val;
        // Update display cell
        var display = document.getElementById('tier_display_' + idx);
        if (display) {
          if (val === 0) {
            display.textContent = '-';
          } else {
            display.textContent = '$' + val.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
          }
        }
      }
    });
    var formatted = '$' + total.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
    document.getElementById('fee-total').textContent = formatted;
  }
  window.updateFeeTotal = updateFeeTotal;
  // Run on load
  document.addEventListener('DOMContentLoaded', updateFeeTotal);
  // Also run immediately in case DOM is already ready
  if (document.readyState !== 'loading') updateFeeTotal();
})();
</script>`;
}

function buildBillingBlock(billingType) {
  const t = billingType.toLowerCase();
  if (t.includes('nte') || t.includes('not-to-exceed')) return `
<h3>not-to-exceed</h3>
<p>If your project stipulates a not-to-exceed (NTE) estimate, work will be billed hourly based on the rates noted in the &ldquo;Hourly Work&rdquo; section below. An email notice will be sent to the Client should the accrued fees equal the NTE amount stipulated in the Proposed Fee section above. Work will continue and hourly fees will continue to accrue in excess of the stipulated NTE until the work is complete, the Client halts work on the project, or the Client stipulates a higher NTE amount.</p>`;

  if (t.includes('no budget') || t.includes('no-budget')) return `
<h3>hourly no budget projects</h3>
<p>If your project is &ldquo;hourly no budget,&rdquo; work is completed on an hourly basis based on the rates indicated in the &ldquo;Hourly Work&rdquo; section below. Work continues as long as the Client requests services/deliverables or engages ZINN in project correspondence. An estimate of how long a particular task may take can be provided on request.</p>`;

  return `
<h3>fixed fee</h3>
<p>ZINN uses a simple and predictable monthly payment schedule to allow our clients to amortize the cost of architectural services. Upon acceptance, you will be prompted for the first payment. Typically we break the fee into 5 payments of 20% each unless the project is unusually large or unusually small (less than $10k).</p>
<p>The invoice for the second payment may come after work has started in earnest but the subsequent payments are invoiced on or before the 15th of each month.</p>
<h3>fee adjustment</h3>
<p>At the completion of each Phase, ZINN will review the project development and may propose an adjustment to the fee if the project has deviated from the Scope of Work outlined here.</p>
<h3>pausing or stopping work</h3>
<p>If you decide to pause your project we will hold off on monthly invoicing until you authorize us to proceed or a period of 6 months has transpired. At such time, ZINN will send a final invoice or statement including any work completed to date, including any efforts or correspondence conducted in response to Client inquiries.</p>
<p>If you decide not to complete the project, ZINN will prorate the amount of fee remaining based on the status of project completion and settle up with you via final invoice or refund as appropriate.</p>`;
}

// ─── PHASE CONTENT ────────────────────────────────────────────────────────────

const PHASE_CONTENT = {
  'pre design': {
    label: 'pre design (PD)',
    desc: 'This phase involves preliminary efforts to accurately document existing conditions on-site and estimate potential costs.',
    items: [
      'in-person site visit or consult credit',
      'existing conditions survey/laser scan and to-scale existing floor plans (as needed)',
      'diagrammatic renovation or construction scenarios',
      'in-person or video conf draft review',
      'area categories and square foot cost analysis',
    ]
  },
  'schematic design': {
    label: 'schematic design (SD)',
    desc: 'During SD, we begin to put pen to paper to create loose floor plans in an effort to capture the goals of the project formally. Drawings are of a moderate level of detail to accurately vet various approaches while leaving some specifics and details for later development.',
    items: [
      'scaled and annotated floor plans',
      '<strong>massing studies:</strong> In this effort, we confirm the buildable size available for a particular property and explore various ways to fit your scope of work within the allowable envelope.',
      '3d views (sketchy style)',
      '<strong>review meetings/video conferences:</strong> The following meetings can be conducted in-person at ZINN offices or via video conference per the Client\'s preference.<ul class="phase-sublist"><li>Schematic Design Review Meeting 1 (SD1)</li><li>Schematic Design Review Meeting 2 (SD2)</li><li>Schematic Design Final Meeting (SDF)</li></ul>',
    ]
  },
  'design development': {
    label: 'design development (DD)',
    desc: 'Once you approve a schematic direction, we begin working on the details and specifics to more fully describe the design and identify the technical challenges to achieving it.',
    items: [
      '<strong>Fixture and Finish (F&amp;F) schedule development:</strong><ul class="phase-sublist"><li><strong>dd1 - concepts:</strong> We present stylistic concepts based on your stated goals, inspo pics, and stylistic preferences. Our goal here is to set a general direction for the FF package. One or more concepts are presented and the Client is asked to select one for development.</li><li><strong>dd2 - selections:</strong> We build on the concept meeting by proposing specific materials, fixtures, finishes, and products.</li><li><strong>dd3 - cabinetry and woodwork:</strong> All locations where millwork is required such as kitchens, bathrooms, and mudrooms are reviewed to discuss the style, operation, and features desired.</li><li><strong>dd4 - samples:</strong> Physical samples of finishes are procured for in-person Client review.</li><li><strong>dd5 outside meetings and ancillary selections:</strong><ul class="phase-sublist"><li><strong>plumbing fixtures and bath accessories:</strong> ZINN accompanies the Client to a local Plumbing Fixture showroom to review fixture and accessory quality, operation, and finish. The showroom helps develop the Plumbing Fixture Quote which can be provided to candidate General Contractors for pricing during the Bid process.</li><li><strong>doors and windows:</strong> ZINN works with local door/window vendors to review opening options and schedules a showroom visit to encounter physical assembly samples to assess their operation and build quality.</li><li><strong>millworker review:</strong> ZINN introduces a local millwork shop to the project so they can develop a quote. The Client meets with the millworker at ZINN to review the project and answer any questions they may have.</li><li><strong>ceiling plan review (in office):</strong> ZINN reviews a reflected ceiling plan (RCP) showing a view looking up at the ceiling to review the location of light fixtures, electrical receptacles, switches, and other electrical elements as well as features such as coffers, soffits, or barrel vaults.</li></ul></li></ul>',
    ]
  },
  'construction documents': {
    label: 'construction documents (CD)',
    desc: 'During CDs, we supplement all the work that has been done to date with all the final information that a contractor will require to build the project and that the permitting officials will require to issue a permit.',
    items: [
      'signed and sealed permit/construction drawings',
      'construction details',
      'permit official responses/revisions and correspondence',
      'bidder requests for information',
      '<strong>engineering solicitation:</strong> ZINN solicit proposals from qualified engineers for design services as required by the local Permitting Office. The Engineering Team may include the following disciplines and others by agreement:<ul class="phase-sublist"><li>Civil (C)</li><li>Mechanical (M)</li><li>Plumbing (P)</li><li>Electrical (E)</li><li>Structural (S)</li><li>Fire-Protection (FP)</li><li>Pre-Engineered Metal Building (PEMB)</li></ul><em>***Residential projects usually require only Structural Engineering and the final MEP design is determined by the General Contractor\'s selected MEP subcontractors.</em>',
      '<strong>engineering coordination:</strong> ZINN will coordinate with the selected Engineering Team by communicating the project goals and objectives, supplying progress drawing backgrounds and CAD base files, reviewing a 60% Complete Coordination Issue, and providing markups as needed to communicate coordination issues for discussion or correction.',
    ]
  },
  'construction administration': {
    label: 'construction administration (CA)',
    desc: 'Once you have selected a Contractor and start building, ZINN remains involved to ensure the quality of the work and to help clarify the design intent.',
    items: [
      '<strong>construction kick-off meeting:</strong> ZINN welcomes the GC to the project Team and hosts an informal review of the drawings, the construction schedule, and any questions Team members wish to pose.',
      '<strong>submittal review:</strong> Information about the GC\'s proposed products and assemblies are reviewed for consistency with the Finish, Fixture, and Equipment Schedules on the drawings. Substitutions may be proposed if the Basis-of-Design items are no longer available or an improved option is available.',
      '<strong>shop drawing review:</strong> Drawings of custom-fabricated elements are shared by the awarded fabrication subcontractors for review. These are based on the Permit/Construction Drawings but provide more detail about the Means and Methods of fabrication.',
      '<strong>payment application review:</strong> The GC applies for payment periodically throughout the project. ZINN reviews payment applications for consistency with the work progress on site to ensure payments and progress track apace each other.',
      '<strong>change order review:</strong> Change Orders provide a formal and clear means for the Team to review project changes. No change to the Contract Amount or Project Schedule should occur without Team review. These reviews attempt to verify the change amount and necessity.',
      '<strong>contractor requests for information and/or clarification:</strong> ZINN will field and respond to questions received from the General Contractor in written and/or drawing form. If necessary, Construction Sketches will be issued to supplement the Construction Drawings in lieu of issuing revised/clouded sheets.',
      '<strong>rough-in site walkthrough:</strong> After the rough Mechanical, Electrical, and Plumbing systems are installed but before the drywall is installed, a Team walkthrough is conducted to confirm the locations of elements like receptacles, switches, HVAC diffusers, and shower heads.',
      '<strong>punch list walkthrough:</strong> ZINN will note and record items still to be completed at a Pre-Occupancy Punch List walkthrough. Each item will be assigned a Course-of-action and Responsible Party per agreement of the parties present. The complete Punch List will be distributed to the project Team.',
      'progress review meetings (hourly as requested): ZINN will visit the site or host additional meetings with the GC as requested on an hourly basis.',
    ]
  },
  'furnishings and decor': {
    label: 'furnishings and decor (FD)',
    desc: 'The finishing touches that really bring a project together. We propose sofas, rugs, side tables, lamps, and other such items that are not "attached" to the building.',
    tableHtml: `<table class="fd-table" id="fd-table">
  <thead>
    <tr>
      <th class="fd-service-col">service</th>
      <th class="fd-tier-col" data-tier="0">basic</th>
      <th class="fd-tier-col" data-tier="1">standard</th>
      <th class="fd-tier-col" data-tier="2">premium</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Kick-off meeting: a first meeting to circle back on your goals and review the existing conditions.</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Concept boards - draft 1: a pdf showing a first stab at the design combining design elements, product images, and fabrics.</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Concept review meeting 1: an in-office meeting to discuss the first draft of the concept boards.</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Existing conditions survey: we visit the site to photograph and laser scan what is currently built.</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Existing conditions modeling: we convert the laser scan data into a 3d model as an accurate starting point for design.</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Existing furniture modeling / tracking: if you have a piece you'd like to keep, we will model it so we can be sure it will fit.</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Concept boards - draft 2: a revised pdf capturing notes and changes from the concept review meeting.</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Concept review meeting 2: an in-office meeting to discuss the changes and updates to the concept boards.</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Scaled interior floor plan: a floor plan view of the design area showing things to scale with dimensions and annotations.</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Purchase orders: when it is time to execute orders, we contact vendors to get exact pricing for your review.</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Showroom visits: through our network of vendors, we setup meetings at a vendor showroom to review and discuss items in person.</td><td class="fd-empty">-</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Trade discounts: our purchase order pricing will include our trade discounts whenever available.</td><td class="fd-empty">-</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Purchase and shipping logistics and tracking: we help plan for install date by coordinating with delivery companies and vendors.</td><td class="fd-empty">-</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td></tr>
    <tr><td>Delivery management and temporary storage: if items arrive before install date, we arrange delivery to our storage partners.</td><td class="fd-empty">-</td><td class="fd-empty">-</td><td class="fd-check">&#10003;</td></tr>
  </tbody>
</table>
<script>
(function(){
  function highlightFDTier(tierIndex) {
    document.querySelectorAll('.fd-tier-col').forEach(function(th) {
      th.classList.toggle('fd-tier-active', parseInt(th.getAttribute('data-tier')) === tierIndex);
    });
    document.querySelectorAll('#fd-table tbody tr').forEach(function(row) {
      var cells = row.querySelectorAll('td');
      cells.forEach(function(td, ci) {
        if (ci > 0) td.classList.toggle('fd-col-active', (ci - 1) === tierIndex);
      });
    });
  }
  window.highlightFDTier = highlightFDTier;
  // Listen for fee table tier changes
  document.addEventListener('change', function(e) {
    if (e.target && e.target.name && e.target.name.startsWith('tier_')) {
      // Find which fee line is FD
      var rows = document.querySelectorAll('.fee-tiered');
      rows.forEach(function(row) {
        var inputs = row.querySelectorAll('input[type=radio]');
        inputs.forEach(function(inp) {
          if (inp === e.target && inp.checked) {
            var tier = parseInt(inp.getAttribute('data-tier'));
            if (tier >= 0) highlightFDTier(tier);
          }
        });
      });
    }
  });
  document.addEventListener('DOMContentLoaded', function() { highlightFDTier(0); });
  if (document.readyState !== 'loading') highlightFDTier(0);
})();
</script>`,
  },
};

function buildPhasesBlock(phases) {
  if (!phases.length) return '';
  let html = `<div class="section">
  <h1 class="gc-title">phases and services</h1>
  <div class="section-accent"></div>
  <p style="font-size:12px;color:#81A2B2;margin-bottom:24px;">Below are the services provided at each Phase of the project. We are always happy to go over these services with you to answer any questions.</p>`;

  for (const phase of phases) {
    const c = PHASE_CONTENT[phase.toLowerCase()];
    if (!c) continue;
    let inner = `<h3 class="phase-title">${c.label}</h3>\n  <p class="phase-desc">${c.desc}</p>`;
    if (c.tableHtml) {
      inner += `\n  ${c.tableHtml}`;
    } else {
      inner += `\n  <ul class="phase-list">${c.items.map(i => {
        // If item doesn't start with a <strong> tag, bold the whole item text
        const normalized = i.trim().startsWith('<strong>') ? i : `<strong>${i}</strong>`;
        return `<li>${normalized}</li>`;
      }).join('')}</ul>`;
    }
    html += `\n  <div class="phase-group">${inner}\n  </div>`;
  }
  html += `\n</div>`;
  return html;
}

function buildAboutBlock() {
  return `<div class="section">
  <h1 class="gc-title">how we work</h1>
  <div class="section-accent"></div>
  <p class="about-text">ZINN designs spaces to elevate the everyday experiences of their occupants. Our projects are not only functional, but work well on many intersecting levels, from aesthetics to psychology to waterproofing to creativity. Through a process-oriented approach, we focus on our clients&#8217; experiences rather than just the walls that shelter them. At ZINN, we strive to frame everyday movement and activities in their most beautiful and humane light.</p>
  <ul class="values-list">
    <li>Careful</li><li>Diligent</li><li>Creative</li>
    <li>Curious</li><li>Experiential</li><li>Caring</li>
  </ul>
</div>`;
}

async function buildTeamBlock() {
  const team = [
    {
      key:   'kassia',
      name:  'Kassia Zinn',
      title: 'President, Principal Design Lead',
      bio:   'Kassia is the cofounder and President of ZINN, and not just on paper. She is the solid center of our office \u2014 the one everyone asks for advice on everything from design theory and the psychology of color to tips on how to craft the perfect business email. With her dedicated persistence, she is unruffled by the sometimes messy business of turning lines on paper into three-dimensional structures. The consummate diplomat, Kassia excels at guiding clients through the complex and sometimes emotional process of designing their home or office. She chooses to build bridges, and easily collaborates with contractors and other project teammates. Kassia earned an undergraduate degree in Architecture with a minor in Women\'s Studies and Psychology from the University of Florida. She then completed her graduate studies at Parsons School of Design in New York, where she was awarded the prestigious Michael Kalil Fellowship Grant for her research on disaster site utilization and the role of destruction itself in the creation of space.',
    },
    {
      key:   'rob',
      name:  'Rob Zinn, AIA NCARB',
      title: 'Vice President, Principal in Charge',
      bio:   'Rob is the cofounder and Vice President of ZINN. He is a creative and curious multipotentialite, so nerding out over everything from flashing details to how cities could work better comes naturally to him. Rob\'s operating principle is that architects should balance their design expertise with technical know-how to create solutions that are not just beautiful, but functional, logical, cost-effective. Rob earned his master\'s degree in Architecture from the University of Florida, where he met Kassia. He earned his BA from Boston University for, you guessed it, pre-med with a double major in English Literature and Art History. Rob serves as the Vice Chair of the Northeast Florida Builder\'s Association Commercial Council, encouraging dense walkable commercial development and improved relationships between architects, builders, and developers.',
    },
    {
      key:   'hannah',
      name:  'Hannah Jensen',
      title: 'Interior Designer I',
      bio:   'Hannah is our Interior Designer I, a graduate of Florida State College at Jacksonville with a degree in Interior Design Technology. Her passion for design was ignited as a young child where she would sketch perspectives of her room during church. This passion grew over time and cultivated into a love for Mid-Century Modern and Bauhaus design. During her off days, she loves scouring antique markets and vintage shops for unique vintage pieces. She also loves watching movies, buying records and participating in the local music scene. Hannah\'s approach to design is taking the time to get to know the people behind the project, and to curate a space that best reflects each client\'s personality in the most aesthetically pleasing and functional way possible. Her design inspirations include Kelly Wearstler, Verner Panton, Charles and Ray Eames, and Mies Van der Rohe.',
    },
    {
      key:   'robin',
      name:  'Robin Tuazon',
      title: 'Project Architect',
      bio:   'Leveraging her background in creating modern, light-filled homes as an Architect in her tropical home country where she ran her own practice, she seeks to apply her design and project management skills to a similar environment, finding resonance in Florida\'s ambiance. With a keen ability to read people and a knack for crafting designs that scream \'life\'s a beach,\' Robin\'s creations are not just buildings \u2014 they\'re experiences. Known for her positive and calm demeanor, she approaches the dynamic architecture industry with a solutions-oriented mindset. Outside the studio, you\'ll find her embracing the serenity of yoga, and frolicking along the sandy shores.',
    },
    {
      key:   'daniel',
      name:  'Daniel Paul',
      title: 'Architectural Designer',
      bio:   'Daniel is a determined architectural designer on a pathway to a brighter and more sustainable future with eight years in the field drafting and designing. A graduate from Jefferson University\'s College of Architecture & the Built Environment in Philadelphia, he has always explored how buildings interact and exist in the greater surrounding landscape, inspired at an early age by several visits to Fallingwater. He is a firm believer that for a project to be successful a client needs to experience their projects emotionally \u2014 parametric & unique materials use drive these designs, fueled by architects such as Kengo Kuma & Coop Himmelb(l)au. His passions outside the office include photography, fashion, automotive design, and landscape architecture.',
    },
  ];

  let membersHtml = '';
  for (const member of team) {
    let imgTag = '';
    try {
      const url = TEAM_PHOTO_URLS[member.key];
      const { buffer, contentType } = await getBinary(url);
      const b64 = buffer.toString('base64');
      imgTag = `<img class="team-photo" src="data:${contentType};base64,${b64}" alt="${escHtml(member.name)}">`;
    } catch (e) {
      console.log(`Team photo fetch failed for ${member.key}: ${e.message}`);
    }
    membersHtml += `
  <div class="team-member">
    ${imgTag}
    <div class="team-info">
      <h4>${escHtml(member.name)}</h4>
      <div class="team-title">${escHtml(member.title)}</div>
      <p>${escHtml(member.bio)}</p>
    </div>
  </div>`;
  }

  return `<div class="section">
  <h1 class="gc-title">our team</h1>
  <div class="section-accent"></div>${membersHtml}
</div>`;
}

function buildClientListBlock() {
  return `<div class="section">
  <h2 class="section-label">selected clients</h2>
  <div class="section-accent"></div>
  <div class="client-grid">
    <div class="client-category"><h4>corporate</h4><ul>
      <li>Clorox</li><li>CSX</li><li>Harbinger Sign</li>
      <li>Hoegh Autoliners</li><li>JEA</li><li>Lockheed Martin</li><li>Sadler Point Marina</li>
    </ul></div>
    <div class="client-category"><h4>government / institutional</h4><ul>
      <li>Boys and Girls Clubs</li><li>Bureau of ATF</li><li>Florida Air National Guard</li>
      <li>JAX Federal Credit Union</li><li>Naval Facilities Engineering Command</li>
      <li>New York University</li><li>Phoenix Arts District</li>
      <li>Riverside Presbyterian Day School</li><li>University of North Florida</li>
    </ul></div>
    <div class="client-category"><h4>hospitality / entertainment</h4><ul>
      <li>Alewife</li><li>Bread and Board</li><li>High Tide Burrito</li>
      <li>Ortega Yacht Club</li><li>San Marco Theater</li><li>The Loop Restaurant</li>
    </ul></div>
    <div class="client-category"><h4>real estate</h4><ul>
      <li>CBRE</li><li>Jaxgreen Industrial</li><li>JWB Real Estate Capital</li>
      <li>Prime Realty</li><li>Sleiman Properties</li>
    </ul></div>
    <div class="client-category"><h4>residential</h4><ul>
      <li>100+ clients served</li><li>References available upon request</li>
    </ul></div>
  </div>
</div>`;
}

function buildPortfolioBlock() {
  const photos = ['portfolio-1.jpg','portfolio-2.jpg','portfolio-3.jpg',
                  'portfolio-4.jpg','portfolio-5.jpg','portfolio-6.jpg'];
  let imgs = '';
  for (const photo of photos) {
    const p = path.join(IMAGES_DIR, photo);
    if (fs.existsSync(p)) {
      const b64 = fs.readFileSync(p).toString('base64');
      imgs += `<img src="data:image/jpeg;base64,${b64}" alt="ZINN project">`;
    }
  }
  if (!imgs) return '';
  return `<div class="section" style="padding:0;"><div class="portfolio-grid">${imgs}</div></div>`;
}

function buildMarketingPlugBlock() {
  return `<div class="section">
  <h2 class="section-label">furnishings &amp; decor</h2>
  <div class="section-accent"></div>
  <p class="legal-text">Ask us about Furnishings and Decor services! We can help you fill out your project down to the finest detail. We utilize our vendor relationships to ensure the highest quality furnishings and accessories are selected and can even handle installation and staging.</p>
  <ul class="legal-list">
    <li>Prepare and present design boards</li>
    <li>Prepare purchase orders and place orders upon client approval</li>
    <li>Track orders and update delivery schedule</li>
    <li>Oversee storage, delivery, and installation of furnishings</li>
    <li>Decorative and furniture specifications (ZINN as vendor)</li>
  </ul>
  <p class="legal-text" style="margin-top:12px;font-style:italic;">Note that Fixtures and Finishes are included in our Standard and Premium F&amp;F service levels as they typically involve items that are fixed in place.</p>
</div>`;
}

// forPdf=true  → ink signature block (for PDF attachment)
// forPdf=false → interactive e-sign UI (for web /p/<cardId>)
function buildAcceptanceBlock(parsed, forPdf = false) {
  if (forPdf) {
    return `<div class="section acceptance-section">
  <h2 class="section-label">acceptance</h2>
  <div class="section-accent"></div>
  <p class="legal-text">By signing below you agree to the scope, fee, and general conditions outlined in this proposal. If you have questions, reply to the email and we&#8217;ll schedule a call.</p>

  <div style="margin-top:40px;">
    <div style="display:flex;gap:24px;align-items:flex-end;">
      <div style="flex:1;">
        <p style="font-size:11px;color:#81A2B2;margin-bottom:4px;letter-spacing:0.5px;">SIGNATURE</p>
        <div style="border-bottom:1px solid #000;min-height:60px;background:#fff;"></div>
      </div>
      <div style="flex:0 0 200px;">
        <p style="font-size:11px;color:#81A2B2;margin-bottom:4px;letter-spacing:0.5px;">DATE</p>
        <div style="border-bottom:1px solid #000;min-height:60px;background:#fff;"></div>
      </div>
    </div>
    <div style="margin-top:24px;">
      <p style="font-size:11px;color:#81A2B2;margin-bottom:4px;letter-spacing:0.5px;">PRINTED NAME</p>
      <div style="border-bottom:1px solid #000;min-height:44px;background:#fff;"></div>
    </div>
  </div>
</div>`;
  }

  // Web version: interactive e-sign UI
  const cardId = (parsed && parsed.cardId) ? parsed.cardId : '';
  return `<div class="section acceptance-section" id="esign-section">
  <h2 class="section-label">acceptance</h2>
  <div class="section-accent"></div>
  <p class="legal-text">By signing below you agree to the scope, fee, and general conditions outlined in this proposal. If you have questions, reply to the email and we&#8217;ll schedule a call.</p>

  <div id="sign-form" style="margin-top:32px;">
    <div style="margin-bottom:20px;">
      <p style="font-size:11px;color:#81A2B2;margin-bottom:6px;letter-spacing:0.5px;text-transform:uppercase;">Full Name</p>
      <input id="sign-name" type="text" placeholder="Your full name"
        style="width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:3px;padding:10px 12px;font-size:14px;font-family:'Avenir Next',Avenir,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#242C39;outline:none;">
    </div>
    <div style="margin-bottom:20px;">
      <p style="font-size:11px;color:#81A2B2;margin-bottom:6px;letter-spacing:0.5px;text-transform:uppercase;">Email</p>
      <input id="sign-email" type="email" placeholder="Your email address"
        style="width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:3px;padding:10px 12px;font-size:14px;font-family:'Avenir Next',Avenir,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#242C39;outline:none;">
    </div>
    <div style="margin-bottom:24px;">
      <p style="font-size:11px;color:#81A2B2;margin-bottom:6px;letter-spacing:0.5px;text-transform:uppercase;">Signature</p>
      <canvas id="sig-canvas" width="600" height="150"
        style="display:block;border:1px solid #ccc;border-radius:3px;background:#fff;width:100%;max-width:100%;touch-action:none;cursor:crosshair;"></canvas>
      <div style="margin-top:6px;text-align:right;">
        <button onclick="clearSig()" type="button"
          style="background:none;border:none;font-size:11px;color:#81A2B2;cursor:pointer;letter-spacing:0.5px;text-decoration:underline;font-family:'Avenir Next',Avenir,'Helvetica Neue',Helvetica,Arial,sans-serif;">Clear</button>
      </div>
    </div>
    <div id="sign-error" style="display:none;color:#c0392b;font-size:13px;margin-bottom:16px;"></div>
    <button id="sign-btn" onclick="submitSign('${cardId}')" type="button"
      style="background:#242C39;color:#fff;border:none;padding:14px 40px;font-size:13px;letter-spacing:2px;text-transform:uppercase;cursor:pointer;font-family:'Avenir Next',Avenir,'Helvetica Neue',Helvetica,Arial,sans-serif;border-radius:2px;">
      Accept &amp; Sign
    </button>
  </div>

  <script>
  (function() {
    function initCanvas() {
    const canvas = document.getElementById('sig-canvas');
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let lastX = 0, lastY = 0;

    function getPos(e) {
      const r = canvas.getBoundingClientRect();
      const scaleX = canvas.width / r.width;
      const scaleY = canvas.height / r.height;
      if (e.touches) {
        return { x: (e.touches[0].clientX - r.left) * scaleX, y: (e.touches[0].clientY - r.top) * scaleY };
      }
      return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
    }

    function start(e) { e.preventDefault(); drawing = true; const p = getPos(e); lastX = p.x; lastY = p.y; }
    function move(e) {
      e.preventDefault();
      if (!drawing) return;
      const p = getPos(e);
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = '#242C39'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
      lastX = p.x; lastY = p.y;
    }
    function stop(e) { drawing = false; }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', stop);
    canvas.addEventListener('mouseleave', stop);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', stop);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCanvas);
    } else {
      initCanvas();
    }
  })();

  window.clearSig = function() {
    const canvas = document.getElementById('sig-canvas');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  };

  function isCanvasBlank() {
    const canvas = document.getElementById('sig-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) return false; }
    return true;
  }

  function getOptionalChecked() {
    return Array.from(document.querySelectorAll('.fee-optional-check:checked')).map(el => el.dataset.idx);
  }
  function getTieredSelected() {
    return Array.from(document.querySelectorAll('.fee-tier-radio:checked')).map(el => ({ idx: el.dataset.idx, tier: el.dataset.tier }));
  }

  window.submitSign = async function(cardId) {
    const name    = document.getElementById('sign-name').value.trim();
    const email   = document.getElementById('sign-email').value.trim();
    const errEl   = document.getElementById('sign-error');
    const btn     = document.getElementById('sign-btn');
    errEl.style.display = 'none';

    if (!name)               { errEl.textContent = 'Please enter your full name.';          errEl.style.display='block'; return; }
    if (!email || !email.includes('@')) { errEl.textContent = 'Please enter a valid email.'; errEl.style.display='block'; return; }
    if (isCanvasBlank())     { errEl.textContent = 'Please draw your signature above.';     errEl.style.display='block'; return; }

    const signature  = document.getElementById('sig-canvas').toDataURL('image/png');
    const signedAt   = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const optionalChecked = getOptionalChecked();
    const tieredSelected  = getTieredSelected();

    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      const res = await fetch('/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, name, email, signature, signedAt, optionalChecked, tieredSelected })
      });
      if (res.ok) {
        document.getElementById('sign-form').innerHTML =
          '<div style="padding:32px;text-align:center;background:#f0f7f4;border:1px solid #a5d6a7;border-radius:4px;"><p style="font-size:16px;color:#2e6b4f;font-family:Avenir,Helvetica,Arial,sans-serif;margin:0;"><strong>Thank you, ' + name.split(' ')[0] + '.</strong><br><span style="font-size:14px;">Thank you for signing your proposal. We look forward to working with you and will be in touch shortly about next steps!</span></p><p style="font-size:14px;color:#2e6b4f;font-family:Avenir,Helvetica,Arial,sans-serif;margin:16px 0 0 0;">You will receive an email shortly with a PDF copy of this proposal for your records.</p></div>';
      } else {
        const data = await res.json().catch(() => ({}));
        errEl.textContent = data.error || 'Something went wrong. Please try again or reply to our email.';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Accept & Sign';
      }
    } catch(e) {
      errEl.textContent = 'Network error. Please try again or reply to our email.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Accept & Sign';
    }
  }
  </script>
</div>`;
}

// ─── TEMPLATE RENDER ─────────────────────────────────────────────────────────

async function renderTemplate(parsed, forPdf = false) {
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const { proposal_length } = parsed;
  const isLong       = proposal_length === 'long';
  const isMediumPlus = proposal_length === 'medium' || isLong;

  const scopeHtml = parseScopeHtml(parsed.scope);

  const teamBlock = isLong ? await buildTeamBlock() : '';

  const vars = {
    '{{client}}':              escHtml(parsed.client),
    '{{client_first_name}}':   escHtml(parsed.client_first_name),
    '{{client_greeting}}':     escHtml(parsed.client_greeting || parsed.client_first_name),
    '{{client_address}}':      escHtml(parsed.client_address).replace(/\n/g, '<br>'),
    '{{client_email}}':        escHtml(parsed.client_email),
    '{{client_phone}}':        escHtml(parsed.client_phone),
    '{{project_name}}':        escHtml(parsed.project_name),
    '{{project_address}}':     escHtml(parsed.project_address),
    '{{scope}}':               scopeHtml,
    '{{fee_table}}':           buildFeeTable(parsed.fee_lines),
    '{{billing_block}}':       buildBillingBlock(parsed.billing_type),
    '{{phases_block}}':        buildPhasesBlock(parsed.phases),
    '{{acceptance_block}}':    buildAcceptanceBlock(parsed, forPdf || false),
    '{{about_block}}':         isLong ? buildAboutBlock() : '',
    '{{team_block}}':          teamBlock,
    '{{client_list_block}}':   isLong ? buildClientListBlock() : '',
    '{{portfolio_block}}':     isLong ? buildPortfolioBlock() : '',
    '{{marketing_plug_block}}': isMediumPlus ? buildMarketingPlugBlock() : '',
    '{{date}}':                parsed.date,
    '{{header_logo}}':          buildHeaderLogoTag(),
  };

  for (const [k, v] of Object.entries(vars)) html = html.split(k).join(v);
  return html;
}

function escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── SEND EMAIL (via shared module) ───────────────────────────────────────

// Gmail client and email sending now handled by the shared email module.
// The shared module handles auth (files or env vars), branded HTML, and attachments.
const getGmailClient = email.getGmailClient;
const sendEmailDirect = email.sendEmail;

// RFC 2047 base64 subject encoding for non-ASCII characters
function encodeSubject(str) {
  return '=?UTF-8?B?' + Buffer.from(str, 'utf8').toString('base64') + '?=';
}

// ─── GMAIL DRAFT ──────────────────────────────────────────────────────────────

const LOGO_PATH_EMAIL  = '/Users/robzinn/ZINN Dropbox/marketing/branding/logos/_logo-email.png';
const LOGO_PATH_WHITE  = '/Users/robzinn/ZINN Dropbox/marketing/branding/logos/zinn_logo-transparent-white.png';
const LOGO_PATH_BLACK  = '/Users/robzinn/ZINN Dropbox/marketing/branding/logos/zinn_logo-transparent-black.png';

// Fallback logos as base64 (used when logo files not available, e.g. on Railway)
const LOGO_EMAIL_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAlgAAADhCAYAAAAUPMtIAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyhpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuNi1jMTQ1IDc5LjE2MzQ5OSwgMjAxOC8wOC8xMy0xNjo0MDoyMiAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENDIDIwMTkgKE1hY2ludG9zaCkiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6NEQ4QTU2RUY5RThEMTFFOTg2RTREMDY2OTBFMDI4M0EiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6NEQ4QTU2RjA5RThEMTFFOTg2RTREMDY2OTBFMDI4M0EiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDo0RDhBNTZFRDlFOEQxMUU5ODZFNEQwNjY5MEUwMjgzQSIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDo0RDhBNTZFRTlFOEQxMUU5ODZFNEQwNjY5MEUwMjgzQSIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PlCjnqAAAC29SURBVHja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';
const LOGO_WHITE_B64 = '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AQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAEJCABCUhAAhKQgAQkIAEJSEACEpCABCQgAQlIQAISkIAE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';
// Returns an <img> tag with the white logo embedded as base64 for the dark proposal header
function buildHeaderLogoTag() {
  const logoPath = fs.existsSync(LOGO_PATH_BLACK) ? LOGO_PATH_BLACK
                 : fs.existsSync(LOGO_PATH_WHITE)  ? LOGO_PATH_WHITE
                 : null;
  if (logoPath) {
    const b64 = fs.readFileSync(logoPath).toString('base64');
    const mime = logoPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `<img src="data:${mime};base64,${b64}" alt="ZINN Architecture + Interiors" style="height:63px;width:auto;margin-left:25px;">`;
  }
  if (LOGO_EMAIL_B64) {
    return `<img src="data:image/png;base64,${LOGO_EMAIL_B64}" alt="ZINN Architecture + Interiors" style="height:63px;width:auto;margin-left:25px;">`;
  }
  return `<span style="font-size:22px;letter-spacing:6px;color:#ffffff;font-weight:300;">ZINN</span>`;
}

// Returns { html, logoBuffer } - html uses cid:zinn-logo so the logo renders
// in Gmail (data: URIs are blocked by Gmail). logoBuffer is null if not found.
function buildEmailBody(parsed, proposalUrl) {
  const font = `'Avenir Next', Avenir, 'Helvetica Neue', Helvetica, Arial, sans-serif`;

  let logoBuffer = null;
  let logoTag;
  if (fs.existsSync(LOGO_PATH_EMAIL)) {
    logoBuffer = fs.readFileSync(LOGO_PATH_EMAIL);
    logoTag = `<img src="cid:zinn-logo" alt="ZINN" style="height:40px;width:auto;display:block;">`;
  } else {
    logoTag = `<div style="font-size:16px;font-weight:400;letter-spacing:4px;color:#242C39;font-family:${font};">ZINN</div>`;
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#f0f0f0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f0f0;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
      <tr>
        <td style="background-color:#ffffff;padding:32px 40px 20px 40px;text-align:left;">
          ${logoTag}
        </td>
      </tr>
      <tr>
        <td style="padding:0;"><div style="border-top:1px solid #000000;margin:0 40px;"></div></td>
      </tr>
      <tr>
        <td style="padding:32px 40px;background-color:#ffffff;">
          <p style="font-family:${font};font-size:14px;color:#242C39;margin:0 0 20px 0;">Hello ${escHtml(parsed.client_greeting || parsed.client_first_name)},</p>
          <p style="font-family:${font};font-size:13px;color:#4e5757;line-height:1.8;margin:0 0 16px 0;">I have developed this proposal for your review. I aimed to capture your priorities in the Scope of Work section &#8212; please let me know if there is anything I forgot or that you would like to add or revise.</p>
          <p style="font-family:${font};font-size:13px;color:#4e5757;line-height:1.8;margin:0 0 32px 0;">Thank you,<br>Rob.</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 40px 0;">
            <tr>
              <td style="background-color:#242C39;">
                <a href="${proposalUrl}" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;font-weight:500;">View Proposal</a>
              </td>
            </tr>
          </table>
          <div style="border-top:1px solid #E0E8EC;margin:0 0 20px 0;"></div>
          <p style="font-family:${font};font-size:12px;color:#242C39;margin:0 0 4px 0;font-weight:600;">Rob Zinn, AIA NCARB</p>
          <p style="font-family:${font};font-size:12px;color:#242C39;margin:0 0 2px 0;"><a href="https://zinn.ai" style="color:#242C39;text-decoration:none;">zinn.ai</a></p>
          <p style="font-family:${font};font-size:12px;color:#242C39;margin:0;">904.257.6117</p>
        </td>
      </tr>
      <tr>
        <td style="background-color:#f0f0f0;padding:16px 40px;border-top:1px solid #E0E8EC;">
          <p style="font-family:${font};font-size:11px;color:#81A2B2;margin:0;text-align:center;">1022 park street #407, jacksonville, fl 32204 &nbsp;|&nbsp; <a href="tel:9043521203" style="color:#81A2B2;text-decoration:none;">904.352.1203</a> &nbsp;|&nbsp; <a href="mailto:info@zinn.ai" style="color:#81A2B2;text-decoration:none;">info@zinn.ai</a></p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { html, logoBuffer };
}

// ─── PUPPETEER BROWSER SINGLETON ──────────────────────────────────────────────
// Reuse a single browser instance to avoid macOS process-exit propagation.

// renderPdf spawns an isolated worker subprocess so Chrome's native exit()
// call on macOS never kills the parent server process.
async function renderPdf(html) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const worker = spawn(process.execPath, [path.join(ROOT, 'pdf-worker.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const opts = getPdfOptions();
    worker.stdin.end(JSON.stringify({ html, options: opts }));
    const chunks = [];
    worker.stdout.on('data', c => chunks.push(c));
    const errChunks = [];
    worker.stderr.on('data', c => errChunks.push(c));
    worker.on('close', code => {
      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString();
        return reject(new Error('pdf-worker exited ' + code + ': ' + msg));
      }
      const b64 = Buffer.concat(chunks).toString();
      resolve(Buffer.from(b64, 'base64'));
    });
    worker.on('error', reject);
  });
}

// ─── PUPPETEER PDF OPTIONS ─────────────────────────────────────────────────────────

function getPdfOptions(extraOpts = {}) {
  const logoPath = '/Users/robzinn/ZINN Dropbox/marketing/branding/logos/_logo-email.png';
  let logoSrc  = '';
  if (fs.existsSync(logoPath)) {
    logoSrc = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
  } else if (LOGO_EMAIL_B64) {
    logoSrc = `data:image/png;base64,${LOGO_EMAIL_B64}`;
  }
  const logoHtml = logoSrc
    ? `<img src="${logoSrc}" style="height:60px;width:auto;display:block;">`
    : `<span style="font-family:'Spartan',sans-serif;font-size:18px;letter-spacing:3px;color:#242C39;">ZINN</span>`;

  const headerTemplate = `
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  #hdr-content {
    width: 100%;
    padding: 16px 72px 32px 72px;
    position: relative;
    font-family: 'Spartan', sans-serif;
  }
  #hdr-rule {
    border: none;
    border-top: 1.5px solid #000;
    margin: 0 72px;
  }
  .hdr-address {
    font-size: 9px;
    font-weight: 300;
    color: #4e5757;
    letter-spacing: 0.4px;
    white-space: nowrap;
    text-align: right;
    position: absolute;
    right: 0;
    bottom: 12px;
    font-family: 'Spartan', sans-serif;
  }
</style>
<div id="hdr-content">
  ${logoHtml}
  <div class="hdr-address">
    1022 park street #407, jacksonville, fl 32204 &nbsp;&bull;&nbsp; 904.352.1203 &nbsp;&bull;&nbsp; info@zinn.ai &nbsp;&bull;&nbsp; zinn.ai
  </div>
</div>
<div id="hdr-rule"></div>`;

  const footerTemplate = `
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  #ftr {
    width: 100%;
    padding: 10px 72px;
    text-align: center;
    font-family: 'Avenir Next', Avenir, 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-weight: 300;
    font-size: 8px;
    color: #81A2B2;
    letter-spacing: 0.5px;
  }
</style>
<div id="ftr">
  <span class="pageNumber"></span> / <span class="totalPages"></span>
</div>`;

  return Object.assign({
    format: 'Letter',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate,
    footerTemplate,
    margin: { top: '1.6in', right: '0', bottom: '1.6in', left: '0' },
  }, extraOpts);
}

// ─── SIGNED PDF HELPERS ─────────────────────────────────────────────────────────

/**
 * Generate a clean acceptance PDF without Chrome/Puppeteer.
 * Falls back to this when Puppeteer isn't available (e.g. Railway).
 */
async function generateSimpleSignedPdf(parsed, name, email, sigPngPath, signedAt) {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // Letter
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 612, H = 792, M = 56;
  let y = H - M;
  const gray = rgb(0.5,0.5,0.5);
  const midGray = rgb(0.3,0.3,0.3);
  const lightGray = rgb(0.88,0.88,0.88);
  const black = rgb(0,0,0);
  // Logo
  try {
    let logoData;
    if (fs.existsSync(LOGO_PATH_EMAIL)) logoData = fs.readFileSync(LOGO_PATH_EMAIL);
    else if (LOGO_EMAIL_B64) logoData = Buffer.from(LOGO_EMAIL_B64, 'base64');
    if (logoData) {
      const img = await doc.embedPng(logoData);
      page.drawImage(img, { x: M, y: y - 28, width: 100, height: 28 });
      y -= 36;
    }
  } catch {}

  // Rule
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: black });
  y -= 28;

  // ── Project + Client ──
  const projectName = parsed ? parsed.project_name || '' : '';
  const clientName  = parsed ? parsed.client || '' : '';
  const phases      = parsed && parsed.phases ? parsed.phases.join(', ') : '';
  const billingType = parsed ? parsed.billing_type || '' : '';
  const proposalDate = parsed ? parsed.date || '' : '';

  // Project on left, date on right
  page.drawText('project', { x: M, y, size: 9, font: f, color: gray });
  y -= 13;
  page.drawText(projectName, { x: M, y, size: 18, font: fb, color: black });
  y -= 22;
  page.drawText(clientName, { x: M, y, size: 12, font: f, color: midGray });
  y -= 30;

  // Proposal metadata
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: lightGray });
  y -= 18;
  const meta = [['fee proposal', proposalDate || ''], ['billing', billingType || ''], ['phases', phases || '']];
  for (const [label, value] of meta) {
    page.drawText(label, { x: M, y, size: 8, font: f, color: gray });
    page.drawText(value, { x: M + 80, y, size: 9, font: f, color: black });
    y -= 14;
  }
  y -= 4;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: lightGray });
  y -= 20;

  // ── Fee table ──
  if (parsed && parsed.fee_lines && parsed.fee_lines.length) {
    // Table header
    page.drawRectangle({ x: M, y: y - 16, width: W - 2*M, height: 16, color: black });
    page.drawText('service', { x: M + 10, y: y - 11, size: 8, font: fb, color: white });
    page.drawText('fee', { x: W - M - 70, y: y - 11, size: 8, font: fb, color: white });
    y -= 20;

    let totalFee = 0;
    for (const line of parsed.fee_lines) {
      if (line.type === 'required') {
        const amt = parseFloat(line.amount.replace(/[$,]/g,'')) || 0;
        totalFee += amt;
        const desc = line.desc.length > 50 ? line.desc.slice(0, 47) + '...' : line.desc;
        page.drawText(desc, { x: M + 8, y, size: 9, font: f, color: black });
        page.drawText(line.amount, { x: W - M - 70, y, size: 9, font: fb, color: black });
        y -= 16;
        page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.3, color: lightGray });
        y -= 4;
      }
    }
    y -= 4;
    // Total
    page.drawLine({ start: { x: W - M - 90, y }, end: { x: W - M, y }, thickness: 1, color: black });
    y -= 14;
    page.drawText('proposed fee total:', { x: W - M - 150, y, size: 10, font: fb, color: black });
    page.drawText('$' + totalFee.toLocaleString('en-US', {minimumFractionDigits:2}), { x: W - M - 70, y, size: 10, font: fb, color: black });
    y -= 28;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: lightGray });
    y -= 20;
  }

  // ── Acceptance signature area ──
  page.drawText('acceptance', { x: M, y, size: 10, font: fb, color: black });
  y -= 6;
  page.drawText('signed proposal — binding agreement', { x: M, y, size: 8, font: f, color: gray });
  y -= 18;

  page.drawText('printed name', { x: M, y, size: 8, font: f, color: gray });
  y -= 12;
  page.drawText(name || '—', { x: M, y, size: 11, font: f, color: black });
  y -= 20;

  page.drawText('email', { x: M, y, size: 8, font: f, color: gray });
  y -= 12;
  page.drawText(email || '—', { x: M, y, size: 11, font: f, color: black });
  y -= 24;

  // Signature image
  page.drawText('signature', { x: M, y, size: 8, font: f, color: gray });
  y -= 14;
  try {
    if (fs.existsSync(sigPngPath)) {
      const sigBuf = fs.readFileSync(sigPngPath);
      const sigImg = await doc.embedPng(sigBuf);
      const aspect = sigImg.width / sigImg.height;
      page.drawImage(sigImg, { x: M, y: y - 42, width: 160, height: 160 / aspect });
      y -= 52;
    }
  } catch {}

  // ── Footer ──
  y = Math.max(y, 50);
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.75,0.75,0.75) });
  y -= 16;
  page.drawText('ZINN Architecture + Interiors', { x: M, y, size: 8, font: fb, color: midGray });
  y -= 11;
  page.drawText('1022 park street #407  |  jacksonville, fl 32204  |  zinn.ai  |  904.352.1203', { x: M, y, size: 7, font: f, color: gray });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

// Build a static (non-interactive) fee table reflecting the client's selections.
// Used in the signed PDF so checkboxes/radios render as plain text.
function buildStaticFeeTable(feeLines, optionalChecked, tieredSelected) {
  // Build lookup maps
  const optMap = {};
  (optionalChecked || []).forEach(o => { optMap[String(o.index)] = !!o.checked; });
  const tierMap = {};
  (Array.isArray(tieredSelected) ? tieredSelected : []).forEach(t => { tierMap[String(t.index)] = t.tier; });

  const tierLabels = ['basic', 'standard', 'premium'];
  let total = 0;

  const rows = feeLines.map((f, i) => {
    const descCell = f.subNote
      ? `${escHtml(f.desc)} <span class="fee-sub-note">(${escHtml(f.subNote)})</span>`
      : escHtml(f.desc);

    if (f.type === 'tiered') {
      const selTier = tierMap.hasOwnProperty(String(i)) ? tierMap[String(i)] : 0;
      const tierIdx = (selTier === null || selTier === '-1' || selTier === -1) ? -1 : parseInt(selTier, 10);
      let displayAmt = '\u2014'; // em-dash for "not included"
      let tierLabel  = 'not included';
      if (tierIdx >= 0 && tierIdx < 3 && f.tiers[tierIdx]) {
        displayAmt = escHtml(f.tiers[tierIdx]);
        tierLabel  = tierLabels[tierIdx];
        total += parseFloat(f.tiers[tierIdx].replace(/[$,]/g, '')) || 0;
      }
      return `<tr class="fee-row">
        <td class="fee-desc-cell">${descCell} <span style="font-size:11px;color:#81A2B2;font-style:italic;">(${tierLabel})</span></td>
        <td class="fee-amount-cell">${displayAmt}</td>
      </tr>`;
    }

    if (f.type === 'optional') {
      const checked = optMap.hasOwnProperty(String(i)) ? optMap[String(i)] : false;
      if (!checked) {
        return `<tr class="fee-row" style="opacity:0.45;">
          <td class="fee-desc-cell">${descCell} <span style="font-size:11px;color:#81A2B2;font-style:italic;">(optional \u2014 not selected)</span></td>
          <td class="fee-amount-cell" style="color:#81A2B2;">${escHtml(f.amount)}</td>
        </tr>`;
      }
      total += parseFloat(f.amount.replace(/[$,]/g, '')) || 0;
      return `<tr class="fee-row">
        <td class="fee-desc-cell">${descCell} <span style="font-size:11px;color:#000;font-style:italic;">(optional \u2014 selected)</span></td>
        <td class="fee-amount-cell">${escHtml(f.amount)}</td>
      </tr>`;
    }

    // Required
    const amt = parseFloat(f.amount.replace(/[$,]/g, '')) || 0;
    total += amt;
    const isCredit = f.amount.startsWith('-');
    return `<tr class="fee-row">
      <td class="fee-desc-cell">${descCell}</td>
      <td class="fee-amount-cell${isCredit ? ' fee-credit' : ''}">${escHtml(f.amount)}</td>
    </tr>`;
  }).join('\n');

  const formatted = '$' + total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<table class="fee-table">
  <thead><tr><th>description</th><th>amount</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr class="fee-total-row">
      <td>proposed fee</td>
      <td>${formatted}</td>
    </tr>
  </tfoot>
</table>`;
}

// Renders the proposal HTML with the acceptance section replaced by a
// completed e-sign block (name, email, signature image) for PDF archival.
async function buildSignedHtml(parsed, name, email, sigPngPath, feeSelections = {}) {
  const html = await renderTemplate(parsed, true); // PDF version - ink block (gets replaced by signed block below)
  const { optionalChecked = [], tieredSelected = [] } = feeSelections;

  let sigImgTag = '';
  if (fs.existsSync(sigPngPath)) {
    const b64 = fs.readFileSync(sigPngPath).toString('base64');
    sigImgTag = `<img src="data:image/png;base64,${b64}" style="max-height:80px;display:block;" alt="signature">`;
  }

  const signedAt = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  const signedBlock = `<div class="section acceptance-section">
  <h2 class="section-label">acceptance</h2>
  <div class="section-accent"></div>
  <p class="legal-text">By signing below, the undersigned agrees to engage ZINN Architecture and Interiors under the terms and conditions set forth in this proposal, including the Scope of Work, Fee, and General Conditions. This signed proposal constitutes a binding agreement between the Client and ZINN Architecture and Interiors.</p>
  <table style="width:100%;border-collapse:collapse;margin-top:24px;font-size:12px;color:#4e5757;">
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #E0E8EC;width:120px;color:#81A2B2;font-size:10px;letter-spacing:1px;text-transform:uppercase;">printed name</td>
      <td style="padding:8px 16px;border-bottom:1px solid #E0E8EC;">${escHtml(name)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #E0E8EC;color:#81A2B2;font-size:10px;letter-spacing:1px;text-transform:uppercase;">email</td>
      <td style="padding:8px 16px;border-bottom:1px solid #E0E8EC;">${escHtml(email)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #E0E8EC;color:#81A2B2;font-size:10px;letter-spacing:1px;text-transform:uppercase;">date</td>
      <td style="padding:8px 16px;border-bottom:1px solid #E0E8EC;">${signedAt}</td>
    </tr>
    <tr>
      <td style="padding:16px 0 8px;color:#81A2B2;font-size:10px;letter-spacing:1px;text-transform:uppercase;vertical-align:top;">signature</td>
      <td style="padding:16px 16px 8px;">${sigImgTag}</td>
    </tr>
  </table>
</div>`;

  // Replace the acceptance section with the signed version.
  // Walk div depth to find the exact closing tag of the acceptance block.
  const OPEN_MARKER = '<div class="section acceptance-section';
  const startIdx = html.indexOf(OPEN_MARKER);
  if (startIdx === -1) {
    console.warn('[sign] Could not locate acceptance section in HTML - returning unmodified');
    return html;
  }
  let depth = 0, i = startIdx;
  while (i < html.length) {
    if (html.slice(i, i + 5) === '<div ') depth++;
    else if (html.slice(i, i + 6) === '</div>') {
      depth--;
      if (depth === 0) { i += 6; break; }
    }
    i++;
  }
  // i now points to just after the acceptance block's closing </div>
  let finalHtml = html.slice(0, startIdx) + signedBlock + '\n' + html.slice(i);

  // Replace the interactive fee table with a static version that reflects
  // the client's checkbox/tier selections as plain text for the signed PDF.
  if (parsed.fee_lines && parsed.fee_lines.length) {
    const staticTable = buildStaticFeeTable(parsed.fee_lines, optionalChecked, tieredSelected);
    const tableOpen = '<table class="fee-table" id="fee-table">';
    const tIdx = finalHtml.indexOf(tableOpen);
    if (tIdx !== -1) {
      const tableClose = '</table>';
      const tEnd = finalHtml.indexOf(tableClose, tIdx);
      if (tEnd !== -1) {
        const afterTable = tEnd + tableClose.length;
        // Also strip the inline <script>...</script> that powered the interactive total
        let scriptEnd = afterTable;
        const remainder = finalHtml.slice(afterTable);
        const scriptMatch = remainder.match(/^\s*<script>[\s\S]*?<\/script>/);
        if (scriptMatch) {
          scriptEnd = afterTable + scriptMatch[0].length;
        }
        finalHtml = finalHtml.slice(0, tIdx) + staticTable + finalHtml.slice(scriptEnd);
      }
    }
  }

  return finalHtml;
}

// Shared branded HTML email body for post-sign notifications
// Returns { html, logoBuffer } - same pattern as buildEmailBody
function buildSignNotificationEmail({ recipientName, intro, body, pdfLabel, projectName }) {
  const font = `'Avenir Next', Avenir, 'Helvetica Neue', Helvetica, Arial, sans-serif`;

  let logoBuffer = null;
  let logoTag;
  if (fs.existsSync(LOGO_PATH_EMAIL)) {
    logoBuffer = fs.readFileSync(LOGO_PATH_EMAIL);
    logoTag = `<img src="cid:zinn-logo" alt="ZINN" style="height:40px;width:auto;display:block;">`;
  } else if (LOGO_EMAIL_B64) {
    logoBuffer = Buffer.from(LOGO_EMAIL_B64, 'base64');
    logoTag = `<img src="cid:zinn-logo" alt="ZINN" style="height:40px;width:auto;display:block;">`;
  } else {
    logoTag = `<div style="font-size:16px;font-weight:400;letter-spacing:4px;color:#242C39;font-family:${font};">ZINN</div>`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#f0f0f0;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f0f0;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
      <tr><td style="background-color:#ffffff;padding:32px 40px 20px 40px;text-align:left;">${logoTag}</td></tr>
      <tr><td style="padding:0;"><div style="border-top:1px solid #000000;margin:0 40px;"></div></td></tr>
      <tr><td style="padding:32px 40px;background-color:#ffffff;">
        <p style="font-family:${font};font-size:14px;color:#242C39;margin:0 0 20px 0;">Hello ${escHtml(recipientName)},</p>
        ${intro || ''}
        ${body || ''}
        <div style="border-top:1px solid #E0E8EC;margin:24px 0 20px 0;"></div>
        <p style="font-family:${font};font-size:12px;color:#242C39;margin:0 0 4px 0;font-weight:600;">Rob Zinn, AIA NCARB</p>
        <p style="font-family:${font};font-size:12px;color:#242C39;margin:0 0 2px 0;"><a href="https://zinn.ai" style="color:#242C39;text-decoration:none;">zinn.ai</a></p>
        <p style="font-family:${font};font-size:12px;color:#242C39;margin:0;">904.257.6117</p>
      </td></tr>
      <tr><td style="background-color:#f0f0f0;padding:16px 40px;border-top:1px solid #E0E8EC;">
        <p style="font-family:${font};font-size:11px;color:#81A2B2;margin:0;text-align:center;">1022 park street #407, jacksonville, fl 32204 &nbsp;|&nbsp; <a href="tel:9043521203" style="color:#81A2B2;text-decoration:none;">904.352.1203</a> &nbsp;|&nbsp; <a href="mailto:info@zinn.ai" style="color:#81A2B2;text-decoration:none;">info@zinn.ai</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { html, logoBuffer };
}

// Build a proper MIME raw message with:
//   multipart/mixed  (outer - for PDF attachment)
//     multipart/related  (inner - for HTML + inline CID logo)
//       text/html
//       image/png (cid:zinn-logo)
//     application/pdf  (optional attachment)
function buildMimeRaw({ from, to, cc, subject, htmlBody, logoBuffer, pdfBuffer, pdfName }) {
  const outerBoundary = `zinn_outer_${Date.now()}`;
  const innerBoundary = `zinn_inner_${Date.now() + 1}`;
  const CRLF = '\r\n';

  // Chunk base64 at 76 chars per line (MIME spec)
  function chunkBase64(b64) {
    return b64.match(/.{1,76}/g).join(CRLF);
  }

  const htmlB64   = chunkBase64(Buffer.from(htmlBody, 'utf8').toString('base64'));
  const logoB64   = logoBuffer ? chunkBase64(logoBuffer.toString('base64')) : null;

  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeSubject(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${outerBoundary}"`,
    ``,
    // - inner multipart/related -
    `--${outerBoundary}`,
    `Content-Type: multipart/related; boundary="${innerBoundary}"`,
    ``,
    `--${innerBoundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    htmlB64,
  ];

  if (logoBuffer && logoB64) {
    lines.push(
      ``,
      `--${innerBoundary}`,
      `Content-Type: image/png; name="logo.png"`,
      `Content-Disposition: inline; filename="logo.png"`,
      `Content-Transfer-Encoding: base64`,
      `Content-ID: <zinn-logo>`,
      `X-Attachment-Id: zinn-logo`,
      ``,
      logoB64,
    );
  }

  lines.push(`--${innerBoundary}--`);

  if (pdfBuffer && pdfName) {
    const pdfB64 = chunkBase64(pdfBuffer.toString('base64'));
    lines.push(
      ``,
      `--${outerBoundary}`,
      `Content-Type: application/pdf; name="${pdfName}"`,
      `Content-Disposition: attachment; filename="${pdfName}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      pdfB64,
    );
  }

  lines.push(`--${outerBoundary}--`);

  const raw = lines
    .filter(l => l !== null)
    .join(CRLF);
  return Buffer.from(raw, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createGmailDraft(parsed, htmlPath, pdfPath, proposalUrl) {
  if (!parsed.client_email) {
    console.log('Gmail draft skipped - no client email.');
    return;
  }

  const subject = `${parsed.project_name} - Proposal`;
  const { html: emailHtml, logoBuffer } = buildEmailBody(parsed, proposalUrl || htmlPath);
  const pdfBuffer = (pdfPath && fs.existsSync(pdfPath)) ? fs.readFileSync(pdfPath) : null;
  const pdfName   = pdfBuffer ? path.basename(pdfPath) : null;

  // All client emails: To = first, additional ones added to To as well
  const allClientEmails = parsed.client_emails && parsed.client_emails.length
    ? parsed.client_emails
    : (parsed.client_email ? [parsed.client_email] : []);
  const toAddress = allClientEmails.join(', ');

  // ── Get Gmail client (Railway env vars or local credentials) ─────────────
  let gmail;
  if (process.env.GMAIL_CREDENTIALS && process.env.GMAIL_TOKEN) {
    console.log('Gmail draft: using env-var credentials (Railway mode).');
    const { google } = require('googleapis');
    const credentials = JSON.parse(Buffer.from(process.env.GMAIL_CREDENTIALS, 'base64').toString('utf8'));
    const tokenData   = JSON.parse(Buffer.from(process.env.GMAIL_TOKEN,       'base64').toString('utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(tokenData);
    if (tokenData.expiry_date && tokenData.expiry_date < Date.now()) {
      const { credentials: fresh } = await oAuth2Client.refreshAccessToken();
      oAuth2Client.setCredentials(fresh);
    }
    gmail = require('googleapis').google.gmail({ version: 'v1', auth: oAuth2Client });
  } else {
    gmail = await getGmailClient();
  }

  if (!gmail) {
    console.log('Gmail credentials not found - skipping draft.');
    return;
  }

  try {
    const raw = buildMimeRaw({
      from:       'rob@zinn.ai',
      to:         toAddress,
      cc:         'admin@zinn.ai',
      subject,
      htmlBody:   emailHtml,
      logoBuffer,
      pdfBuffer,
      pdfName,
    });
    await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
    console.log(`Gmail draft created for: ${toAddress}`);
  } catch (e) {
    console.error(`Gmail draft failed: ${e.message}`);
  }
}

// ─── MAIN GENERATE FUNCTION ───────────────────────────────────────────────────

async function generateProposal(cardId, proposalCache, parsedCache, { skipDraft } = {}) {
  console.log(`\nFetching card: ${cardId}`);
  const card   = await getCard(cardId);
  console.log(`Card: ${card.name}`);

  const parsed = parseCard(card);
  parsed.cardId = cardId;
  if (parsedCache) parsedCache[cardId] = parsed;

  console.log('\n── Parsed Fields ────────────────────────────────');
  console.log(`  client:      ${parsed.client}`);
  console.log(`  email:       ${parsed.client_email}`);
  console.log(`  project:     ${parsed.project_name}`);
  console.log(`  billing:     ${parsed.billing_type}`);
  console.log(`  phases:      ${parsed.phases.join(', ')}`);
  console.log(`  length:      ${parsed.proposal_length}`);
  console.log(`  fee lines:   ${parsed.fee_lines.length}`);
  console.log('─────────────────────────────────────────────────\n');

  const { errors, warnings } = validateCard(parsed);
  if (warnings.length) warnings.forEach(w => console.log(`  ! ${w}`));

  if (errors.length) {
    const msg = `Proposal not generated - missing required fields:\n${errors.map(e => `  - ${e}`).join('\n')}`;
    console.error('\n' + msg + '\n');
    await addCardComment(cardId, msg);
    try {
      await email.notifyOnFailure({
        service: 'proposal_generator',
        error: errors.join('<br>'),
        cardName: parsed.card_name,
        cardId: cardId,
      });
    } catch (e) {
      console.error('Failure notification failed:', e.message);
    }
    return { success: false, errors };
  }

  const { dir, base, projectFolder } = resolveOutputPath(parsed);
  const htmlPath = path.join(dir, base + '.html');
  const pdfPath  = path.join(dir, base + '.pdf');

  if (projectFolder) console.log(`Project folder: ${projectFolder}`);
  else console.log('Project folder not found - saving to local output/');

  // Web HTML: e-sign UI (no ink block)
  const html    = await renderTemplate(parsed, false);
  // PDF HTML:  ink signature block (no interactive e-sign)
  const pdfHtml = await renderTemplate(parsed, true);

  fs.writeFileSync(htmlPath, html);
  console.log(`HTML written: ${htmlPath}`);

  const outputDir = path.join(ROOT, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const cardHtmlPath = path.join(outputDir, cardId + '.html');
  fs.writeFileSync(cardHtmlPath, html);

  if (proposalCache) proposalCache[cardId] = html;

  let pdfWritten = false;
  try {
    const pdfBuf2 = await renderPdf(pdfHtml);
    fs.writeFileSync(pdfPath, pdfBuf2);
    console.log(`PDF written:  ${pdfPath}`);
    pdfWritten = true;
    // Also copy with card ID key for reliable retrieval at sign time
    try { fs.copyFileSync(pdfPath, path.join(outputDir, cardId + '.pdf')); } catch {}
  } catch (e) {
    console.log(`PDF skipped: ${e.message}`);
  }

  const publicBase  = process.env.PUBLIC_URL || 'http://localhost:3478';
  const proposalUrl = `${publicBase}/p/${cardId}`;

  if (!skipDraft) {
    await createGmailDraft(parsed, htmlPath, pdfWritten ? pdfPath : null, proposalUrl);
  }

  // Move card to "Proposal Follow Up" and set due date to +2 weeks
  await moveCardToList(cardId, TRELLO_LISTS.proposal_followup);
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);
  const dueDateISO = dueDate.toISOString().split('T')[0]; // YYYY-MM-DD format
  await setCardDueDate(cardId, dueDateISO);

  console.log('\nDone.\n');
  return { success: true, htmlPath, pdfPath: pdfWritten ? pdfPath : null };
}

// ─── DROPBOX UPLOAD ────────────────────────────────────────────────────────

async function getDropboxAccessToken() {
  const TEAM_MEMBER_ID = 'dbmid:AACzXf9UnyCFRGycr_Bw_pe1imOGaH5zEP8';

  // 1. Try stored token from DB first (OAuth refresh flow)
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const r = await pool.query(`SELECT value FROM settings WHERE key = 'dropbox_refresh_token'`);
    await pool.end();
    if (r.rows.length > 0) {
      const refreshToken = r.rows[0].value;
      // Exchange refresh token for a new access token
      let appKey = process.env.DROPBOX_APP_KEY;
      let appSecret = process.env.DROPBOX_APP_SECRET;
      if ((!appKey || !appSecret) && process.env.DROPBOX_CREDENTIALS) {
        try {
          const creds = JSON.parse(Buffer.from(process.env.DROPBOX_CREDENTIALS, 'base64').toString('utf8'));
          appKey = creds.app_key || appKey;
          appSecret = creds.app_secret || appSecret;
        } catch (e) { /* ignore */ }
      }
      if (appKey && appSecret) {
        const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: appKey,
            client_secret: appSecret,
          }).toString(),
        });
        const data = await res.json();
        if (res.ok && data.access_token) {
          console.log(`[dropbox] Got fresh access token via OAuth refresh (expires in ${data.expires_in}s)`);
          return { access_token: data.access_token, team_member_id: TEAM_MEMBER_ID };
        }
        console.log(`[dropbox] OAuth refresh failed: ${data.error_description || data.error}`);
      }
    }
  } catch (e) {
    console.log(`[dropbox] DB token check failed: ${e.message}`);
  }

  // 2. Fall back to env var
  const dropboxTokenRaw = process.env.DROPBOX_TOKEN;
  if (dropboxTokenRaw) {
    try {
      const parsed = JSON.parse(Buffer.from(dropboxTokenRaw, 'base64').toString('utf8'));
      if (parsed.access_token) return { access_token: parsed.access_token, team_member_id: parsed.team_member_id || TEAM_MEMBER_ID };
    } catch (e) {
      console.log(`[dropbox] Env var token decode failed: ${e.message}`);
    }
  }
  return null;
}

async function uploadSignedPdfToDropbox(parsed, signedPdfBuffer, signedPdfName) {
  const token = await getDropboxAccessToken();
  if (!token) {
    console.log('[dropbox] No valid token available - skipping upload.');
    return null;
  }
  try {
    const projectName = parsed.project_name || '';
    const slug = projectName
      .toLowerCase()
      .replace(/['']/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
    const dropboxPath = `/projects/_leads/${slug}/_bids_proposals_and_quotes/${signedPdfName}`;

    // For team tokens: get Rob's team member ID so we can use Dropbox-API-Select-User
    async function getTeamMemberId() {
      // 1. Check env var first (most reliable — set DROPBOX_MEMBER_ID in Railway)
      if (process.env.DROPBOX_MEMBER_ID) {
        console.log(`[dropbox] Using DROPBOX_MEMBER_ID from env: ${process.env.DROPBOX_MEMBER_ID}`);
        return process.env.DROPBOX_MEMBER_ID;
      }
      // 2. Try team/members/get_info by email
      try {
        const r = await fetch('https://api.dropboxapi.com/2/team/members/get_info', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([{ '.tag': 'email', 'email': 'rob@zinn.ai' }]),
        });
        const text = await r.text();
        console.log(`[dropbox] team/members/get_info status: ${r.status}, body: ${text.slice(0, 300)}`);
        if (r.ok) {
          const d = JSON.parse(text);
          const items = Array.isArray(d) ? d : [d];
          for (const item of items) {
            if (item && item['.tag'] === 'member_info' && item.profile && item.profile.team_member_id) {
              console.log(`[dropbox] Found member ID: ${item.profile.team_member_id}`);
              return item.profile.team_member_id;
            }
          }
          console.log(`[dropbox] get_info parsed: ${JSON.stringify(d).slice(0, 300)}`);
        }
      } catch (e) { console.log(`[dropbox] get_info failed: ${e.message}`); }
      // 3. Try team/members/list_v2 as fallback
      try {
        const r = await fetch('https://api.dropboxapi.com/2/team/members/list_v2', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 100 }),
        });
        const text = await r.text();
        console.log(`[dropbox] team/members/list status: ${r.status}, body: ${text.slice(0, 300)}`);
        if (r.ok) {
          const d = JSON.parse(text);
          const rob = (d.members || []).find(m => m.profile && m.profile.email === 'rob@zinn.ai');
          if (rob) return rob.profile.team_member_id;
        }
      } catch (e) { console.log(`[dropbox] members/list failed: ${e.message}`); }
      return null;
    }

    const memberId = await getTeamMemberId();

    // Build base headers — include Select-User so team token can act on member files
    const baseHeaders = { 'Authorization': `Bearer ${token.access_token}` };
    if (memberId) {
      baseHeaders['Dropbox-API-Select-User'] = memberId;
      console.log(`[dropbox] Acting as member: ${memberId}`);
    }

    // Discover root namespace using member-scoped call
    async function discoverRootNs() {
      try {
        const r = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
          method: 'POST',
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
          body: 'null',
        });
        if (r.ok) {
          const d = await r.json();
          if (d.root_info && d.root_info.root_namespace_id) {
            console.log(`[dropbox] Team root namespace: ${d.root_info.root_namespace_id}`);
            return d.root_info.root_namespace_id;
          }
        } else {
          console.log(`[dropbox] get_current_account failed: ${r.status}`);
        }
      } catch (e) { console.log(`[dropbox] Namespace lookup failed: ${e.message}`); }
      return null;
    }
    const rootNs = await discoverRootNs();

    const headers = {
      ...baseHeaders,
      'Dropbox-API-Arg': JSON.stringify({
        path: dropboxPath,
        mode: 'overwrite',
        autorename: false,
        mute: true,
      }),
      'Content-Type': 'application/octet-stream',
    };
    if (rootNs) {
      headers['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'namespace_id', namespace_id: rootNs });
      console.log(`[dropbox] Using team root namespace: ${rootNs}`);
    } else {
      console.log('[dropbox] No namespace found, uploading without path root header');
    }

    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers,
      body: signedPdfBuffer,
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[dropbox] Uploaded: ${dropboxPath} (${data.size} bytes)`);

      // Create a shared download link
      try {
        const linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
          method: 'POST',
          headers: {
            ...baseHeaders,
            'Content-Type': 'application/json',
            ...(rootNs ? { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: rootNs }) } : {}),
          },
          body: JSON.stringify({ path: dropboxPath, settings: { requested_visibility: { '.tag': 'public' } } }),
        });
        const linkRaw = await linkRes.text();
        console.log(`[dropbox] Shared link response (${linkRes.status}): ${linkRaw.slice(0, 300)}`);
        let linkData = {};
        try { linkData = JSON.parse(linkRaw); } catch { /* non-JSON error from Dropbox */ }
        // Handle already-exists case
        const sharedUrl = linkData.url
          || (linkData.error && linkData.error['.tag'] === 'shared_link_already_exists' && linkData.error.shared_link_already_exists && linkData.error.shared_link_already_exists.metadata && linkData.error.shared_link_already_exists.metadata.url);
        if (sharedUrl) {
          const downloadUrl = sharedUrl.replace('?dl=0', '?dl=1').replace('www.dropbox.com', 'dl.dropboxusercontent.com');
          console.log(`[dropbox] Shared link: ${downloadUrl}`);
          return downloadUrl;
        } else {
          console.log(`[dropbox] Shared link failed: ${linkRaw.slice(0, 200)}`);
        }
      } catch (linkErr) {
        console.log(`[dropbox] Shared link error: ${linkErr.message}`);
      }
    } else {
      const errText = await res.text();
      console.log(`[dropbox] Upload failed (${res.status}): ${errText.slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`[dropbox] Upload error: ${e.message}`);
  }
  return null;
}

// ─── SERVER MODE ─────────────────────────────────────────────────────────────

function startServer() {
  const express = require('express');
  const { Pool }  = require('pg');
  const app     = express();
  const portArg = args.find(a => a.startsWith('--port='));
  const PORT    = process.env.PORT || (portArg ? parseInt(portArg.split('=')[1]) : 3478);
  const proposalCache = {};
  const parsedCache   = {};

  // ─── POSTGRES SETUP ────────────────────────────────────────────────────────
  let db = null;
  if (process.env.DATABASE_URL) {
    db = new Pool({ connectionString: process.env.DATABASE_URL });
    db.query(`
      CREATE TABLE IF NOT EXISTS proposals (
        card_id          TEXT PRIMARY KEY,
        html             TEXT NOT NULL,
        accepted         BOOLEAN NOT NULL DEFAULT FALSE,
        accepted_at      TIMESTAMPTZ,
        accepted_by_name TEXT,
        accepted_by_email TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => console.log('[db] proposals table ready.'))
      .catch(e  => console.error('[db] Table init failed:', e.message));
    db.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key          TEXT PRIMARY KEY,
        value        TEXT NOT NULL,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => console.log('[db] settings table ready.'))
      .catch(e  => console.error('[db] Settings table init failed:', e.message));
    db.query(`
      CREATE TABLE IF NOT EXISTS acceptance_log (
        id           SERIAL PRIMARY KEY,
        card_id      TEXT NOT NULL,
        project_name TEXT,
        signed_by    TEXT NOT NULL,
        signed_email TEXT NOT NULL,
        signed_at    TEXT,
        pdf_name     TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => console.log('[db] acceptance_log table ready.'))
      .catch(e  => console.error('[db] acceptance_log table init failed:', e.message));
  } else {
    console.warn('[db] DATABASE_URL not set - using in-memory storage only.');
  }

  async function dbSaveProposal(cardId, html) {
    if (!db) return;
    await db.query(
      `INSERT INTO proposals (card_id, html) VALUES ($1, $2)
       ON CONFLICT (card_id) DO UPDATE SET html = $2`,
      [cardId, html]
    );
  }

  async function dbGetProposal(cardId) {
    if (!db) return null;
    const r = await db.query('SELECT html, accepted FROM proposals WHERE card_id = $1', [cardId]);
    return r.rows[0] || null;
  }

  async function dbAcceptProposal(cardId, name, email) {
    if (!db) return;
    await db.query(
      `UPDATE proposals
         SET accepted = TRUE, accepted_at = NOW(), accepted_by_name = $2, accepted_by_email = $3
       WHERE card_id = $1`,
      [cardId, name, email]
    );
    // Remove the active HTML - accepted copy kept in accepted_by_name/email/accepted_at for records
    // (keeping the row so /accepted/:cardId can still serve it)
  }

  app.use(express.json());

  app.post('/proposal', async (req, res) => {
    const id = req.body?.cardId
            || req.body?.action?.data?.card?.id
            || req.body?.model?.id;
    if (!id) return res.status(400).json({ error: 'cardId not found in request body' });

    // ─── REQUEST FILTER: Only process explicit proposal generation requests ──
    const action = req.body?.action?.type;  // Trello action type
    const explicitGenerate = req.query?.action === 'generate' || req.headers?.['x-generate-proposal'] === 'true';
    const triggerLabel = req.body?.action?.data?.card?.labels?.some(l => l.name.toLowerCase() === 'generate proposal');
    
    const shouldGenerate = explicitGenerate || triggerLabel;
    
    if (!shouldGenerate) {
      console.log(`[server] Ignoring ping for card: ${id} (no generate trigger). Action type: ${action || 'unknown'}`);
      return res.status(200).json({ status: 'ignored', cardId: id, reason: 'no generate trigger' });
    }

    console.log(`\n[server] Received GENERATE request for card: ${id}`);
    res.status(202).json({ status: 'accepted', cardId: id });
    generateProposal(id, proposalCache, parsedCache)
      .then(result => {
        if (result.success && proposalCache[id]) {
          dbSaveProposal(id, proposalCache[id]).catch(e => console.error('[db] Save failed:', e.message));
        }
      })
      .catch(e => console.error('Generate error:', e.message));
  });

  app.get('/health', (_req, res) => res.json({ ok: true, build: 'v19bea8b-memberslist' }));

  // ─── DROPBOX DEBUG ──────────────────────────────────────────────────────
  app.get('/debug/dropbox', async (req, res) => {
    try {
      const token = await getDropboxAccessToken();
      if (!token) return res.json({ error: 'No token' });
      const results = {};

      // Test 1: users/get_current_account
      const r1 = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST', headers: { 'Authorization': `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, body: 'null'
      });
      results.current_account = { status: r1.status, body: await r1.text() };

      // Test 2: team/members/get_info by email
      const r2 = await fetch('https://api.dropboxapi.com/2/team/members/get_info', {
        method: 'POST', headers: { 'Authorization': `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ '.tag': 'email', 'email': 'rob@zinn.ai' }])
      });
      results.members_get_info = { status: r2.status, body: (await r2.text()).slice(0, 500) };

      // Test 3: team/get_info
      const r3 = await fetch('https://api.dropboxapi.com/2/team/get_info', {
        method: 'POST', headers: { 'Authorization': `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, body: 'null'
      });
      results.team_info = { status: r3.status, body: (await r3.text()).slice(0, 500) };

      // Test 4: team/members/list_v2
      const r4 = await fetch('https://api.dropboxapi.com/2/team/members/list_v2', {
        method: 'POST', headers: { 'Authorization': `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 })
      });
      const r4text = await r4.text();
      results.members_list = { status: r4.status, body: r4text.slice(0, 1000) };

      res.json(results);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

// ─── RESET ACCEPTED (dev/testing) ──────────────────────────────────────
  app.post('/reset/:cardId', async (req, res) => {
    const id = req.params.cardId;
    try {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const r = await pool.query('UPDATE proposals SET accepted = FALSE WHERE card_id = $1', [id]);
      await pool.end();
      console.log(`[reset] Reset accepted for ${id}, rows=${r.rowCount}`);
      // Clear in-memory cache so next /p/ hit forces a full re-read
      delete proposalCache[id];
      // Remove filesystem accepted HTML artifact that would cause redirect
      const acceptedFile = path.join(ROOT, 'output', 'accepted', id + '.html');
      if (fs.existsSync(acceptedFile)) {
        fs.unlinkSync(acceptedFile);
        console.log(`[reset] Removed filesystem accepted HTML: ${acceptedFile}`);
      }
      res.json({ ok: true, reset: r.rowCount > 0 });
    } catch (e) {
      console.error('[reset] Failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/p/:cardId', async (req, res) => {
    const id = req.params.cardId;
    const nocache = req.query.nocache === '1';

    // Check if proposal has been accepted - redirect to read-only version
    // DB check first, then filesystem fallback
    try {
      const row = await dbGetProposal(id);
      if (row && row.accepted) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Vary', '*');
        return res.redirect(302, `/accepted/${id}`);
      }
      if (!nocache && row && row.html) {
        proposalCache[id] = row.html; // warm the in-memory cache
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(row.html);
      }
    } catch (e) {
      console.error('[db] Read failed, falling back:', e.message);
    }

    // Filesystem fallback (local dev / pre-DB)
    const acceptedPath = path.join(ROOT, 'output', 'accepted', id + '.html');
    if (fs.existsSync(acceptedPath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Vary', '*');
      return res.redirect(302, `/accepted/${id}`);
    }
    
    if (!nocache && proposalCache[id]) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(proposalCache[id]);
    }
    const htmlPath = path.join(ROOT, 'output', id + '.html');
    if (!nocache && fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, 'utf8');
      proposalCache[id] = html;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    console.log(`[server] Re-generating proposal for: ${id}`);
    try {
      const result = await generateProposal(id, proposalCache, parsedCache, { skipDraft: true });
      if (result.success && proposalCache[id]) {
        dbSaveProposal(id, proposalCache[id]).catch(e => console.error('[db] Save failed:', e.message));
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(proposalCache[id]);
      }
    } catch (e) {
      console.error('Re-generate error:', e.message);
    }
    res.status(404).send('Proposal not found.');
  });

  // ─── ACCEPTED PROPOSAL (read-only) ───────────────────────────────────────
  app.get('/accepted/:cardId', async (req, res) => {
    const id = req.params.cardId;
    const projectName = id; // fallback - not stored in this route
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Proposal - ZINN Architecture</title><style>body{margin:0;padding:80px 20px;background:#F2F6F7;font-family:'Spartan','Avenir Next',Avenir,Helvetica,Arial,sans-serif;font-weight:300;font-size:14px;color:#242C39;letter-spacing:0.5px;line-height:1.7;text-align:center;}.wrapper{max-width:500px;margin:0 auto;background:#fff;padding:60px 40px;border-radius:4px;}h1{font-size:20px;font-weight:300;letter-spacing:1px;color:#000;margin:0 0 16px 0;text-transform:lowercase;}p{color:#4e5757;margin:0;}</style></head><body><div class="wrapper"><h1>This proposal has already been accepted or has expired.</h1><p>If you believe this is an error, please reply to the email you received or contact us at <a href="mailto:info@zinn.ai" style="color:#242C39;">info@zinn.ai</a>.</p></div></body></html>`);
  });

  // ─── SIGNED PDF DOWNLOAD ────────────────────────────────────────────────
  app.get('/dl/:cardId', async (req, res) => {
    const id = req.params.cardId;
    const outputDir = path.join(ROOT, 'output');
    let signedPath = path.join(outputDir, id + '-signed.pdf');
    if (fs.existsSync(signedPath)) return res.download(signedPath);
    // Scan all signed PDFs in output directory
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir);
      const signedFiles = files.filter(f => f.endsWith('-signed.pdf'));
      if (signedFiles.length === 1) {
        return res.download(path.join(outputDir, signedFiles[0]));
      }
      if (signedFiles.length > 1) {
        // Return the most recent one by file name (date-sorted)
        signedFiles.sort().reverse();
        return res.download(path.join(outputDir, signedFiles[0]));
      }
    }
    res.status(404).send('Signed PDF not found.');
  });

  // ─── E-SIGN ENDPOINT ─────────────────────────────────────────────────────
  app.post('/sign', async (req, res) => {
    const { cardId: id, name, email, signature, signedAt, optionalChecked, tieredSelected } = req.body || {};
    if (!id || !name || !email || !signature) {
      return res.status(400).json({ error: 'Missing required fields: cardId, name, email, signature' });
    }
    console.log(`[sign] ${name} <${email}> signed card ${id} at ${signedAt}`);
    try {
      // 1. Save signature image
      const outputDir = path.join(ROOT, 'output');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const sigPath    = path.join(outputDir, `${id}-signature.png`);
      const base64Data = signature.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(sigPath, Buffer.from(base64Data, 'base64'));
      console.log(`[sign] Signature saved: ${sigPath}`);

      // 2. Trello comment
      await addCardComment(id, `Proposal accepted by ${name} (${email}) on ${signedAt}.`);

      // 3. Get parsed data from cache or re-fetch
      let parsed = parsedCache[id];
      if (!parsed) {
        try {
          const card = await getCard(id);
          parsed = parseCard(card);
          parsed.cardId = id;
          parsedCache[id] = parsed;
        } catch (e) {
          console.error('[sign] Could not re-fetch card data:', e.message);
        }
      }

      // 3b. Remove unchecked optional lines from card Fee section
      if (parsed) {
        try {
          await removeUncheckedOptionalsFromCard(id, optionalChecked, parsed);
        } catch (e) {
          console.error('[sign] Remove optionals failed:', e.message);
        }
      }

      // 4. Generate signed PDF
      let signedPdfBuffer = null;
      let signedPdfName   = null;
      let signedPdfDest   = null;

      if (parsed) {
        try {
          const signedHtml = await buildSignedHtml(parsed, name, email, sigPath, { optionalChecked, tieredSelected });
          const { dir: destDir, base: destBase, projectFolder } = resolveOutputPath(parsed);
          signedPdfName = destBase + '-signed.pdf';

          try {
            signedPdfBuffer = await renderPdf(signedHtml);
            console.log('[sign] Full PDF generated via Puppeteer.');
          } catch (pdfErr) {
            console.log('[sign] Puppeteer failed, using pdf-lib fallback:', pdfErr.message);
            try {
              signedPdfBuffer = await generateSimpleSignedPdf(parsed, name, email, sigPath, signedAt);
              console.log('[sign] pdf-lib fallback PDF generated.');
            } catch (simpleErr) {
              console.error('[sign] Fallback also failed:', simpleErr.message);
            }
          }

          // Save to project folder if found, else local output
          if (signedPdfBuffer) {
            if (projectFolder) {
              signedPdfDest = path.join(destDir, signedPdfName);
            } else {
              signedPdfDest = path.join(ROOT, 'output', signedPdfName);
            }
            fs.writeFileSync(signedPdfDest, signedPdfBuffer);
            console.log(`[sign] Signed PDF saved: ${signedPdfDest}`);
          }
        } catch (e) {
          console.error('[sign] Signed PDF generation failed:', e.message);
        }
      }

      // 5. Send emails via Gmail API
      const projectLabel = parsed ? parsed.project_name : `card ${id}`;
      const font         = `'Avenir Next', Avenir, 'Helvetica Neue', Helvetica, Arial, sans-serif`;

      // 5a. Upload signed PDF to Dropbox first — get download link for email
      let dropboxDownloadUrl = null;
      if (parsed && signedPdfBuffer && signedPdfName) {
        try {
          dropboxDownloadUrl = await uploadSignedPdfToDropbox(parsed, signedPdfBuffer, signedPdfName);
          console.log(`[dropbox] Upload complete. Link: ${dropboxDownloadUrl || 'none'}`);
        } catch (e) {
          console.error('[dropbox] Upload error:', e.message);
        }
      }

      // 5b. Email to client
      const clientFirstName = parsed ? parsed.client_first_name : name.split(' ')[0];
      const downloadLinkHtml = dropboxDownloadUrl
        ? `<p style="font-size:13px;color:#4e5757;line-height:1.8;margin:16px 0 0 0;font-family:${font};">You can download a copy of your signed proposal here: <a href="${dropboxDownloadUrl}" style="color:#242C39;font-weight:600;">Download Signed Proposal</a></p>`
        : `<p style="font-size:13px;color:#4e5757;line-height:1.8;margin:16px 0 0 0;font-family:${font};">A copy of your signed proposal will be available shortly.</p>`;
      const signEmailData = buildSignNotificationEmail({
        recipientName: clientFirstName,
        intro: `<p style="font-size:13px;color:#4e5757;line-height:1.8;margin:0 0 16px 0;font-family:${font};">Thank you for signing your proposal. We look forward to working with you and will be in touch shortly about next steps!</p>${downloadLinkHtml}`,
        projectName: projectLabel,
      });

      sendEmailDirect({
        to: email,
        cc: 'rob@zinn.ai',
        subject: `${projectLabel} - Proposal Signed`,
        htmlBody: signEmailData.html,
        logoBuffer: signEmailData.logoBuffer,
      }).then(ok => { if (ok) console.log(`[sign] Client confirmation sent to ${email}.`); })
        .catch(e  => console.error('[sign] Client notify failed:', e.message));

      // 6. Mark proposal as accepted in DB (and evict from in-memory cache)
      try {
        await dbAcceptProposal(id, name, email);
        delete proposalCache[id]; // force redirect on next /p/ hit
        console.log(`[sign] Proposal marked accepted in DB for card: ${id}`);
      } catch (e) {
        console.error('[sign] DB accept failed:', e.message);
      }

      // Filesystem archive fallback (local dev / no DB)
      try {
        const activeHtmlPath   = path.join(ROOT, 'output', id + '.html');
        const acceptedDir      = path.join(ROOT, 'output', 'accepted');
        const acceptedHtmlPath = path.join(acceptedDir, id + '.html');
        if (!fs.existsSync(acceptedDir)) fs.mkdirSync(acceptedDir, { recursive: true });
        if (fs.existsSync(activeHtmlPath)) {
          fs.renameSync(activeHtmlPath, acceptedHtmlPath);
          console.log(`[sign] Proposal archived to accepted/ (filesystem): ${acceptedHtmlPath}`);
        }
      } catch (e) {
        console.error('[sign] Filesystem archive failed (non-critical):', e.message);
      }

      // 7. Track accepted proposals for local sync (write manifest to DB)
      try {
        if (db) {
          await db.query(
            `INSERT INTO acceptance_log (card_id, project_name, signed_by, signed_email, signed_at, pdf_name)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, projectLabel, name, email, signedAt || new Date().toISOString(), signedPdfName]
          );
          console.log(`[sign] Manifest logged to DB for card: ${id}`);
        } else {
          // Filesystem fallback (no DB)
          const manifestPath = path.join(ROOT, 'output', 'accepted-manifest.json');
          let manifest = [];
          if (fs.existsSync(manifestPath)) {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          }
          manifest.push({
            cardId: id, projectName: projectLabel, signedBy: name,
            signedEmail: email, signedAt: signedAt || new Date().toISOString(), pdfName: signedPdfName,
          });
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
          console.log(`[sign] Accepted manifest updated (filesystem): ${manifest.length} total`);
        }
      } catch (e) {
        console.error('[sign] Manifest write failed:', e.message);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('[sign] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── ACCEPTED MANIFEST (for local sync) ──────────────────────────────────
  // ─── ACCEPTED MANIFEST (DB-backed) ───────────────────────────────────────
  app.get('/accepted-manifest.json', async (_req, res) => {
    if (db) {
      try {
        const r = await db.query(
          'SELECT card_id, project_name, signed_by, signed_email, signed_at, pdf_name FROM acceptance_log ORDER BY created_at DESC'
        );
        const manifest = r.rows.map(row => ({
          cardId: row.card_id,
          projectName: row.project_name,
          signedBy: row.signed_by,
          signedEmail: row.signed_email,
          signedAt: row.signed_at,
          pdfName: row.pdf_name,
        }));
        return res.json(manifest);
      } catch (e) {
        console.error('[manifest] DB read failed:', e.message);
      }
    }
    // Filesystem fallback
    const manifestPath = path.join(ROOT, 'output', 'accepted-manifest.json');
    if (!fs.existsSync(manifestPath)) return res.json([]);
    res.json(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  });

  // ─── DROPBOX OAUTH ─────────────────────────────────────────────────────
  const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
  const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;
  const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

  app.get('/auth/dropbox', (req, res) => {
    const callbackUrl = `${PUBLIC_URL}/auth/dropbox/callback`;
    const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${DROPBOX_APP_KEY}&response_type=code&token_access_type=offline&redirect_uri=${encodeURIComponent(callbackUrl)}`;
    console.log(`[dropbox-oauth] Redirecting to Dropbox auth...`);
    res.redirect(authUrl);
  });

  app.get('/auth/dropbox/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) {
      console.error(`[dropbox-oauth] Auth error: ${error}`);
      return res.status(400).send(`Dropbox auth error: ${error}`);
    }
    if (!code) return res.status(400).send('Missing auth code.');

    const callbackUrl = `${PUBLIC_URL}/auth/dropbox/callback`;
    try {
      const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: DROPBOX_APP_KEY,
          client_secret: DROPBOX_APP_SECRET,
          redirect_uri: callbackUrl,
        }).toString(),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        console.error(`[dropbox-oauth] Token exchange failed:`, tokenData);
        return res.status(400).send(`Token exchange failed: ${tokenData.error_description || tokenData.error}`);
      }

      const { access_token, refresh_token, expires_in } = tokenData;
      console.log(`[dropbox-oauth] Got refresh_token: ${refresh_token ? 'YES' : 'NO'}, access_token expires in ${expires_in}s`);

      if (refresh_token) {
        // Store refresh token in DB
        try {
          const { Pool } = require('pg');
          const pool = new Pool({ connectionString: process.env.DATABASE_URL });
          await pool.query(
            `INSERT INTO settings (key, value) VALUES ('dropbox_refresh_token', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [refresh_token]
          );
          await pool.end();
          console.log(`[dropbox-oauth] Refresh token stored in DB.`);
        } catch (e) {
          console.error(`[dropbox-oauth] Failed to store refresh token: ${e.message}`);
        }
      }

      // Also store the current access token in env for immediate use
      // (next sign handler will use refresh flow if this expires)
      try {
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        const tokenPayload = JSON.stringify({
          access_token,
          team_member_id: 'dbmid:AACzXf9UnyCFRGycr_Bw_pe1imOGaH5zEP8',
          expires_at: Date.now() + (expires_in * 1000),
        });
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ('dropbox_token_payload', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
          [tokenPayload]
        );
        await pool.end();
      } catch (e) {
        console.error(`[dropbox-oauth] Failed to store token payload: ${e.message}`);
      }

      res.send(`<h2>Dropbox authorized!</h2><p>Refresh token stored. You can close this window.</p>`);
    } catch (e) {
      console.error(`[dropbox-oauth] Error: ${e.message}`);
      res.status(500).send(`Dropbox auth error: ${e.message}`);
    }
  });

  const host = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
  app.listen(PORT, host, () => {
    console.log(`\nProposal server listening on http://${host}:${PORT}/proposal`);
    console.log('POST { "cardId": "<id>" } to trigger a proposal.\n');
  });
}

// ─── ENTRY ────────────────────────────────────────────────────────────────────

if (SERVER_MODE) {
  // Intercept process.exit(0) calls from Chrome subprocess on macOS
  const _origExit = process.exit.bind(process);
  process.exit = (code) => {
    if (code === 0) {
      console.warn('[server] process.exit(0) intercepted (Chrome subprocess) - ignoring');
      return;
    }
    _origExit(code);
  };
  startServer();
} else {
  generateProposal(cardId).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * parse-lead-server.js — AI lead data parsing for ZINN Architecture
 *
 * Runs alongside the OpenClaw gateway on Railway Howard.
 * Accepts raw card descriptions, calls DeepSeek to extract
 * structured ZINN sections, returns the result for PA to write back.
 *
 * POST /parse-lead
 *   Body: { desc: string, sections: string[] }
 *   Response: { sections: { [sectionName]: string }, error?: string }
 *
 * POST /health
 *   Response: { status: 'ok' }
 */

const https = require('https');
const http = require('http');

const PORT = parseInt(process.env.PARSE_LEAD_PORT || '8082', 10);
const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
const MODEL = process.env.PARSE_MODEL || 'deepseek/deepseek-v4-flash';

const SYSTEM_PROMPT = `You are the ZINN Architecture lead data parser. Your job is to extract structured information from disorganized lead intake messages (emails, voicemail transcriptions, web forms, etc.) and format them into ZINN standard Trello card sections.

Rules:
- Extract whatever data is present. Empty sections are fine.
- Client section: name, email, phone number if present.
- Project Address: if no specific address, note the area/neighborhood mentioned.
- General Notes: any misc details, how they found ZINN, timeline, etc.
- Keep text concise but complete. Don't summarize or drop details.
- Output ONLY valid JSON with section names as keys. No markdown, no explanations.

Example output:
{
  "General Notes": "estimate fees... found us via Google search",
  "Project Address": "Marsh Landing, Jacksonville FL",
  "Client": "Jason Mabry\\njason@optimumhit.com\\n904-982-2828",
  "Budget": "",
  "Scope": "remodel of existing house",
  "Fee": "",
  "Area": "",
  "Phases": "Pre Design\\nSchematic Design\\nDesign Development\\nConstruction Documents\\nConstruction Administration\\nAdditional Services\\nFurnishings and Decor",
  "Billing Type": "Fixed fee",
  "Proposal Length": "medium"
}`;

// ─── AI Call ──────────────────────────────────────────────────────────────

function callAI(desc, sections) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'Parse this lead message into ZINN sections:\n\n' + desc }
      ],
      temperature: 0.1,
      max_tokens: 4000,
    });

    const u = new URL('https://api.deepseek.com/chat/completions');
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('AI API returned ' + res.statusCode + ': ' + data.slice(0, 300)));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
          if (!content) {
            reject(new Error('Empty AI response'));
            return;
          }
          // Try to extract JSON from response (might have markdown wrapping)
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            reject(new Error('No JSON in AI response: ' + content.slice(0, 200)));
          }
        } catch (e) {
          reject(new Error('Parse failed: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── HTTP Server ──────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'parse-lead-server' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/parse-lead') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', async () => {
      try {
        const input = JSON.parse(body);
        if (!input.desc) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'desc field required' }));
          return;
        }

        const sectionList = input.sections || [
          'General Notes', 'Project Address', 'Client',
          'Budget', 'Scope', 'Fee', 'Area',
          'Phases', 'Billing Type', 'Proposal Length'
        ];

        console.log('[parse-lead] Processing... ' + input.desc.slice(0, 100));

        const sections = await callAI(input.desc, sectionList);

        // Fill in any missing sections as empty
        const result = { sections: {} };
        for (const s of sectionList) {
          result.sections[s] = sections[s] || '';
        }

        console.log('[parse-lead] Done. Sections:', Object.keys(result.sections).length);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error('[parse-lead] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[parse-lead-server] Listening on port ' + PORT);
});

#!/usr/bin/env node
'use strict';
// Standalone PDF worker — runs puppeteer in isolation so Chrome's exit()
// never kills the parent server process.
// Input:  { html, options } via stdin (JSON)
// Output: base64-encoded PDF bytes on stdout, then exits

const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

// Find Chrome: check env var, use Puppeteer's installed Chrome, then fall back to system paths
function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // Prefer Puppeteer's own installed Chrome (most reliable on Railway after `npx puppeteer browsers install chrome`)
  try {
    const execPath = puppeteer.executablePath();
    if (execPath && require('fs').existsSync(execPath)) {
      return execPath;
    }
  } catch { /* not available */ }
  // Try common system-installed paths
  try {
    const paths = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
    for (const p of paths) {
      try {
        const out = execSync(`which ${p} 2>/dev/null`, { encoding: 'utf8', timeout: 2000 }).trim();
        if (out) return out;
      } catch { /* try next */ }
    }
  } catch { /* exec not available */ }
  return undefined;
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;

  const { html, options } = JSON.parse(input);

  const launchOpts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  const chromePath = findChrome();
  if (chromePath) {
    launchOpts.executablePath = chromePath;
    console.error(`[pdf] Using Chrome at: ${chromePath}`);
  }

  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    // Allow Google Fonts for proper PDF rendering
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = req.url();
      if (url.includes('analytics') || url.includes('facebook')) {
        req.abort();
      } else {
        req.continue();
      }
    });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    // Brief settle before printing (avoids Protocol error: Printing failed)
    await new Promise(r => setTimeout(r, 500));
    const buf = await page.pdf(options);
    process.stdout.write(Buffer.from(buf).toString('base64'));
  } finally {
    await browser.close();
  }
}

main().catch(e => {
  process.stderr.write('pdf-worker error: ' + e.message + '\n');
  process.exitCode = 1;
});

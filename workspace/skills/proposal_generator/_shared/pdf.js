// =============================================================================
// pdf.js — Shared Puppeteer/PDF module for ZINN Railway services
// Provides Chrome lifecycle management and standard PDF rendering options.
// =============================================================================
'use strict';

/**
 * Get Puppeteer launch options with automatic Chrome path resolution.
 * Works on Railway (where Chrome is installed via Puppeteer postinstall)
 * and locally on macOS.
 * @returns {object} Puppeteer launchOpts object
 */
function getLaunchOptions() {
  const opts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  };

  // 1. Explicit path from env var
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    opts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    return opts;
  }

  // 2. Try puppeteer's installed browser
  try {
    const puppeteer = require('puppeteer');
    const execPath = puppeteer.executablePath();
    if (execPath && require('fs').existsSync(execPath)) {
      opts.executablePath = execPath;
      return opts;
    }
  } catch { /* fall through */ }

  // 3. Try system-installed Chrome/Chromium
  try {
    const { execSync } = require('child_process');
    const paths = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
    for (const p of paths) {
      try {
        const out = execSync(`which ${p} 2>/dev/null`, { encoding: 'utf8', timeout: 2000 }).trim();
        if (out) {
          opts.executablePath = out;
          return opts;
        }
      } catch { /* try next */ }
    }
  } catch { /* exec not available */ }

  // No custom path — let Puppeteer find it (may fail on some systems)
  console.warn('[shared/pdf] No Chrome path found — letting Puppeteer auto-detect');
  return opts;
}

/**
 * Standard PDF options for ZINN proposals.
 * @param {object} [overrides] - Override any option
 * @returns {object} PDF options for Puppeteer page.pdf()
 */
function getPdfOptions(overrides = {}) {
  return {
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: false,
    margin: {
      top: '0.75in',
      bottom: '0.75in',
      left: '0.75in',
      right: '0.75in',
    },
    displayHeaderFooter: false,
    ...overrides,
  };
}

/**
 * Launch Puppeteer, render HTML to PDF, and return the buffer.
 * Handles full lifecycle: launch → page → setContent → pdf → close.
 *
 * @param {string} html - Full HTML document string
 * @param {object} [pdfOpts] - Options for page.pdf() (see getPdfOptions)
 * @param {object} [launchOpts] - Override launch options
 * @returns {Promise<Buffer>} PDF bytes
 */
async function renderPdf(html, pdfOpts = {}, launchOpts = {}) {
  const puppeteer = require('puppeteer');
  const options = { ...getPdfOptions(), ...pdfOpts };
  const launch = { ...getLaunchOptions(), ...launchOpts };

  const browser = await puppeteer.launch(launch);
  try {
    const page = await browser.newPage();

    // Block tracking/analytics requests
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = req.url();
      if (url.includes('analytics') || url.includes('facebook') || url.includes('doubleclick')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });

    // Brief settle delay — prevents "Printing failed" protocol errors
    await new Promise(r => setTimeout(r, 500));

    const buf = await page.pdf(options);
    console.log(`[shared/pdf] Generated PDF: ${(buf.length / 1024).toFixed(1)} KB`);
    return buf;
  } finally {
    await browser.close();
  }
}

module.exports = {
  getLaunchOptions,
  getPdfOptions,
  renderPdf,
};

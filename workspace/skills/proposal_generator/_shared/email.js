// =============================================================================
// email.js — Shared Gmail send module for ZINN Railway services
// Handles Gmail API authentication, branded HTML email sending, and drafts.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { GMAIL_CREDS_PATH, GMAIL_TOKEN_PATH, LOCAL_DROPBOX_ROOT } = require('./config');

// ─── Auth ─────────────────────────────────────────────────────────────────

let cachedGmailClient = null;

/**
 * Get an authenticated Gmail API client.
 * Works both locally (file-based credentials) and on Railway (env vars).
 * @returns {Promise<object|null>} Gmail API client or null
 */
async function getGmailClient() {
  if (cachedGmailClient) return cachedGmailClient;

  // Railway mode: credentials may be in env vars as JSON strings
  let credentials, token;

  if (process.env.GMAIL_CREDENTIALS_JSON) {
    try { credentials = JSON.parse(process.env.GMAIL_CREDENTIALS_JSON); } catch { credentials = null; }
  }
  if (process.env.GMAIL_TOKEN_JSON) {
    try { token = JSON.parse(process.env.GMAIL_TOKEN_JSON); } catch { token = null; }
  }

  // Local mode: file-based
  if (!credentials && fs.existsSync(GMAIL_CREDS_PATH)) {
    credentials = JSON.parse(fs.readFileSync(GMAIL_CREDS_PATH, 'utf8'));
  }
  if (!token && fs.existsSync(GMAIL_TOKEN_PATH)) {
    token = JSON.parse(fs.readFileSync(GMAIL_TOKEN_PATH, 'utf8'));
  }

  if (!credentials || !token) {
    console.log('[shared/email] Gmail credentials not found — emails will be skipped');
    return null;
  }

  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web || credentials;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0] || 'http://localhost');
  oAuth2Client.setCredentials(token);

  // Auto-refresh if needed
  oAuth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      console.log('[shared/email] Gmail token auto-refreshed');
      // In Railway mode, the tokens env var should be updated externally
    }
  });

  cachedGmailClient = google.gmail({ version: 'v1', auth: oAuth2Client });
  return cachedGmailClient;
}

// ─── Email Building ───────────────────────────────────────────────────────

const FONT = "'Avenir Next', Avenir, 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * Encode a subject line, stripping problematic characters.
 */
function encodeSubject(str) {
  return str.replace(/—/g, '-').replace(/–/g, '-').replace(/"/g, '').replace(/'/g, '');
}

/**
 * Build the ZINN header logo CID tag for Gmail inline embedding.
 * @param {object} [logoBuffer] - Buffer of the logo image, or null to read from disk
 * @returns {{html: string, buffer: Buffer|null}}
 */
function buildHeaderLogoTag(logoBuffer) {
  if (!logoBuffer) {
    const logoPath = path.join(LOCAL_DROPBOX_ROOT, 'marketing/branding/logos/_logo-email.png');
    try { logoBuffer = fs.readFileSync(logoPath); } catch { logoBuffer = null; }
  }

  return {
    html: logoBuffer
      ? `<img src="cid:zinn-logo" alt="ZINN Architecture" width="120" style="display:block;margin:0 0 24px 0;">`
      : '',
    buffer: logoBuffer,
  };
}

/**
 * Build a branded ZINN email body as an HTML string.
 * @param {string} contentHtml - The email's inner content (no wrapper)
 * @param {object} [opts]
 * @param {string} [opts.font=FONT]
 * @returns {string} Full HTML email body
 */
function buildEmailBody(contentHtml, opts = {}) {
  const font = opts.font || FONT;
  const bgColor = '#f0f0f0';
  const panelColor = '#ffffff';
  const textColor = '#242C39';

  return `
    <div style="background:${bgColor};padding:40px 20px;font-family:${font};">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;">
        <tr><td style="background:${panelColor};padding:32px 40px;border-radius:4px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td style="padding:0 0 24px 0;">
              <p style="font-family:${font};font-size:14px;color:${textColor};line-height:1.8;margin:0;">${contentHtml}</p>
            </td></tr>
            <tr><td style="border-top:1px solid #000;padding:20px 0 0 0;">
              <p style="font-family:${font};font-size:11px;color:#6b6b6b;line-height:1.6;margin:0 0 12px 0;">
                <strong style="color:#333;">ZINN Architecture, LLC</strong><br>
                3716 Spanish Street, Jacksonville, FL 32205<br>
                <a href="https://zinn.ai" style="color:${textColor};">zinn.ai</a>
              </p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </div>
  `;
}

// ─── Send / Draft ─────────────────────────────────────────────────────────

/**
 * Create a base64-encoded RFC 2822 email message for the Gmail API.
 * @param {object} opts
 * @param {string|string[]} opts.to - Recipient email(s)
 * @param {string} [opts.cc] - CC recipient
 * @param {string} opts.subject - Email subject
 * @param {string} opts.htmlBody - HTML body content
 * @param {Buffer} [opts.logoBuffer] - Logo image for CID embedding
 * @param {Buffer} [opts.pdfBuffer] - PDF attachment
 * @param {string} [opts.pdfName] - Attachment filename
 * @returns {string} Base64url-encoded message
 */
function createMessage(opts) {
  const to = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to;
  const boundary = `zinn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lines = [];

  // Headers
  lines.push(`To: ${to}`);
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Subject: ${encodeSubject(opts.subject)}`);
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');

  // Multipart body
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: quoted-printable');
  lines.push('');

  // Replace CID placeholder with actual CID inline if logo exists
  let bodyHtml = opts.htmlBody;
  if (opts.logoBuffer) {
    bodyHtml = bodyHtml.replace('cid:zinn-logo', 'cid:zinn-logo');
  }
  lines.push(bodyHtml.replace(/\n/g, ''));
  lines.push('');

  // Logo attachment (CID inline)
  if (opts.logoBuffer) {
    lines.push(`--${boundary}`);
    lines.push('Content-Type: image/png; name="zinn-logo.png"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('Content-ID: <zinn-logo>');
    lines.push('Content-Disposition: inline; filename="zinn-logo.png"');
    lines.push('');
    lines.push(opts.logoBuffer.toString('base64'));
    lines.push('');
  }

  // PDF attachment
  if (opts.pdfBuffer && opts.pdfName) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: application/pdf; name="${opts.pdfName}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-Disposition: attachment; filename="${opts.pdfName}"`);
    lines.push('');
    lines.push(opts.pdfBuffer.toString('base64'));
    lines.push('');
  }

  lines.push(`--${boundary}--`);

  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64url');
}

/**
 * Send an email via Gmail API.
 * @param {object} opts - See createMessage() for fields
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendEmail(opts) {
  const gmail = await getGmailClient();
  if (!gmail) {
    console.log('[shared/email] Cannot send — no Gmail client');
    return false;
  }

  try {
    const raw = createMessage(opts);
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    console.log(`[shared/email] Sent to: ${opts.to}`);
    return true;
  } catch (e) {
    console.error(`[shared/email] Send failed: ${e.message}`);
    return false;
  }
}

/**
 * Create a Gmail draft (not sent).
 * @param {object} opts - See createMessage() for fields
 * @returns {Promise<boolean>} True if draft created
 */
async function createDraft(opts) {
  const gmail = await getGmailClient();
  if (!gmail) {
    console.log('[shared/email] Cannot create draft — no Gmail client');
    return false;
  }

  try {
    const raw = createMessage(opts);
    await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
    console.log(`[shared/email] Draft created for: ${opts.to}`);
    return true;
  } catch (e) {
    console.error(`[shared/email] Draft creation failed: ${e.message}`);
    return false;
  }
}

/**
 * Send a failure notification email to Rob.
 * Creates a branded draft with service name, card context, and error details.
 * Subject follows standard format: "{projectName} - Error" or "{service} - Error".
 * Non-blocking — logs errors but never throws.
 *
 * @param {object} opts
 * @param {string} opts.service - Short service name (e.g., 'account_setup', 'labels')
 * @param {string} opts.error - Error message or description
 * @param {string} [opts.cardName] - Trello card name if applicable (used as project name)
 * @param {string} [opts.cardId] - Trello card ID if applicable
 * @param {boolean} [opts.send=false] - If true, sends immediately. Defaults to draft.
 */
async function notifyOnFailure(opts) {
  const projectLabel = opts.cardName || opts.service;
  const subject = `${projectLabel} - Error`;

  const cardLink = opts.cardId
    ? `<a href="https://trello.com/c/${opts.cardId}">${opts.cardName || opts.cardId}</a>`
    : opts.cardName || '';

  const contentHtml = `
    <p><strong>${opts.service}</strong> encountered an error.</p>
    ${cardLink ? `<p>Card: ${cardLink}</p>` : ''}
    <p>Error: ${opts.error.replace(/\n/g, '<br>')}</p>
    <p style="color:#999;font-size:11px;">This notification was auto-generated.</p>`;

  const htmlBody = buildEmailBody(contentHtml);

  try {
    if (opts.send) {
      await sendEmail({ to: 'rob@zinn.ai', subject, htmlBody });
    } else {
      await createDraft({ to: 'rob@zinn.ai', subject, htmlBody });
    }
    return true;
  } catch (e) {
    console.error(`[shared/email] notifyOnFailure failed: ${e.message}`);
    return false;
  }
}

module.exports = {
  getGmailClient,
  buildEmailBody,
  buildHeaderLogoTag,
  createMessage,
  sendEmail,
  createDraft,
  notifyOnFailure,
};

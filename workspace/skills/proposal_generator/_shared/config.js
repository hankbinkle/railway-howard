// =============================================================================
// config.js — ZINN shared configuration constants
// Source of truth for board IDs, API keys, and path templates used across
// all Railway services (proposal_generator, account_setup, project_automator).
// =============================================================================
'use strict';

const path = require('path');

module.exports = {
  // ── Trello ──────────────────────────────────────────────────────────────
  TRELLO_KEY: process.env.TRELLO_KEY || '4a2c915a7c7943bee91cd872c9b1df0f',
  TRELLO_TOKEN: process.env.TRELLO_TOKEN || '',

  // Board IDs
  BOARDS: {
    LEADS: '5f853408b0549433b0806f3b',
    PROJECTS: '5f84a9ea3e629c7eb4b2be27',
    INTERNAL: '5f853a4c308d5a15bfdb4de0',
    TEMPLATES: '66f2e19a4dd7012acc370148', // ZINN Project Template (ZPT2)
    KEYNOTES: '69f927cfac3847401e5ca448',
  },

  // Trello list IDs
  TRELLO_LISTS: {
    PROPOSAL: '5f85362113cc34644ddc55db',
    PROPOSAL_FOLLOWUP: '5f853602cf843353ee8251e5',
  },

  // ── Dropbox ──────────────────────────────────────────────────────────────
  DROPBOX_APP_KEY: 'xeymvxnprji8mnj',
  DROPBOX_APP_SECRET: process.env.DROPBOX_APP_SECRET || '',
  DROPBOX_TEAM_MEMBER_EMAIL: 'rob@zinn.ai',

  // Dropbox folder paths (relative to team root namespace)
  DROPBOX_PATHS: {
    LEADS_TEMPLATE: '/projects/_new_project',
    LEADS_FOLDER: '/projects/_leads',
    PROJECTS_FOLDER: '/projects',
    DEAD_LEADS: '/projects/_leads/_dead_leads',
    ARCHIVED_PROJECTS: '/projects/_archived',
    MARKETING: '/marketing',
    BRANDING: '/marketing/branding',
  },

  // ── Gmail ────────────────────────────────────────────────────────────────
  GMAIL_CREDS_PATH: process.env.GMAIL_CREDS_PATH ||
    path.join(process.env.HOME || '/root', '.openclaw/credentials/gmail-zinn-credentials.json'),
  GMAIL_TOKEN_PATH: process.env.GMAIL_TOKEN_PATH ||
    path.join(process.env.HOME || '/root', '.openclaw/credentials/gmail-zinn-token.json'),

  // ── Harvest ──────────────────────────────────────────────────────────────
  HARVEST_ACCOUNT_ID: process.env.HARVEST_ACCOUNT_ID || '1306713',
  HARVEST_TOKEN: process.env.HARVEST_TOKEN || '',

  // ── Local paths (for local dev/testing) ──────────────────────────────────
  LOCAL_DROPBOX_ROOT: process.env.LOCAL_DROPBOX_ROOT ||
    (process.env.HOME ? path.join(process.env.HOME, 'ZINN Dropbox') : '/Users/robzinn/ZINN Dropbox'),
};

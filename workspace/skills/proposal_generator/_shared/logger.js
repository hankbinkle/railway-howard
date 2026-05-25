// =============================================================================
// logger.js — Standardized logging for ZINN Railway services
// Provides timestamped, prefixed logging with consistent severity levels.
// =============================================================================
'use strict';

/**
 * Get an ISO-style timestamp without milliseconds.
 */
function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Create a namespaced logger for a service/module.
 *
 * @param {string} namespace - Short identifier (e.g., 'setup', 'proposal', 'labels')
 * @returns {object} Logger with .info(), .warn(), .error() methods
 *
 * @example
 *   const log = logger('setup');
 *   log.info('Starting account setup for card %s', cardId);
 *   log.error('Dropbox upload failed: %s', err.message);
 */
function create(namespace) {
  function format(level, msg, ...args) {
    let formatted = msg;
    if (args.length > 0) {
      let i = 0;
      formatted = msg.replace(/%[sd]/g, () => args[i++]);
    }
    return `[${timestamp()}] [${namespace}] [${level}] ${formatted}`;
  }

  return {
    info: (msg, ...args) => console.log(format('info', msg, ...args)),
    warn: (msg, ...args) => console.warn(format('warn', msg, ...args)),
    error: (msg, ...args) => console.error(format('error', msg, ...args)),
    debug: (msg, ...args) => {
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(format('debug', msg, ...args));
      }
    },
  };
}

module.exports = { create };

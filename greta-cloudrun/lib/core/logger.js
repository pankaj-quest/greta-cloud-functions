/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LOGGER
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Centralized logging utility with consistent formatting and emoji prefixes.
 * Provides structured logging for different contexts (services, API, etc.)
 * 
 * @module core/logger
 */


/* ─────────────────────────────────────────────────────────────────────────────
 * EMOJI PREFIXES
 * ───────────────────────────────────────────────────────────────────────────── */

const EMOJI = {
  // Status
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  
  // Services
  vite: '🚀',
  python: '🐍',
  mongo: '🍃',
  gcs: '☁️',
  
  // Actions
  start: '▶️',
  stop: '⏹️',
  restart: '🔄',
  upload: '📤',
  download: '📥',
  backup: '💾',
  
  // Files
  file: '📄',
  folder: '📁',
  package: '📦',
  
  // Other
  clock: '⏰',
  lock: '🔒',
  screenshot: '📸',
  search: '🔍',
  terminal: '🖥️',
  blocked: '🚫',
};


/* ─────────────────────────────────────────────────────────────────────────────
 * LOGGER CLASS
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Create a namespaced logger instance
 * 
 * @param {string} namespace - Logger namespace (e.g., 'Vite', 'Backend', 'GCS')
 * @returns {Object} Logger instance with info, error, warn, success methods
 * 
 * @example
 * const log = createLogger('Vite');
 * log.info('Server started');     // [Vite] Server started
 * log.success('Build complete');  // [Vite] ✅ Build complete
 * log.error('Build failed');      // [Vite Error] ❌ Build failed
 */
export function createLogger(namespace) {
  const prefix = `[${namespace}]`;
  const errorPrefix = `[${namespace} Error]`;

  return {
    /**
     * Log info message
     */
    info: (message, ...args) => {
      console.log(`${prefix} ${message}`, ...args);
    },

    /**
     * Log error message
     */
    error: (message, ...args) => {
      console.error(`${errorPrefix} ${EMOJI.error} ${message}`, ...args);
    },

    /**
     * Log warning message
     */
    warn: (message, ...args) => {
      console.warn(`${prefix} ${EMOJI.warning} ${message}`, ...args);
    },

    /**
     * Log success message
     */
    success: (message, ...args) => {
      console.log(`${prefix} ${EMOJI.success} ${message}`, ...args);
    },

    /**
     * Log with custom emoji prefix
     */
    emoji: (emoji, message, ...args) => {
      const icon = EMOJI[emoji] || emoji;
      console.log(`${prefix} ${icon} ${message}`, ...args);
    },
  };
}


/* ─────────────────────────────────────────────────────────────────────────────
 * PRE-CONFIGURED LOGGERS
 * ───────────────────────────────────────────────────────────────────────────── */

/** Vite dev server logger */
export const viteLogger = createLogger('Vite');

/** Python backend logger */
export const backendLogger = createLogger('Backend');

/** MongoDB logger */
export const mongoLogger = createLogger('MongoDB');

/** GCS storage logger */
export const gcsLogger = createLogger('GCS');

/** File API logger */
export const fileLogger = createLogger('File API');

/** Chat API logger */
export const chatLogger = createLogger('Chat API');

/** Screenshot logger */
export const screenshotLogger = createLogger('Screenshot');

/** Proxy logger */
export const proxyLogger = createLogger('Proxy');

/** Server logger */
export const serverLogger = createLogger('Server');


/* ─────────────────────────────────────────────────────────────────────────────
 * EXPORTS
 * ───────────────────────────────────────────────────────────────────────────── */

export { EMOJI };


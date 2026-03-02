/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CORE MODULE EXPORTS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Central export point for all core utilities.
 * 
 * @module core
 */

// Configuration
export * from './config.js';

// State Management
export {
  state,
  logs,
  addLog,
  clearLogs,
  getProcessStatus,
  getRecentLogs,
} from './state.js';

// Logging
export {
  createLogger,
  EMOJI,
  viteLogger,
  backendLogger,
  mongoLogger,
  gcsLogger,
  fileLogger,
  chatLogger,
  screenshotLogger,
  proxyLogger,
  serverLogger,
} from './logger.js';


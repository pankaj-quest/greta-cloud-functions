/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * APPLICATION STATE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Centralized state management for process references and log buffers.
 * This module maintains runtime state that needs to be shared across modules.
 * 
 * @module core/state
 */

import { MAX_LOGS } from './config.js';


/* ─────────────────────────────────────────────────────────────────────────────
 * PROCESS STATE
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Global process references for managed services
 * 
 * @type {Object}
 * @property {ChildProcess|null} viteProcess - Vite dev server process
 * @property {ChildProcess|null} backendProcess - Python FastAPI process
 * @property {ChildProcess|null} mongoProcess - MongoDB process
 * @property {number} lastKeepAlive - Timestamp of last keepAlive ping
 */
export const state = {
  viteProcess: null,
  backendProcess: null,
  mongoProcess: null,
  lastKeepAlive: Date.now(),
};


/* ─────────────────────────────────────────────────────────────────────────────
 * LOG BUFFERS
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * In-memory log buffers for process output
 * Each buffer maintains a rolling window of MAX_LOGS entries
 * 
 * @type {Object}
 * @property {Array<LogEntry>} vite - Vite stdout logs
 * @property {Array<LogEntry>} viteErrors - Vite stderr logs
 * @property {Array<LogEntry>} backend - Backend stdout logs
 * @property {Array<LogEntry>} backendErrors - Backend stderr logs
 */
export const logs = {
  vite: [],
  viteErrors: [],
  backend: [],
  backendErrors: [],
};

/**
 * @typedef {Object} LogEntry
 * @property {string} type - Log type (vite, viteErrors, backend, backendErrors)
 * @property {string} message - Log message content
 * @property {number} timestamp - Unix timestamp when log was captured
 */


/* ─────────────────────────────────────────────────────────────────────────────
 * LOG OPERATIONS
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Add a log entry to the specified buffer
 * Automatically trims buffer to MAX_LOGS entries
 * 
 * @param {keyof logs} type - Log buffer type
 * @param {string} message - Log message to add
 * 
 * @example
 * addLog('vite', 'Server started on port 5173');
 * addLog('backendErrors', 'ImportError: No module named requests');
 */
export function addLog(type, message) {
  const buffer = logs[type];
  
  if (!buffer) {
    console.warn(`[State] Unknown log type: ${type}`);
    return;
  }

  buffer.push({
    type,
    message,
    timestamp: Date.now(),
  });

  // Trim to max size (FIFO)
  if (buffer.length > MAX_LOGS) {
    buffer.shift();
  }
}

/**
 * Clear log buffers
 * 
 * @param {'all' | 'vite' | 'backend'} type - Which buffers to clear
 * 
 * @example
 * clearLogs('vite');    // Clear only Vite logs
 * clearLogs('backend'); // Clear only backend logs  
 * clearLogs('all');     // Clear all logs
 */
export function clearLogs(type = 'all') {
  if (type === 'all' || type === 'vite') {
    logs.vite = [];
    logs.viteErrors = [];
  }
  
  if (type === 'all' || type === 'backend') {
    logs.backend = [];
    logs.backendErrors = [];
  }
}

/**
 * Get process status summary
 * 
 * @returns {Object} Status object with boolean flags for each process
 */
export function getProcessStatus() {
  return {
    viteRunning: state.viteProcess !== null,
    backendRunning: state.backendProcess !== null,
    mongoRunning: state.mongoProcess !== null,
  };
}

/**
 * Get recent logs for a service
 * 
 * @param {'backend' | 'vite' | 'frontend'} type - Service type
 * @param {number} count - Maximum entries to return
 * @returns {Object} Object with logs and errors arrays
 */
export function getRecentLogs(type, count = 20) {
  if (type === 'backend') {
    return {
      logs: logs.backend.slice(-count),
      errors: logs.backendErrors.slice(-count),
    };
  }
  
  if (type === 'frontend' || type === 'vite') {
    return {
      logs: logs.vite.slice(-count),
      errors: logs.viteErrors.slice(-count),
    };
  }

  return { logs: [], errors: [] };
}


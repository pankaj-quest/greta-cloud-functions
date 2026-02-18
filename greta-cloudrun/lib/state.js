/**
 * Shared State - Process references and logs
 */
import { MAX_LOGS } from './config.js';

// Process references
export const state = {
  viteProcess: null,
  backendProcess: null,
  mongoProcess: null,
  lastKeepAlive: Date.now()
};

// Console logs capture
export const logs = {
  vite: [],
  viteErrors: [],
  backend: [],
  backendErrors: []
};

// Add log with max limit
export function addLog(type, message) {
  const logArray = logs[type];
  if (logArray) {
    logArray.push({ type, message, timestamp: Date.now() });
    if (logArray.length > MAX_LOGS) logArray.shift();
  }
}

// Clear logs
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


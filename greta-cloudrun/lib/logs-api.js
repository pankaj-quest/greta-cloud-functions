/**
 * Console Logs API - Get/Clear Vite and Backend logs
 */
import express from 'express';
import { logs, clearLogs } from './state.js';

const router = express.Router();

// Get Console Logs
router.get('/console-logs', (req, res) => {
  const { type = 'all', clear = false } = req.query;

  let logList;
  if (type === 'errors') {
    logList = logs.viteErrors;
  } else if (type === 'stdout') {
    logList = logs.vite;
  } else {
    logList = [...logs.vite, ...logs.viteErrors].sort((a, b) => a.timestamp - b.timestamp);
  }

  const hasErrors = logs.viteErrors.length > 0;

  // Optionally clear logs after reading
  if (clear === 'true') {
    if (type === 'errors' || type === 'all') clearLogs('vite');
    if (type === 'stdout' || type === 'all') clearLogs('vite');
  }

  res.json({
    success: true,
    hasErrors,
    errorCount: logs.viteErrors.length,
    logs: logList.map(l => l.message),
    rawLogs: logList
  });
});

// Clear Console Logs
router.post('/clear-logs', (req, res) => {
  clearLogs('all');
  res.json({ success: true, message: 'Logs cleared' });
});

// Get Backend Logs (Python/FastAPI errors)
router.get('/backend-logs', (req, res) => {
  const { clear = false, limit = 50 } = req.query;
  const limitNum = parseInt(limit) || 50;

  // Get backend logs and errors
  const allLogs = logs.backend.slice(-limitNum);
  const errorLogs = logs.backendErrors.slice(-limitNum);

  // Combine and sort by timestamp
  const combined = [...allLogs, ...errorLogs].sort((a, b) => a.timestamp - b.timestamp);

  const hasErrors = errorLogs.length > 0;

  // Optionally clear logs after reading
  if (clear === 'true') {
    clearLogs('backend');
  }

  res.json({
    success: true,
    hasErrors,
    errorCount: errorLogs.length,
    logs: combined.map(l => l.message),
    errors: errorLogs.map(l => l.message),
    rawLogs: combined
  });
});

export default router;


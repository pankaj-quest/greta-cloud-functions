/**
 * Greta Cloud Run Server
 * - Express API for file operations and keepAlive
 * - Proxies to Vite dev server for HMR
 * - Proxies /api/* to Python FastAPI backend
 * - Syncs with Google Cloud Storage
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs-extra';
import path from 'path';

// Import configuration and modules
import {
  PORT, PROJECT_DIR, FRONTEND_DIR, BACKEND_DIR,
  FRONTEND_TEMPLATE_DIR, BACKEND_TEMPLATE_DIR, FRONTEND_NODE_MODULES,
  projectId, FILE_SYNC_INTERVAL, MONGO_BACKUP_INTERVAL,
  EXPRESS_API_ENDPOINTS
} from './lib/config.js';
import { state } from './lib/state.js';
import { syncFromGCS, syncToGCS } from './lib/gcs-sync.js';
import { startMongo, restoreMongoFromGCS, backupMongoToGCS } from './lib/mongodb.js';
import { startVite, setShuttingDown } from './lib/vite.js';
import { startBackend, setBackendShuttingDown } from './lib/backend.js';
import fileApiRouter from './lib/file-api.js';
import logsApiRouter from './lib/logs-api.js';
import chatApiRouter from './lib/chat-api.js';
import { apiRouter, viteRouter } from './lib/proxy.js';

const app = express();

// ============================================
// Middleware
// ============================================
app.use(cors());

// Only parse JSON for Express API endpoints, not for proxied requests
app.use((req, res, next) => {
  const expressApiPaths = EXPRESS_API_ENDPOINTS.map(p => `/api${p}`);
  const shouldParse = expressApiPaths.some(p => req.path.startsWith(p)) || !req.path.startsWith('/api/');
  if (shouldParse) {
    express.json({ limit: '50mb' })(req, res, next);
  } else {
    next();
  }
});

// ============================================
// Health Check
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    projectId,
    viteRunning: !!state.viteProcess,
    backendRunning: !!state.backendProcess,
    mongoRunning: !!state.mongoProcess
  });
});

// ============================================
// keepAlive - Called every 30s by frontend
// ============================================
app.post('/api/keepAlive', (req, res) => {
  state.lastKeepAlive = Date.now();
  res.json({
    status: 'alive',
    timestamp: state.lastKeepAlive,
    projectId,
    viteRunning: !!state.viteProcess,
    backendRunning: !!state.backendProcess
  });
});

// ============================================
// API Routes
// ============================================
app.use('/api', fileApiRouter);
app.use('/api', logsApiRouter);
app.use('/api', chatApiRouter);

// Route /api/* to Python backend (except Express API endpoints)
app.use('/api', apiRouter);

// Proxy everything except /api/* and /health to Vite
app.use(viteRouter);

// ============================================
// Initialize Project
// ============================================
async function initializeProject() {
  console.log(`🔧 Initializing project: ${projectId}`);

  // 1. Ensure project directories exist
  await fs.ensureDir(PROJECT_DIR);
  await fs.ensureDir(FRONTEND_DIR);
  await fs.ensureDir(BACKEND_DIR);

  // 2. Download files from GCS
  await syncFromGCS(projectId, PROJECT_DIR);

  // 3. Copy frontend template if package.json doesn't exist
  const frontendPkgPath = path.join(FRONTEND_DIR, 'package.json');
  if (!await fs.pathExists(frontendPkgPath)) {
    console.log('📋 No frontend files found, copying frontend template...');
    const templateFiles = await fs.readdir(FRONTEND_TEMPLATE_DIR);
    for (const file of templateFiles) {
      if (file !== 'node_modules') {
        await fs.copy(path.join(FRONTEND_TEMPLATE_DIR, file), path.join(FRONTEND_DIR, file));
        console.log(`  Copied: ${file}`);
      }
    }
  }

  // 4. Symlink node_modules from pre-installed template (instant, read-only)
  const nodeModulesPath = path.join(FRONTEND_DIR, 'node_modules');
  if (!await fs.pathExists(nodeModulesPath)) {
    console.log('🔗 Symlinking node_modules from template...');
    await fs.symlink(FRONTEND_NODE_MODULES, nodeModulesPath, 'dir');
    console.log('  Symlinked node_modules');
  }

  // 5. Copy backend template if server.py doesn't exist
  const backendServerPath = path.join(BACKEND_DIR, 'server.py');
  if (!await fs.pathExists(backendServerPath)) {
    console.log('📋 No backend files found, copying backend template...');
    await fs.copy(BACKEND_TEMPLATE_DIR, BACKEND_DIR);
    console.log('  Copied backend template');
  }

  // 6. Start MongoDB
  await startMongo();

  // 7. Restore MongoDB data from GCS (if exists)
  await restoreMongoFromGCS();

  // 8. Start Vite (frontend)
  await startVite();

  // 9. Start Python Backend
  await startBackend();

  // 10. Start Periodic Backups (safety net)
  startPeriodicBackups();
}

// ============================================
// Periodic Backups - Extra safety for user data
// ============================================
function startPeriodicBackups() {
  // Backup files every 2 minutes
  setInterval(async () => {
    try {
      console.log('⏰ Periodic file sync to GCS...');
      await syncToGCS(projectId, PROJECT_DIR);
      console.log('✅ Periodic file sync complete');
    } catch (error) {
      console.error('❌ Periodic file sync failed:', error.message);
    }
  }, FILE_SYNC_INTERVAL);

  // Backup MongoDB every 5 minutes
  setInterval(async () => {
    try {
      console.log('⏰ Periodic MongoDB backup...');
      await backupMongoToGCS();
      console.log('✅ Periodic MongoDB backup complete');
    } catch (error) {
      console.error('❌ Periodic MongoDB backup failed:', error.message);
    }
  }, MONGO_BACKUP_INTERVAL);

  console.log('🔒 Periodic backups enabled: Files every 2min, MongoDB every 5min');
}

// ============================================
// Graceful Shutdown
// ============================================
async function shutdown() {
  console.log('🛑 Shutting down...');

  // Mark as shutting down to prevent auto-restart
  setShuttingDown();
  setBackendShuttingDown();

  // 1. Backup MongoDB to GCS before shutdown
  try {
    await backupMongoToGCS();
  } catch (error) {
    console.error('Failed to backup MongoDB:', error);
  }

  // 2. Save files to GCS before shutdown
  try {
    await syncToGCS(projectId, PROJECT_DIR);
    console.log('✅ Files saved to GCS');
  } catch (error) {
    console.error('Failed to save files to GCS:', error);
  }

  // 3. Kill processes
  if (state.mongoProcess) {
    state.mongoProcess.kill();
    console.log('MongoDB stopped');
  }

  if (state.viteProcess) {
    state.viteProcess.kill();
    console.log('Vite stopped');
  }

  if (state.backendProcess) {
    state.backendProcess.kill();
    console.log('Backend stopped');
  }

  console.log('✅ Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ============================================
// Start Server
// ============================================
app.listen(PORT, async () => {
  console.log(`🌐 Greta Cloud Run server listening on port ${PORT}`);
  console.log(`📁 Project ID: ${projectId}`);

  await initializeProject();
});

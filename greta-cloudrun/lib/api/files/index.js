/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FILE API - MAIN ROUTER
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Central entry point for all file operations API.
 * Combines core CRUD, bulk operations, search, dependencies, and commands.
 * 
 * All file operations are sandboxed to PROJECT_DIR for security.
 * Changes are automatically synced to Google Cloud Storage.
 * 
 * @module api/files
 * @see {@link ./core.js} - Core CRUD operations
 * @see {@link ./bulk.js} - Bulk read/write operations
 * @see {@link ./search.js} - Search-replace, grep, glob
 * @see {@link ./dependencies.js} - Package management
 * @see {@link ./commands.js} - Bash execution, TypeScript check
 */

import express from 'express';

// Sub-routers
import coreRouter from './core.js';
import bulkRouter from './bulk.js';
import searchRouter from './search.js';
import dependenciesRouter from './dependencies.js';
import commandsRouter from './commands.js';

// Re-export helpers for external use
export {
  resolveSafePath,
  isBinaryFile,
  apiResponse,
  scheduleSyncToGCS,
  getAppStatus,
  getRecentLogs,
  listFilesRecursive,
  ensureNodeModules,
  execAsync
} from './helpers.js';


const router = express.Router();


/* ─────────────────────────────────────────────────────────────────────────────
 * MOUNT SUB-ROUTERS
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Core File Operations
 * - POST /write-file
 * - GET  /read-file
 * - DELETE /delete-file
 * - POST /rename-file
 * - GET  /list-files
 * - POST /sync-to-gcs
 */
router.use('/', coreRouter);

/**
 * Bulk Operations
 * - POST /bulk-write-files
 * - POST /bulk-read-files
 */
router.use('/', bulkRouter);

/**
 * Search Operations
 * - POST /search-replace
 * - POST /insert-text
 * - POST /grep
 * - POST /glob-files
 */
router.use('/', searchRouter);

/**
 * Dependency Management
 * - POST /add-dependency
 * - POST /remove-dependency
 * - POST /add-python-dependency
 * - POST /remove-python-dependency
 */
router.use('/', dependenciesRouter);

/**
 * Command Execution & Server Management
 * - POST /execute-bash
 * - GET  /typescript-check
 * - POST  /reload-backend
 */
router.use('/', commandsRouter);


export default router;


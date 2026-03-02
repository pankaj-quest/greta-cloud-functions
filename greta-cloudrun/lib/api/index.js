/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * API MODULE INDEX
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Central export point for all API modules.
 * Each module is an Express router that handles specific endpoints.
 *
 * Directory Structure:
 * ├── files/       - File operations, dependencies, bash execution
 * ├── logs/        - Console and backend log retrieval
 * └── screenshot/  - Playwright screenshot service
 *
 * @module api
 */

export { default as fileRouter } from './files/index.js';
export { default as logsRouter } from './logs/index.js';
export { default as screenshotRouter } from './screenshot/index.js';


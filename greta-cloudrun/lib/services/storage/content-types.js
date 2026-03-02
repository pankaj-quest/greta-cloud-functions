/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTENT TYPES
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * MIME type utilities for file uploads and downloads.
 * 
 * @module services/storage/content-types
 */


/* ─────────────────────────────────────────────────────────────────────────────
 * MIME TYPE MAPPINGS
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * File extension to MIME type mapping
 */
const MIME_TYPES = {
  // JavaScript/TypeScript
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.jsx': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',

  // Web
  '.html': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.xml': 'application/xml',

  // Documentation
  '.md': 'text/markdown',
  '.txt': 'text/plain',

  // Images
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',

  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',

  // Archives
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',

  // Python
  '.py': 'text/x-python',
  '.pyi': 'text/x-python',

  // YAML
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
};

/** Default MIME type for unknown extensions */
const DEFAULT_MIME_TYPE = 'application/octet-stream';


/* ─────────────────────────────────────────────────────────────────────────────
 * BINARY FILE DETECTION
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Extensions that indicate binary files
 * These files are skipped during text operations
 */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.sqlite', '.db',
]);


/* ─────────────────────────────────────────────────────────────────────────────
 * PUBLIC API
 * ───────────────────────────────────────────────────────────────────────────── */

import path from 'path';

/**
 * Get MIME type for a file path based on extension
 * 
 * @param {string} filePath - File path or name
 * @returns {string} MIME type string
 * 
 * @example
 * getContentType('app.tsx')     // => 'application/typescript'
 * getContentType('image.png')   // => 'image/png'
 * getContentType('unknown.xyz') // => 'application/octet-stream'
 */
export function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || DEFAULT_MIME_TYPE;
}

/**
 * Check if a file is binary based on extension
 * 
 * @param {string} filePath - File path or name
 * @returns {boolean} True if file is likely binary
 * 
 * @example
 * isBinaryFile('app.tsx')   // => false
 * isBinaryFile('image.png') // => true
 */
export function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Check if a file is a text file (not binary)
 * 
 * @param {string} filePath - File path or name
 * @returns {boolean} True if file is likely text
 */
export function isTextFile(filePath) {
  return !isBinaryFile(filePath);
}


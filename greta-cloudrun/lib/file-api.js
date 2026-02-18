/**
 * File API Routes - CRUD operations for project files
 * Production-grade implementation with security and proper error handling
 */
import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { PROJECT_DIR, FRONTEND_DIR, BACKEND_DIR, DEBOUNCE_DELAY, projectId } from './config.js';
import { syncToGCS } from './gcs-sync.js';
import { logs, state } from './state.js';

const router = express.Router();
const execAsync = promisify(execCallback);

// ============================================
// Helper Functions
// ============================================

// Debounced GCS Sync
let syncTimeout = null;
let pendingSync = false;

function scheduleSyncToGCS() {
  if (syncTimeout) clearTimeout(syncTimeout);
  pendingSync = true;
  syncTimeout = setTimeout(async () => {
    if (pendingSync) {
      try {
        console.log('🔄 Auto-syncing files to GCS...');
        await syncToGCS(projectId, PROJECT_DIR);
        console.log('✅ Auto-sync complete');
        pendingSync = false;
      } catch (error) {
        console.error('❌ Auto-sync failed:', error.message);
      }
    }
  }, DEBOUNCE_DELAY);
}

/**
 * Validate and resolve file path - prevents path traversal attacks
 */
function resolveSafePath(filePath, baseDir = PROJECT_DIR) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }

  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.resolve(baseDir, normalized);

  // Ensure path is within project directory
  if (!fullPath.startsWith(path.resolve(baseDir))) {
    throw new Error('Path traversal not allowed');
  }

  return fullPath;
}

/**
 * Check if file is likely binary
 */
function isBinaryFile(filePath) {
  const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2',
    '.ttf', '.eot', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib'];
  return binaryExtensions.includes(path.extname(filePath).toLowerCase());
}

/**
 * Create consistent API response
 */
function apiResponse(res, status, data) {
  return res.status(status).json({
    success: status >= 200 && status < 300,
    timestamp: new Date().toISOString(),
    ...data
  });
}

/**
 * Get current app status
 */
function getAppStatus() {
  return {
    viteRunning: state.viteProcess !== null,
    backendRunning: state.backendProcess !== null,
    mongoRunning: state.mongoProcess !== null
  };
}

/**
 * Get recent logs (last N entries)
 */
function getRecentLogs(type, count = 20) {
  if (type === 'backend') {
    return {
      logs: logs.backend.slice(-count),
      errors: logs.backendErrors.slice(-count)
    };
  } else if (type === 'frontend' || type === 'vite') {
    return {
      logs: logs.vite.slice(-count),
      errors: logs.viteErrors.slice(-count)
    };
  }
  return { logs: [], errors: [] };
}

// ============================================
// Core File Operations
// ============================================

// Write File (mcp_create_file compatible)
// Accepts both Emergent format (path, file_text) and legacy format (filePath, content)
router.post('/write-file', async (req, res) => {
  try {
    // Support both Emergent (path, file_text) and legacy (filePath, content)
    const filePath = req.body.path || req.body.filePath;
    const content = req.body.file_text !== undefined ? req.body.file_text : req.body.content;

    if (!filePath || content === undefined) {
      return apiResponse(res, 400, { error: 'path and file_text required' });
    }

    const fullPath = resolveSafePath(filePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, 'utf8');

    console.log(`✅ File written: ${filePath}`);
    scheduleSyncToGCS();

    return apiResponse(res, 200, { path: filePath });
  } catch (error) {
    console.error('Write file error:', error);
    return apiResponse(res, 500, { error: error.message });
  }
});

// Read File (mcp_view_file compatible)
// Supports view_range as array [start, end] like Emergent
router.get('/read-file', async (req, res) => {
  try {
    // Support both Emergent (path) and legacy (filePath)
    const filePath = req.query.path || req.query.filePath;
    const viewRange = req.query.view_range; // Emergent format: "[1,10]"

    if (!filePath) {
      return apiResponse(res, 400, { error: 'path required' });
    }

    const fullPath = resolveSafePath(filePath);
    const stat = await fs.stat(fullPath).catch(() => null);

    if (!stat) {
      return apiResponse(res, 404, { error: 'File not found' });
    }

    // If it's a directory, list contents (like mcp_view_file)
    if (stat.isDirectory()) {
      const items = await fs.readdir(fullPath, { withFileTypes: true });
      const contents = items.map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file',
        path: path.join(filePath, item.name).replace(/\\/g, '/')
      }));
      return apiResponse(res, 200, {
        type: 'directory',
        path: filePath,
        contents,
        totalItems: contents.length
      });
    }

    // Read file content
    const content = await fs.readFile(fullPath, 'utf8');
    const lines = content.split('\n');
    const totalLines = lines.length;

    // Support view_range [start, end] (1-indexed, inclusive) - Emergent format
    if (viewRange) {
      try {
        const range = JSON.parse(viewRange);
        const start = Math.max(1, range[0] || 1);
        const end = Math.min(totalLines, range[1] || totalLines);

        const selectedLines = lines.slice(start - 1, end);
        return apiResponse(res, 200, {
          content: selectedLines.join('\n'),
          path: filePath,
          view_range: [start, end],
          total_lines: totalLines,
          lines_returned: selectedLines.length
        });
      } catch (e) {
        return apiResponse(res, 400, { error: 'Invalid view_range format. Use [start, end]' });
      }
    }

    return apiResponse(res, 200, {
      type: 'file',
      content,
      path: filePath,
      total_lines: totalLines
    });
  } catch (error) {
    return apiResponse(res, 500, { error: error.message });
  }
});

// Delete File
// Accepts both Emergent format (path) and legacy format (filePath)
router.delete('/delete-file', async (req, res) => {
  try {
    const filePath = req.body.path || req.body.filePath;
    if (!filePath) {
      return apiResponse(res, 400, { error: 'path required' });
    }

    const fullPath = resolveSafePath(filePath);
    await fs.remove(fullPath);

    scheduleSyncToGCS();
    return apiResponse(res, 200, { path: filePath });
  } catch (error) {
    return apiResponse(res, 500, { error: error.message });
  }
});

// List Files
router.get('/list-files', async (req, res) => {
  try {
    const files = await listFilesRecursive(PROJECT_DIR);
    res.json({ success: true, files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function listFilesRecursive(dir, baseDir = dir) {
  const files = [];
  const items = await fs.readdir(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (item.name === 'node_modules' || item.name === '.git') continue;

    if (item.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath, baseDir));
    } else {
      files.push(relativePath.replace(/\\/g, '/'));
    }
  }
  return files;
}

// Add NPM Dependency (Frontend)
router.post('/add-dependency', async (req, res) => {
  try {
    const { packageName, isDev = false } = req.body;
    const flag = isDev ? '--save-dev' : '--save';

    console.log(`📦 Installing npm package: ${packageName}...`);
    const { exec } = await import('child_process');

    exec(`npm install ${flag} ${packageName}`, { cwd: FRONTEND_DIR }, (error, stdout, stderr) => {
      if (error) {
        return res.status(500).json({ error: stderr || error.message });
      }
      console.log(`✅ Installed npm package: ${packageName}`);
      res.json({ success: true, package: packageName });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add Python Dependency (Backend)
router.post('/add-python-dependency', async (req, res) => {
  try {
    const { packageName, version } = req.body;

    if (!packageName) {
      return res.status(400).json({ error: 'packageName is required' });
    }

    const packageSpec = version ? `${packageName}==${version}` : packageName;
    console.log(`🐍 Installing Python package: ${packageSpec}...`);

    const { exec } = await import('child_process');
    const requirementsPath = path.join(BACKEND_DIR, 'requirements.txt');

    // Install the package using pip in the virtual environment
    const pipPath = '/opt/venv/bin/pip';

    exec(`${pipPath} install ${packageSpec}`, { cwd: BACKEND_DIR }, async (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Failed to install ${packageSpec}:`, stderr || error.message);
        return res.status(500).json({ error: stderr || error.message });
      }

      console.log(`✅ Installed Python package: ${packageSpec}`);

      // Update requirements.txt - append if not already present
      try {
        let requirements = '';
        if (await fs.pathExists(requirementsPath)) {
          requirements = await fs.readFile(requirementsPath, 'utf8');
        }

        // Check if package already in requirements.txt
        const packageNameLower = packageName.toLowerCase();
        const lines = requirements.split('\n');
        const alreadyExists = lines.some(line => {
          const lineLower = line.toLowerCase().trim();
          return lineLower.startsWith(packageNameLower + '==') ||
                 lineLower.startsWith(packageNameLower + '>=') ||
                 lineLower.startsWith(packageNameLower + '<=') ||
                 lineLower === packageNameLower;
        });

        if (!alreadyExists) {
          // Get installed version
          exec(`${pipPath} show ${packageName} | grep Version`, { cwd: BACKEND_DIR }, async (err, versionOut) => {
            let versionLine = packageName;
            if (!err && versionOut) {
              const versionMatch = versionOut.match(/Version:\s*(.+)/);
              if (versionMatch) {
                versionLine = `${packageName}>=${versionMatch[1].trim()}`;
              }
            }

            // Append to requirements.txt
            const newRequirements = requirements.trim() + '\n' + versionLine + '\n';
            await fs.writeFile(requirementsPath, newRequirements);
            console.log(`📝 Updated requirements.txt with ${versionLine}`);

            res.json({ success: true, package: packageName, addedToRequirements: versionLine });
          });
        } else {
          res.json({ success: true, package: packageName, addedToRequirements: false, message: 'Already in requirements.txt' });
        }
      } catch (reqError) {
        // Package installed but couldn't update requirements.txt
        console.error('Warning: Could not update requirements.txt:', reqError.message);
        res.json({ success: true, package: packageName, addedToRequirements: false, warning: reqError.message });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual Sync to GCS
router.post('/sync-to-gcs', async (req, res) => {
  try {
    await syncToGCS(projectId, PROJECT_DIR);
    res.json({ success: true, message: 'Synced to GCS' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Bulk Write Files - Write multiple files at once (concurrent)
// Matches Emergent's mcp_bulk_file_writer
// ============================================
router.post('/bulk-write-files', async (req, res) => {
  try {
    const {
      files,
      capture_logs_backend = false,
      capture_logs_frontend = false,
      status = false
    } = req.body;

    if (!files || !Array.isArray(files)) {
      return apiResponse(res, 400, { error: 'files array required' });
    }

    if (files.length > 100) {
      return apiResponse(res, 400, { error: 'Maximum 100 files per request' });
    }

    // Process files concurrently for better performance
    const writePromises = files.map(async (file) => {
      const { path: filePath, content } = file;
      if (!filePath || content === undefined) {
        return { path: filePath || 'unknown', success: false, error: 'path and content required' };
      }

      try {
        const fullPath = resolveSafePath(filePath);
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content, 'utf8');
        return { path: filePath, success: true };
      } catch (err) {
        return { path: filePath, success: false, error: err.message };
      }
    });

    const results = await Promise.all(writePromises);
    const successCount = results.filter(r => r.success).length;

    console.log(`✅ Bulk write: ${successCount}/${files.length} files written`);
    scheduleSyncToGCS();

    // Build response matching Emergent's format
    const response = {
      results,
      totalFiles: files.length,
      successCount,
      failedCount: files.length - successCount
    };

    // Include backend logs if requested (like Emergent)
    if (capture_logs_backend) {
      response.backendLogs = getRecentLogs('backend', 50);
    }

    // Include frontend logs if requested (like Emergent)
    if (capture_logs_frontend) {
      response.frontendLogs = getRecentLogs('frontend', 50);
    }

    // Include app status if requested (like Emergent)
    if (status) {
      response.status = getAppStatus();
    }

    return apiResponse(res, 200, response);
  } catch (error) {
    console.error('Bulk write error:', error);
    return apiResponse(res, 500, { error: error.message });
  }
});

// ============================================
// Bulk Read Files - Read multiple files at once (concurrent)
// ============================================
router.post('/bulk-read-files', async (req, res) => {
  try {
    const { paths } = req.body;
    if (!paths || !Array.isArray(paths)) {
      return apiResponse(res, 400, { error: 'paths array required' });
    }

    if (paths.length > 100) {
      return apiResponse(res, 400, { error: 'Maximum 100 files per request' });
    }

    // Process files concurrently for better performance
    const readPromises = paths.map(async (filePath) => {
      try {
        const fullPath = resolveSafePath(filePath);

        if (isBinaryFile(filePath)) {
          return { path: filePath, success: false, error: 'Binary file - use download endpoint' };
        }

        if (!await fs.pathExists(fullPath)) {
          return { path: filePath, success: false, error: 'File not found' };
        }

        const content = await fs.readFile(fullPath, 'utf8');
        return { path: filePath, success: true, content };
      } catch (err) {
        return { path: filePath, success: false, error: err.message };
      }
    });

    const results = await Promise.all(readPromises);
    const successCount = results.filter(r => r.success).length;

    return apiResponse(res, 200, {
      results,
      totalFiles: paths.length,
      successCount,
      failedCount: paths.length - successCount
    });
  } catch (error) {
    return apiResponse(res, 500, { error: error.message });
  }
});

// ============================================
// Search & Replace - Find and replace text in file
// Matches Emergent's mcp_search_replace exactly
// ============================================
router.post('/search-replace', async (req, res) => {
  try {
    // Support both Emergent (path, old_str, new_str, replace_all) and legacy format
    const filePath = req.body.path || req.body.filePath;
    const oldStr = req.body.old_str !== undefined ? req.body.old_str : req.body.oldStr;
    const newStr = req.body.new_str !== undefined ? req.body.new_str : req.body.newStr;
    const replaceAll = req.body.replace_all !== undefined ? req.body.replace_all : (req.body.replaceAll || false);
    const status = req.body.status || false;

    if (!filePath || oldStr === undefined || newStr === undefined) {
      return apiResponse(res, 400, { error: 'path, old_str, and new_str required' });
    }

    if (oldStr === '') {
      return apiResponse(res, 400, { error: 'old_str cannot be empty' });
    }

    const fullPath = resolveSafePath(filePath);
    if (!await fs.pathExists(fullPath)) {
      return apiResponse(res, 404, { error: 'File not found' });
    }

    let content = await fs.readFile(fullPath, 'utf8');
    const originalContent = content;

    // Count occurrences before replacing
    const occurrences = content.split(oldStr).length - 1;

    if (replaceAll) {
      content = content.split(oldStr).join(newStr);
    } else {
      content = content.replace(oldStr, newStr);
    }

    if (content === originalContent) {
      const response = {
        changed: false,
        message: 'No matches found',
        occurrences: 0
      };
      if (status) response.status = getAppStatus();
      return apiResponse(res, 200, response);
    }

    await fs.writeFile(fullPath, content, 'utf8');
    console.log(`✅ Search-replace in: ${filePath} (${replaceAll ? occurrences : 1} replacements)`);
    scheduleSyncToGCS();

    const response = {
      changed: true,
      path: filePath,
      replacements: replaceAll ? occurrences : 1,
      total_occurrences: occurrences
    };

    if (status) response.status = getAppStatus();

    return apiResponse(res, 200, response);
  } catch (error) {
    return apiResponse(res, 500, { error: error.message });
  }
});

// ============================================
// Insert Text - Insert text at specific line
// Matches Emergent's mcp_insert_text exactly
// ============================================
router.post('/insert-text', async (req, res) => {
  try {
    // Support both Emergent (path, new_str, insert_line) and legacy format
    const filePath = req.body.path || req.body.filePath;
    const newStr = req.body.new_str !== undefined ? req.body.new_str : req.body.newStr;
    const insertLine = req.body.insert_line !== undefined ? req.body.insert_line : req.body.insertLine;

    if (!filePath || newStr === undefined || insertLine === undefined) {
      return apiResponse(res, 400, { error: 'path, new_str, and insert_line required' });
    }

    if (typeof insertLine !== 'number' || insertLine < 0) {
      return apiResponse(res, 400, { error: 'insert_line must be a non-negative number' });
    }

    const fullPath = resolveSafePath(filePath);
    if (!await fs.pathExists(fullPath)) {
      return apiResponse(res, 404, { error: 'File not found' });
    }

    const content = await fs.readFile(fullPath, 'utf8');
    const lines = content.split('\n');
    const totalLinesBefore = lines.length;

    // insert_line 0 means insert at beginning
    const lineIndex = Math.max(0, Math.min(insertLine, lines.length));

    // Support multi-line insertions
    const newLines = newStr.split('\n');
    lines.splice(lineIndex, 0, ...newLines);

    await fs.writeFile(fullPath, lines.join('\n'), 'utf8');
    console.log(`✅ Inserted ${newLines.length} line(s) at line ${lineIndex} in: ${filePath}`);
    scheduleSyncToGCS();

    return apiResponse(res, 200, {
      path: filePath,
      inserted_at: lineIndex,
      lines_inserted: newLines.length,
      total_lines_before: totalLinesBefore,
      total_lines_after: lines.length
    });
  } catch (error) {
    return apiResponse(res, 500, { error: error.message });
  }
});

// ============================================
// Grep - Search content in files with regex
// Matches Emergent's grep_tool exactly
// ============================================
router.post('/grep', async (req, res) => {
  try {
    // Support both Emergent (path, case_sensitive, context_lines) and legacy format
    const pattern = req.body.pattern;
    const filePath = req.body.path || req.body.filePath;
    const caseSensitive = req.body.case_sensitive !== undefined ? req.body.case_sensitive : (req.body.caseSensitive || false);
    const contextLines = req.body.context_lines !== undefined ? req.body.context_lines : (req.body.contextLines || 0);
    const include = req.body.include;
    const maxResults = req.body.max_results || req.body.maxResults || 1000;

    if (!pattern) {
      return apiResponse(res, 400, { error: 'pattern required' });
    }

    // Validate regex pattern
    let regex;
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      regex = new RegExp(pattern, flags);
    } catch (e) {
      return apiResponse(res, 400, { error: `Invalid regex pattern: ${e.message}` });
    }

    const searchDir = filePath ? resolveSafePath(filePath) : PROJECT_DIR;
    const results = [];
    let totalMatches = 0;
    let filesSearched = 0;

    // Include pattern for filtering files
    let includeRegex = null;
    if (include) {
      const includePattern = include
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*');
      includeRegex = new RegExp(includePattern + '$', 'i');
    }

    async function searchInFile(file) {
      if (totalMatches >= maxResults) return;

      try {
        // Skip binary files
        if (isBinaryFile(file)) return;

        // Apply include filter
        if (includeRegex && !includeRegex.test(file)) return;

        const content = await fs.readFile(file, 'utf8');
        const lines = content.split('\n');
        filesSearched++;

        const matches = [];
        lines.forEach((line, index) => {
          if (totalMatches >= maxResults) return;

          // Reset regex for each line (important for global flag)
          regex.lastIndex = 0;
          if (regex.test(line)) {
            const match = {
              line: index + 1,
              content: line,
              context: []
            };

            // Add context lines
            if (contextLines > 0) {
              for (let i = Math.max(0, index - contextLines); i < index; i++) {
                match.context.push({ line: i + 1, content: lines[i], type: 'before' });
              }
              for (let i = index + 1; i <= Math.min(lines.length - 1, index + contextLines); i++) {
                match.context.push({ line: i + 1, content: lines[i], type: 'after' });
              }
            }
            matches.push(match);
            totalMatches++;
          }
        });

        if (matches.length > 0) {
          results.push({
            file: path.relative(PROJECT_DIR, file).replace(/\\/g, '/'),
            matches,
            matchCount: matches.length
          });
        }
      } catch (err) {
        // Skip unreadable files silently
      }
    }

    async function searchRecursive(dir) {
      if (totalMatches >= maxResults) return;

      const stat = await fs.stat(dir);
      if (stat.isFile()) {
        await searchInFile(dir);
        return;
      }

      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (totalMatches >= maxResults) break;
        if (item.name === 'node_modules' || item.name === '.git' || item.name === 'dist') continue;

        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          await searchRecursive(fullPath);
        } else {
          await searchInFile(fullPath);
        }
      }
    }

    await searchRecursive(searchDir);

    return apiResponse(res, 200, {
      pattern,
      results,
      totalMatches,
      filesSearched,
      truncated: totalMatches >= maxResults
    });
  } catch (error) {
    return apiResponse(res, 500, { error: error.message });
  }
});

// ============================================
// Glob Files - Pattern matching for files
// Matches Emergent's mcp_glob_files exactly
// ============================================
router.post('/glob-files', async (req, res) => {
  try {
    // Support both Emergent (path) and legacy (filePath) format
    const pattern = req.body.pattern;
    const filePath = req.body.path || req.body.filePath;
    const maxResults = req.body.max_results || req.body.maxResults || 1000;

    if (!pattern) {
      return apiResponse(res, 400, { error: 'pattern required' });
    }

    const searchDir = filePath ? resolveSafePath(filePath) : PROJECT_DIR;
    const allFiles = await listFilesRecursive(searchDir, searchDir);

    // Robust glob matching (supports *, **, ?, [abc], {a,b,c})
    const regexPattern = pattern
      .replace(/\\/g, '/')
      .replace(/\./g, '\\.')
      .replace(/\?/g, '[^/]')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{GLOBSTAR}}/g, '.*')
      .replace(/\{([^}]+)\}/g, (_, group) => `(${group.split(',').join('|')})`);

    let regex;
    try {
      regex = new RegExp(`^${regexPattern}$`, 'i');
    } catch (e) {
      return apiResponse(res, 400, { error: `Invalid glob pattern: ${e.message}` });
    }

    const matchedFiles = allFiles.filter(f => regex.test(f)).slice(0, maxResults);

    return apiResponse(res, 200, {
      pattern,
      files: matchedFiles,
      total_matches: matchedFiles.length,
      total_files: allFiles.length,
      truncated: matchedFiles.length >= maxResults
    });
  } catch (error) {
    return apiResponse(res, 500, { error: error.message });
  }
});

// ============================================
// Execute Bash - Run shell commands (with security)
// ============================================
router.post('/execute-bash', async (req, res) => {
  try {
    const { command, cwd, timeout = 30000 } = req.body;
    if (!command) {
      return apiResponse(res, 400, { error: 'command required' });
    }

    if (typeof command !== 'string' || command.length > 10000) {
      return apiResponse(res, 400, { error: 'Invalid command' });
    }

    // Security: Block dangerous commands
    const blockedPatterns = [
      /rm\s+-rf\s+\/(?!app)/i,      // Block rm -rf / but allow /app paths
      /mkfs/i,                        // Block filesystem creation
      /dd\s+if=/i,                    // Block disk dump
      /:(){ :|:& };:/,                // Fork bomb
      />\s*\/dev\/sd/i,               // Block device writes
      /chmod\s+777\s+\//i,            // Block recursive chmod on root
      /wget.*\|.*sh/i,                // Block wget piped to shell
      /curl.*\|.*sh/i,                // Block curl piped to shell
      /nc\s+-[el]/i,                  // Block netcat listeners
      /python.*-c.*import\s+socket/i, // Block python socket code
      /nohup/i,                       // Block background processes
      /&\s*$/,                        // Block backgrounding
      /\|\s*bash/i,                   // Block piping to bash
      /eval\s*\(/i,                   // Block eval
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(command)) {
        console.warn(`🚫 Blocked command: ${command}`);
        return apiResponse(res, 403, { error: 'Command blocked for security reasons' });
      }
    }

    // Resolve working directory safely
    const workDir = cwd ? resolveSafePath(cwd) : PROJECT_DIR;

    console.log(`🖥️ Executing: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`);
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workDir,
        timeout: Math.min(timeout, 120000), // Max 2 minutes
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        env: {
          ...process.env,
          PATH: process.env.PATH,
          HOME: '/app',
          NODE_ENV: 'development'
        }
      });

      const duration = Date.now() - startTime;
      console.log(`✅ Command completed in ${duration}ms`);

      return apiResponse(res, 200, {
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
        duration
      });
    } catch (execError) {
      const duration = Date.now() - startTime;

      if (execError.killed) {
        console.warn(`⏱️ Command timed out after ${timeout}ms`);
        return apiResponse(res, 408, {
          error: 'Command timed out',
          stdout: execError.stdout || '',
          stderr: execError.stderr || '',
          exitCode: 124,
          duration
        });
      }

      // Command failed but completed
      return apiResponse(res, 200, {
        stdout: execError.stdout || '',
        stderr: execError.stderr || execError.message,
        exitCode: execError.code || 1,
        duration
      });
    }
  } catch (error) {
    console.error('Execute bash error:', error);
    return apiResponse(res, 500, { error: error.message });
  }
});

export default router;


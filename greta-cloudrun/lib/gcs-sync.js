/**
 * Google Cloud Storage Sync Utilities
 * - Download project files from GCS on container start
 * - Upload project files to GCS on changes/shutdown
 */

import { Storage } from '@google-cloud/storage';
import fs from 'fs-extra';
import path from 'path';
import archiver from 'archiver';
import extractZip from 'extract-zip';

// Initialize GCS client
// Uses Application Default Credentials in Cloud Run
const storage = new Storage();
const BUCKET_NAME = process.env.GCS_BUCKET || 'greta-projects';

/**
 * Download project files from GCS
 * @param {string} projectId - Project identifier
 * @param {string} localDir - Local directory to download to
 * @returns {boolean} - True if files were downloaded
 */
export async function syncFromGCS(projectId, localDir) {
  console.log(`📥 Downloading from GCS: gs://${BUCKET_NAME}/projects/${projectId}/`);
  
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const prefix = `projects/${projectId}/files/`;
    
    const [files] = await bucket.getFiles({ prefix });
    
    if (files.length === 0) {
      console.log('No files found in GCS, starting with empty project');
      return false;
    }
    
    console.log(`Found ${files.length} files in GCS`);
    
    // Download files in parallel
    await Promise.all(files.map(async (file) => {
      const relativePath = file.name.replace(prefix, '');
      if (!relativePath) return; // Skip directory entries
      
      const localPath = path.join(localDir, relativePath);
      await fs.ensureDir(path.dirname(localPath));
      
      await file.download({ destination: localPath });
    }));
    
    console.log(`✅ Downloaded ${files.length} files from GCS`);
    
    // Also check for cached node_modules
    await syncNodeModulesFromGCS(projectId, localDir);
    
    return true;
  } catch (error) {
    console.error('GCS download error:', error.message);
    return false;
  }
}

/**
 * Upload project files to GCS
 * @param {string} projectId - Project identifier
 * @param {string} localDir - Local directory to upload from
 */
export async function syncToGCS(projectId, localDir) {
  console.log(`📤 Uploading to GCS: gs://${BUCKET_NAME}/projects/${projectId}/`);
  
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const prefix = `projects/${projectId}/files/`;
    
    // Get all files (excluding node_modules)
    const files = await listFilesRecursive(localDir, ['node_modules', '.git', 'dist']);
    
    console.log(`Uploading ${files.length} files...`);
    
    // Upload files in parallel (batched)
    const BATCH_SIZE = 50;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (file) => {
        const relativePath = path.relative(localDir, file).replace(/\\/g, '/');
        const destination = `${prefix}${relativePath}`;
        
        await bucket.upload(file, {
          destination,
          metadata: {
            contentType: getContentType(file)
          }
        });
      }));
    }
    
    console.log(`✅ Uploaded ${files.length} files to GCS`);
  } catch (error) {
    console.error('GCS upload error:', error.message);
    throw error;
  }
}

/**
 * Download cached node_modules from GCS (if exists)
 */
async function syncNodeModulesFromGCS(projectId, localDir) {
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const nmZipPath = `projects/${projectId}/node_modules.zip`;
    const file = bucket.file(nmZipPath);
    
    const [exists] = await file.exists();
    if (!exists) {
      console.log('No cached node_modules found');
      return;
    }
    
    console.log('📦 Downloading cached node_modules...');
    const localZip = path.join(localDir, 'node_modules.zip');
    await file.download({ destination: localZip });
    
    // Extract
    await extractZip(localZip, { dir: localDir });
    await fs.remove(localZip);
    
    console.log('✅ Restored cached node_modules');
  } catch (error) {
    console.log('Could not restore node_modules cache:', error.message);
  }
}

/**
 * Upload node_modules to GCS (for caching extra dependencies)
 * Called after npm install to cache project-specific dependencies
 */
export async function syncNodeModulesToGCS(projectId, localDir) {
  const nodeModulesPath = path.join(localDir, 'node_modules');

  // Check if node_modules exists and is not a symlink
  const stats = await fs.lstat(nodeModulesPath).catch(() => null);
  if (!stats) {
    console.log('node_modules does not exist, skipping cache upload');
    return;
  }

  if (stats.isSymbolicLink()) {
    console.log('node_modules is a symlink (using template), skipping cache upload');
    return;
  }

  console.log('📦 Caching node_modules to GCS...');

  try {
    const bucket = storage.bucket(BUCKET_NAME);
    const zipPath = path.join(localDir, 'node_modules.zip');

    // Create zip archive
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 5 } });

      output.on('close', resolve);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(nodeModulesPath, 'node_modules');
      archive.finalize();
    });

    // Upload to GCS
    await bucket.upload(zipPath, {
      destination: `projects/${projectId}/node_modules.zip`
    });

    // Clean up local zip
    await fs.remove(zipPath);

    console.log('✅ node_modules cached to GCS');
  } catch (error) {
    console.error('Failed to cache node_modules:', error.message);
  }
}

// Helper functions
async function listFilesRecursive(dir, exclude = []) {
  const files = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  
  for (const item of items) {
    if (exclude.includes(item.name)) continue;
    
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath, exclude));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.js': 'application/javascript',
    '.jsx': 'application/javascript',
    '.ts': 'application/typescript',
    '.tsx': 'application/typescript',
    '.json': 'application/json',
    '.html': 'text/html',
    '.css': 'text/css',
    '.md': 'text/markdown',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  };
  return types[ext] || 'application/octet-stream';
}


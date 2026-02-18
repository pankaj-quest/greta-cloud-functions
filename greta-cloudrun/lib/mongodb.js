/**
 * MongoDB Management - Start, backup, and restore
 */
import { spawn } from 'child_process';
import fs from 'fs-extra';
import { Storage } from '@google-cloud/storage';
import { MONGO_PORT, MONGO_DATA_DIR, GCS_BUCKET, projectId } from './config.js';
import { state } from './state.js';

const storage = new Storage();

/**
 * Start MongoDB server
 */
export async function startMongo() {
  if (state.mongoProcess) {
    console.log('MongoDB already running');
    return;
  }

  console.log('🍃 Starting MongoDB...');

  // Ensure data directory exists
  await fs.ensureDir(MONGO_DATA_DIR);

  state.mongoProcess = spawn('mongod', [
    '--dbpath', MONGO_DATA_DIR,
    '--bind_ip', '127.0.0.1',
    '--port', String(MONGO_PORT),
    '--noauth'
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  state.mongoProcess.stdout.on('data', (data) => {
    const message = data.toString().trim();
    console.log(`[MongoDB] ${message}`);
  });

  state.mongoProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();
    if (message.includes('ERROR') || message.includes('error')) {
      console.error(`[MongoDB Error] ${message}`);
    } else {
      console.log(`[MongoDB] ${message}`);
    }
  });

  state.mongoProcess.on('close', (code) => {
    console.log(`MongoDB process exited with code ${code}`);
    state.mongoProcess = null;
  });

  // Wait for MongoDB to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log('✅ MongoDB started on port ' + MONGO_PORT);
}

/**
 * Restore MongoDB from GCS backup (on startup)
 */
export async function restoreMongoFromGCS() {
  console.log('🔄 Checking for MongoDB backup in GCS...');

  const dumpPath = '/tmp/mongodb-dump.archive';
  const gcsPath = `projects/${projectId}/mongodb/dump.archive`;

  try {
    const bucket = storage.bucket(GCS_BUCKET);
    const file = bucket.file(gcsPath);

    // Check if backup exists
    const [exists] = await file.exists();
    if (!exists) {
      console.log('📭 No MongoDB backup found in GCS, starting with fresh database');
      return;
    }

    // Download from GCS
    console.log('📥 Downloading MongoDB backup from GCS...');
    await file.download({ destination: dumpPath });
    console.log('✅ Downloaded MongoDB backup');

    // Run mongorestore
    console.log('🔧 Restoring MongoDB from backup...');
    const restore = spawn('mongorestore', [
      '--archive=' + dumpPath,
      '--port', String(MONGO_PORT)
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    restore.stdout.on('data', (data) => {
      console.log(`[mongorestore] ${data.toString().trim()}`);
    });

    restore.stderr.on('data', (data) => {
      console.log(`[mongorestore] ${data.toString().trim()}`);
    });

    await new Promise((resolve, reject) => {
      restore.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`mongorestore exited with code ${code}`));
      });
      restore.on('error', reject);
    });

    // Clean up temp file
    await fs.remove(dumpPath);
    console.log('✅ MongoDB restored from GCS backup');
  } catch (error) {
    console.error('❌ Failed to restore MongoDB from GCS:', error.message);
  }
}

/**
 * Backup MongoDB to GCS (on shutdown and periodically)
 */
export async function backupMongoToGCS() {
  if (!state.mongoProcess) {
    console.log('⚠️ MongoDB not running, skipping backup');
    return;
  }

  console.log('💾 Backing up MongoDB to GCS...');

  const dumpPath = '/tmp/mongodb-dump.archive';
  const gcsPath = `projects/${projectId}/mongodb/dump.archive`;

  try {
    // Run mongodump
    console.log('🔧 Running mongodump...');
    const dump = spawn('mongodump', [
      '--archive=' + dumpPath,
      '--port', String(MONGO_PORT)
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    dump.stdout.on('data', (data) => {
      console.log(`[mongodump] ${data.toString().trim()}`);
    });

    dump.stderr.on('data', (data) => {
      console.log(`[mongodump] ${data.toString().trim()}`);
    });

    await new Promise((resolve, reject) => {
      dump.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`mongodump exited with code ${code}`));
      });
      dump.on('error', reject);
    });

    console.log('✅ MongoDB dump created');

    // Upload to GCS
    console.log('📤 Uploading MongoDB backup to GCS...');
    const bucket = storage.bucket(GCS_BUCKET);
    await bucket.upload(dumpPath, {
      destination: gcsPath,
      metadata: { contentType: 'application/octet-stream' },
    });

    // Clean up temp file
    await fs.remove(dumpPath);
    console.log(`✅ MongoDB backed up to gs://${GCS_BUCKET}/${gcsPath}`);
  } catch (error) {
    console.error('❌ Failed to backup MongoDB to GCS:', error.message);
  }
}


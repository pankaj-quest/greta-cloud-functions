/**
 * Python Backend Management (FastAPI with uvicorn)
 */
import { spawn } from 'child_process';
import fs from 'fs-extra';
import { BACKEND_PORT, BACKEND_DIR } from './config.js';
import { state, addLog } from './state.js';

// Flag to prevent restart during shutdown
let shuttingDown = false;

/**
 * Mark as shutting down (call from server.js before shutdown)
 */
export function setBackendShuttingDown() {
  shuttingDown = true;
}

/**
 * Start Python backend server
 */
export async function startBackend() {
  if (state.backendProcess) {
    console.log('Backend already running');
    return;
  }

  // Check if backend directory exists
  if (!await fs.pathExists(BACKEND_DIR)) {
    console.log('⚠️ No backend directory found, skipping backend startup');
    return;
  }

  console.log('🐍 Starting Python backend...');

  state.backendProcess = spawn('uvicorn', ['server:app', '--host', '0.0.0.0', '--port', String(BACKEND_PORT), '--reload'], {
    cwd: BACKEND_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: `/opt/venv/bin:${process.env.PATH}`,
      PYTHONPATH: BACKEND_DIR
    }
  });

  state.backendProcess.stdout.on('data', (data) => {
    const message = data.toString().trim();
    console.log(`[Backend] ${message}`);
    addLog('backend', message);
  });

  state.backendProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();
    console.error(`[Backend Error] ${message}`);
    addLog('backendErrors', message);
  });

  state.backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
    state.backendProcess = null;

    // ALWAYS auto-restart if not shutting down - we never want Backend to stay stopped
    if (!shuttingDown) {
      console.log('⚠️ Backend stopped unexpectedly, auto-restarting in 2 seconds...');
      setTimeout(() => {
        if (!shuttingDown) {
          startBackend().catch(err => console.error('Failed to restart Backend:', err));
        }
      }, 2000);
    }
  });

  // Wait for backend to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log('✅ Python backend started');
}

/**
 * Stop Python backend server
 */
export function stopBackend() {
  if (state.backendProcess) {
    state.backendProcess.kill();
    console.log('Backend stopped');
  }
}


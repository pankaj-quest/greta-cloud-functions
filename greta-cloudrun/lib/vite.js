/**
 * Vite Dev Server Management
 */
import { spawn } from 'child_process';
import path from 'path';
import { VITE_PORT, FRONTEND_DIR, FRONTEND_NODE_MODULES } from './config.js';
import { state, addLog } from './state.js';

// Flag to prevent restart during shutdown
let shuttingDown = false;

/**
 * Mark as shutting down (call from server.js before shutdown)
 */
export function setShuttingDown() {
  shuttingDown = true;
}

/**
 * Start Vite dev server
 */
export async function startVite() {
  if (state.viteProcess) {
    console.log('Vite already running');
    return;
  }

  console.log('🚀 Starting Vite dev server...');

  // Use the vite binary from the pre-installed template node_modules
  const viteBin = path.join(FRONTEND_NODE_MODULES, '.bin', 'vite');
  console.log(`Using vite from: ${viteBin}`);

  state.viteProcess = spawn(viteBin, ['--host', '0.0.0.0', '--port', String(VITE_PORT)], {
    cwd: FRONTEND_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_PATH: FRONTEND_NODE_MODULES,
      PATH: `${path.join(FRONTEND_NODE_MODULES, '.bin')}:${process.env.PATH}`
    }
  });

  state.viteProcess.stdout.on('data', (data) => {
    const message = data.toString().trim();
    console.log(`[Vite] ${message}`);
    addLog('vite', message);
  });

  state.viteProcess.stderr.on('data', (data) => {
    const message = data.toString().trim();
    console.error(`[Vite Error] ${message}`);
    addLog('viteErrors', message);
  });

  state.viteProcess.on('close', (code) => {
    console.log(`Vite process exited with code ${code}`);
    state.viteProcess = null;

    // ALWAYS auto-restart if not shutting down - we never want Vite to stay stopped
    if (!shuttingDown) {
      console.log('⚠️ Vite stopped unexpectedly, auto-restarting in 2 seconds...');
      setTimeout(() => {
        if (!shuttingDown) {
          startVite().catch(err => console.error('Failed to restart Vite:', err));
        }
      }, 2000);
    }
  });

  // Wait for Vite to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));
  console.log('✅ Vite dev server started');
}

/**
 * Stop Vite dev server
 */
export function stopVite() {
  if (state.viteProcess) {
    state.viteProcess.kill();
    console.log('Vite stopped');
  }
}


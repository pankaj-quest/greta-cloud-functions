/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SCREENSHOT API MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Take screenshots of the frontend preview using Playwright.
 * Reuses a browser instance for performance.
 * 
 * @module api/screenshot
 */

import express from 'express';
import { chromium } from 'playwright';

const router = express.Router();


/* ─────────────────────────────────────────────────────────────────────────────
 * BROWSER MANAGEMENT
 * ───────────────────────────────────────────────────────────────────────────── */

/** Singleton browser instance (reused for performance) */
let browser = null;

/**
 * Get or create the Playwright browser instance.
 * @returns {Promise<Browser>} Playwright browser
 */
async function getBrowser() {
  if (!browser) {
    console.log('🎭 Launching Playwright browser...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    console.log('✅ Playwright browser ready');
  }
  return browser;
}

/** Cleanup browser on process exit */
process.on('SIGTERM', async () => {
  if (browser) {
    await browser.close();
    browser = null;
  }
});


/* ─────────────────────────────────────────────────────────────────────────────
 * SCREENSHOT ENDPOINT
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/screenshot - Take a screenshot of a page.
 * 
 * Body params:
 * - url: Target URL (default: http://localhost:5173)
 * - fullPage: Capture full page (default: false)
 * - width: Viewport width (default: 1280)
 * - height: Viewport height (default: 720)
 * - selector: CSS selector for specific element
 * - waitFor: Time to wait for rendering in ms (default: 2000)
 */
router.post('/screenshot', async (req, res) => {
  try {
    const {
      url = 'http://localhost:5173',
      fullPage = false,
      width = 1280,
      height = 720,
      selector = null,
      waitFor = 2000
    } = req.body || {};

    console.log(`📸 Taking screenshot of ${url}...`);

    const browserInstance = await getBrowser();
    const context = await browserInstance.newContext({ viewport: { width, height } });
    const page = await context.newPage();

    // Capture console logs and errors
    const consoleLogs = [];
    const consoleErrors = [];

    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        consoleErrors.push(text);
      } else if (type === 'warning') {
        consoleLogs.push(`[WARN] ${text}`);
      } else {
        consoleLogs.push(text);
      }
    });

    page.on('pageerror', error => {
      consoleErrors.push(`[PAGE ERROR] ${error.message}`);
    });

    // Navigate and wait
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    if (waitFor > 0) {
      await page.waitForTimeout(waitFor);
    }

    // Take screenshot
    let screenshotBuffer;
    if (selector) {
      const element = await page.$(selector);
      if (!element) {
        await context.close();
        return res.status(400).json({ error: `Selector "${selector}" not found on page` });
      }
      screenshotBuffer = await element.screenshot({ type: 'png' });
    } else {
      screenshotBuffer = await page.screenshot({ type: 'png', fullPage });
    }

    await context.close();

    // Log captured errors
    if (consoleErrors.length > 0) {
      console.log(`⚠️ Screenshot captured ${consoleErrors.length} console errors`);
      consoleErrors.forEach(err => console.log(`  ❌ ${err.substring(0, 200)}`));
    }

    console.log(`✅ Screenshot taken (${Math.round(screenshotBuffer.length / 1024)}KB)`);

    res.json({
      success: true,
      image: screenshotBuffer.toString('base64'),
      mimeType: 'image/png',
      size: screenshotBuffer.length,
      dimensions: { width, height },
      url,
      consoleLogs: consoleLogs.slice(-20),
      consoleErrors,
      hasErrors: consoleErrors.length > 0
    });
  } catch (error) {
    console.error('❌ Screenshot error:', error.message);
    res.status(500).json({
      error: error.message,
      hint: 'Make sure the frontend is running on port 5173'
    });
  }
});


/* ─────────────────────────────────────────────────────────────────────────────
 * HEALTH CHECK
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/screenshot/health - Health check for screenshot service.
 */
router.get('/screenshot/health', async (req, res) => {
  try {
    const browserInstance = await getBrowser();
    res.json({ success: true, browserReady: !!browserInstance, message: 'Screenshot service ready' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


export default router;


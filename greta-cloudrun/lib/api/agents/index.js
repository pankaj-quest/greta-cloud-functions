/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * AGENTS API MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Local AI agents with full browser automation capabilities using Playwright.
 * 
 * Agents:
 * 1. frontend-testing   - UI testing (fill forms, click buttons, validate)
 * 2. backend-testing    - API testing + browser validation  
 * 3. browser-automation - General-purpose browser automation
 * 
 * @module api/agents
 */

import express from 'express';
import { chromium } from 'playwright';

const router = express.Router();

/* ─────────────────────────────────────────────────────────────────────────────
 * SHARED BROWSER INSTANCE
 * ───────────────────────────────────────────────────────────────────────────── */

let browser = null;

/**
 * Get or create the Playwright browser instance.
 * @returns {Promise<Browser>} Playwright browser
 */
export async function getBrowser() {
  if (!browser) {
    console.log('🤖 [Agents] Launching Playwright browser...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    console.log('✅ [Agents] Playwright browser ready');
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
 * HELPER: Execute Playwright Actions
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Execute a series of browser actions and return results.
 * @param {Array} actions - Array of actions to perform
 * @param {string} baseUrl - Base URL for the app (default: http://localhost:5173)
 * @returns {Promise<Object>} Results of all actions
 */
export async function executeActions(actions, baseUrl = 'http://localhost:5173') {
  const browserInstance = await getBrowser();
  const context = await browserInstance.newContext({ 
    viewport: { width: 1280, height: 720 } 
  });
  const page = await context.newPage();
  
  const results = [];
  const screenshots = [];
  const consoleErrors = [];
  
  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', error => {
    consoleErrors.push(`[PAGE ERROR] ${error.message}`);
  });
  
  try {
    for (const action of actions) {
      const result = await executeSingleAction(page, action, baseUrl);
      results.push(result);
      
      // Take screenshot after action if requested
      if (action.screenshot) {
        const screenshotBuffer = await page.screenshot({ type: 'png' });
        screenshots.push({
          afterAction: action.type,
          image: screenshotBuffer.toString('base64')
        });
      }
      
      // Stop if action failed and stopOnError is true
      if (!result.success && action.stopOnError !== false) {
        break;
      }
    }
    
    // Final screenshot
    const finalScreenshot = await page.screenshot({ type: 'png' });
    screenshots.push({
      final: true,
      image: finalScreenshot.toString('base64')
    });
    
  } finally {
    await context.close();
  }
  
  return {
    success: results.every(r => r.success),
    results,
    screenshots,
    consoleErrors,
    totalActions: actions.length,
    successfulActions: results.filter(r => r.success).length
  };
}

/**
 * Execute a single browser action.
 */
async function executeSingleAction(page, action, baseUrl) {
  const startTime = Date.now();
  
  try {
    switch (action.type) {
      case 'goto':
        const url = action.url.startsWith('http') ? action.url : `${baseUrl}${action.url}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        return { success: true, type: 'goto', url, duration: Date.now() - startTime };
        
      case 'fill':
        await page.fill(action.selector, action.value);
        return { success: true, type: 'fill', selector: action.selector, duration: Date.now() - startTime };
        
      case 'click':
        await page.click(action.selector);
        return { success: true, type: 'click', selector: action.selector, duration: Date.now() - startTime };

      case 'wait':
        await page.waitForTimeout(action.ms || 1000);
        return { success: true, type: 'wait', ms: action.ms, duration: Date.now() - startTime };

      case 'waitForSelector':
        await page.waitForSelector(action.selector, { timeout: action.timeout || 10000 });
        return { success: true, type: 'waitForSelector', selector: action.selector, duration: Date.now() - startTime };

      case 'waitForNavigation':
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
        return { success: true, type: 'waitForNavigation', duration: Date.now() - startTime };

      case 'type':
        await page.type(action.selector, action.value, { delay: action.delay || 50 });
        return { success: true, type: 'type', selector: action.selector, duration: Date.now() - startTime };

      case 'select':
        await page.selectOption(action.selector, action.value);
        return { success: true, type: 'select', selector: action.selector, value: action.value, duration: Date.now() - startTime };

      case 'check':
        await page.check(action.selector);
        return { success: true, type: 'check', selector: action.selector, duration: Date.now() - startTime };

      case 'uncheck':
        await page.uncheck(action.selector);
        return { success: true, type: 'uncheck', selector: action.selector, duration: Date.now() - startTime };

      case 'hover':
        await page.hover(action.selector);
        return { success: true, type: 'hover', selector: action.selector, duration: Date.now() - startTime };

      case 'press':
        await page.press(action.selector || 'body', action.key);
        return { success: true, type: 'press', key: action.key, duration: Date.now() - startTime };

      case 'assertText':
        const textContent = await page.textContent(action.selector);
        const hasText = textContent && textContent.includes(action.expected);
        return {
          success: hasText,
          type: 'assertText',
          selector: action.selector,
          expected: action.expected,
          actual: textContent?.substring(0, 200),
          duration: Date.now() - startTime
        };

      case 'assertVisible':
        const isVisible = await page.isVisible(action.selector);
        return {
          success: isVisible === (action.expected !== false),
          type: 'assertVisible',
          selector: action.selector,
          visible: isVisible,
          duration: Date.now() - startTime
        };

      case 'assertUrl':
        const currentUrl = page.url();
        const urlMatches = action.contains
          ? currentUrl.includes(action.contains)
          : currentUrl === action.expected;
        return {
          success: urlMatches,
          type: 'assertUrl',
          expected: action.expected || action.contains,
          actual: currentUrl,
          duration: Date.now() - startTime
        };

      case 'getText':
        const text = await page.textContent(action.selector);
        return { success: true, type: 'getText', selector: action.selector, text, duration: Date.now() - startTime };

      case 'getAttribute':
        const attr = await page.getAttribute(action.selector, action.attribute);
        return { success: true, type: 'getAttribute', selector: action.selector, attribute: action.attribute, value: attr, duration: Date.now() - startTime };

      case 'getInputValue':
        const inputValue = await page.inputValue(action.selector);
        return { success: true, type: 'getInputValue', selector: action.selector, value: inputValue, duration: Date.now() - startTime };

      case 'count':
        const elements = await page.$$(action.selector);
        return { success: true, type: 'count', selector: action.selector, count: elements.length, duration: Date.now() - startTime };

      default:
        return { success: false, type: action.type, error: `Unknown action type: ${action.type}` };
    }
  } catch (error) {
    return {
      success: false,
      type: action.type,
      selector: action.selector,
      error: error.message,
      duration: Date.now() - startTime
    };
  }
}


/* ─────────────────────────────────────────────────────────────────────────────
 * ENDPOINT: Frontend Testing Agent
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/agents/frontend-test
 *
 * Run UI tests with Playwright. Supports form filling, clicking, assertions.
 *
 * Body:
 * - actions: Array of actions to perform
 * - baseUrl: Base URL (default: http://localhost:5173)
 */
router.post('/agents/frontend-test', async (req, res) => {
  try {
    const { actions, baseUrl = 'http://localhost:5173' } = req.body || {};

    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: 'actions array is required' });
    }

    console.log(`🧪 [Frontend Test] Running ${actions.length} actions...`);

    const result = await executeActions(actions, baseUrl);

    console.log(`✅ [Frontend Test] Complete: ${result.successfulActions}/${result.totalActions} actions passed`);

    res.json(result);
  } catch (error) {
    console.error('❌ [Frontend Test] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


/* ─────────────────────────────────────────────────────────────────────────────
 * ENDPOINT: Backend Testing Agent
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/agents/backend-test
 *
 * Test backend APIs and optionally verify results in browser.
 *
 * Body:
 * - apiTests: Array of API test configurations
 * - browserActions: Optional browser actions to verify UI after API calls
 */
router.post('/agents/backend-test', async (req, res) => {
  try {
    const { apiTests = [], browserActions = [], baseUrl = 'http://localhost:5173' } = req.body || {};

    console.log(`🔧 [Backend Test] Running ${apiTests.length} API tests...`);

    const apiResults = [];

    // Run API tests
    for (const test of apiTests) {
      const apiResult = await executeApiTest(test);
      apiResults.push(apiResult);
    }

    // Run browser verification if provided
    let browserResults = null;
    if (browserActions.length > 0) {
      console.log(`🌐 [Backend Test] Running ${browserActions.length} browser verifications...`);
      browserResults = await executeActions(browserActions, baseUrl);
    }

    const allApiPassed = apiResults.every(r => r.success);
    const allBrowserPassed = !browserResults || browserResults.success;

    console.log(`✅ [Backend Test] Complete: API ${allApiPassed ? 'PASS' : 'FAIL'}, Browser ${browserResults ? (allBrowserPassed ? 'PASS' : 'FAIL') : 'N/A'}`);

    res.json({
      success: allApiPassed && allBrowserPassed,
      apiResults,
      browserResults,
      summary: {
        apiTests: apiResults.length,
        apiPassed: apiResults.filter(r => r.success).length,
        browserActions: browserActions.length,
        browserPassed: browserResults?.successfulActions || 0
      }
    });
  } catch (error) {
    console.error('❌ [Backend Test] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Execute a single API test.
 */
async function executeApiTest(test) {
  const startTime = Date.now();

  try {
    const { method = 'GET', url, body, headers = {}, expectedStatus = 200, expectedBody } = test;

    const fetchOptions = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    const responseBody = await response.json().catch(() => null);

    const statusMatch = response.status === expectedStatus;
    let bodyMatch = true;

    if (expectedBody) {
      bodyMatch = Object.keys(expectedBody).every(key =>
        responseBody && responseBody[key] === expectedBody[key]
      );
    }

    return {
      success: statusMatch && bodyMatch,
      method,
      url,
      status: response.status,
      expectedStatus,
      statusMatch,
      bodyMatch,
      responseBody,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      method: test.method,
      url: test.url,
      error: error.message,
      duration: Date.now() - startTime
    };
  }
}


/* ─────────────────────────────────────────────────────────────────────────────
 * ENDPOINT: Browser Automation Agent
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * POST /api/agents/browser-automate
 *
 * General-purpose browser automation. Can do anything a human can do.
 *
 * Body:
 * - actions: Array of actions (same as frontend-test)
 * - script: Optional raw Playwright script (advanced)
 */
router.post('/agents/browser-automate', async (req, res) => {
  try {
    const { actions, script, baseUrl = 'http://localhost:5173' } = req.body || {};

    // If script is provided, execute it directly (advanced mode)
    if (script) {
      console.log(`🤖 [Browser Automate] Executing custom script...`);
      const result = await executeCustomScript(script, baseUrl);
      return res.json(result);
    }

    // Otherwise use action-based automation
    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: 'Either actions array or script is required' });
    }

    console.log(`🤖 [Browser Automate] Running ${actions.length} actions...`);

    const result = await executeActions(actions, baseUrl);

    console.log(`✅ [Browser Automate] Complete: ${result.successfulActions}/${result.totalActions} actions`);

    res.json(result);
  } catch (error) {
    console.error('❌ [Browser Automate] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Execute a custom Playwright script (advanced users).
 */
async function executeCustomScript(script, baseUrl) {
  const browserInstance = await getBrowser();
  const context = await browserInstance.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const logs = [];
  const screenshots = [];

  try {
    // Create a safe execution context
    const scriptFunction = new Function('page', 'context', 'baseUrl', 'log', 'screenshot', `
      return (async () => {
        ${script}
      })();
    `);

    const log = (msg) => logs.push(msg);
    const screenshot = async (name) => {
      const buffer = await page.screenshot({ type: 'png' });
      screenshots.push({ name, image: buffer.toString('base64') });
    };

    const result = await scriptFunction(page, context, baseUrl, log, screenshot);

    // Take final screenshot
    const finalBuffer = await page.screenshot({ type: 'png' });
    screenshots.push({ name: 'final', image: finalBuffer.toString('base64') });

    await context.close();

    return {
      success: true,
      logs,
      screenshots,
      result
    };
  } catch (error) {
    await context.close();
    return {
      success: false,
      error: error.message,
      logs,
      screenshots
    };
  }
}


/* ─────────────────────────────────────────────────────────────────────────────
 * HEALTH CHECK
 * ───────────────────────────────────────────────────────────────────────────── */

router.get('/agents/health', async (req, res) => {
  try {
    const browserInstance = await getBrowser();
    res.json({
      success: true,
      browserReady: !!browserInstance,
      agents: ['frontend-test', 'backend-test', 'browser-automate'],
      message: 'All agents ready'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


export default router;



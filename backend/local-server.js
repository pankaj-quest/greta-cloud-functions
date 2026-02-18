/**
 * Local Development Server
 * Full AI chat with OpenRouter API (same as Cloud Run)
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 8000;

// MongoDB Atlas connection
const MONGO_URL = process.env.MONGO_URL || '';
const DB_NAME = 'chat-testing';

// GCP Config
const GCP_PROJECT = 'velosapps-464607';
const GCP_REGION = 'us-central1';
const GCS_BUCKET = 'greta-projects';

// OpenRouter API Key (set this in your environment!)
const OPEN_ROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY || '';

let db = null;

async function connectMongo() {
  if (db) return db;
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('✅ Connected to MongoDB Atlas');
  return db;
}

// OpenRouter client
const createOpenRouterClient = (apiKey) => {
  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: apiKey || OPEN_ROUTER_API_KEY,
    defaultHeaders: {
      'HTTP-Referer': 'https://greta.questera.ai',
      'X-Title': 'Greta-Agentic-Chat',
    },
  });
};

// Load emergent system prompt from file
let SYSTEM_PROMPT = '';
try {
  const promptPath = path.join(__dirname, 'emergent-system-prompt.txt');
  if (fs.existsSync(promptPath)) {
    SYSTEM_PROMPT = fs.readFileSync(promptPath, 'utf-8');
    console.log(`✅ Loaded Emergent system prompt (${SYSTEM_PROMPT.length} chars)`);
  } else {
    console.log('⚠️ emergent-system-prompt.txt not found, using fallback');
    SYSTEM_PROMPT = `You are Greta, an expert AI assistant that helps users build full-stack applications.`;
  }
} catch (err) {
  console.error('Error loading system prompt:', err.message);
  SYSTEM_PROMPT = `You are Greta, an expert AI assistant that helps users build full-stack applications.`;
}

// PROJECT_DIR for tool executors - points to the Cloud Run container's project
// For local dev, this would be different per chat
const getProjectDir = (chatId) => {
  // Each chat has its own Cloud Run container at /app/project
  // For local testing, we could use a local directory
  return `/app/project`;
};

// Tools in OpenRouter/OpenAI function calling format
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'mcp_view_file',
      description: 'View file or directory contents',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file or directory' },
          view_range: { type: 'array', items: { type: 'integer' }, description: 'Optional [start, end] line range' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_create_file',
      description: 'Create or overwrite a file with content',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
          file_text: { type: 'string', description: 'Content for the file' }
        },
        required: ['path', 'file_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_bulk_file_writer',
      description: 'PREFERRED for creating/updating 2+ files. Write multiple files in ONE call instead of multiple mcp_create_file calls. Example: files=[{path:"/app/project/frontend/src/A.tsx",content:"..."},{path:"/app/project/frontend/src/B.tsx",content:"..."}]. ALWAYS use this when creating multiple files.',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            description: 'Array of files to write. REQUIRED - must not be empty!',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, content: { type: 'string' } },
              required: ['path', 'content']
            }
          }
        },
        required: ['files']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_search_replace',
      description: 'Search and replace in a file. For MULTIPLE replacements in same file: either (1) set replace_all=true to replace ALL occurrences at once, or (2) rewrite the whole file with mcp_create_file. NEVER call this 5+ times on same file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
          old_str: { type: 'string', description: 'Exact string to find' },
          new_str: { type: 'string', description: 'Replacement string' },
          replace_all: { type: 'boolean', description: 'If true, replaces ALL occurrences. Use this for repeated patterns!' }
        },
        required: ['path', 'old_str', 'new_str']
      }
    }
  },
  // TEMPORARILY DISABLED - execute_bash was causing issues with AI trying to install pre-installed packages
  // {
  //   type: 'function',
  //   function: {
  //     name: 'execute_bash',
  //     description: 'Execute a bash command',
  //     parameters: {
  //       type: 'object',
  //       properties: {
  //         command: { type: 'string', description: 'The bash command to execute' }
  //       },
  //       required: ['command']
  //     }
  //   }
  // },
  {
    type: 'function',
    function: {
      name: 'mcp_add_dependency',
      description: 'Install an npm package to the frontend project. Use this when you need to add a new dependency like axios, lodash, date-fns, etc. First install takes ~30 seconds, subsequent installs are fast (~8 seconds).',
      parameters: {
        type: 'object',
        properties: {
          packageName: { type: 'string', description: 'Name of the npm package to install (e.g., "axios", "lodash", "date-fns")' },
          isDev: { type: 'boolean', description: 'If true, install as devDependency (--save-dev). Default is false.' }
        },
        required: ['packageName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_add_python_dependency',
      description: 'Install a Python package to the backend project. Use this when you need to add a new dependency like pyjwt, bcrypt, requests, etc. The package will be installed via pip and added to requirements.txt automatically.',
      parameters: {
        type: 'object',
        properties: {
          packageName: { type: 'string', description: 'Name of the Python package to install (e.g., "pyjwt", "bcrypt", "requests", "pillow")' },
          version: { type: 'string', description: 'Optional specific version to install (e.g., "2.8.0"). If not provided, installs latest.' }
        },
        required: ['packageName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_get_backend_logs',
      description: 'Get Python/FastAPI backend logs and errors. Use this to debug 500 errors, Pydantic validation errors, import errors, or any backend crashes. Returns recent stdout/stderr from the backend process.',
      parameters: {
        type: 'object',
        properties: {
          clear: { type: 'boolean', description: 'If true, clears logs after reading. Default is false.' }
        },
        required: []
      }
    }
  },
];

// ============ TOOL EXECUTORS ============
// Helper: Safe path resolution - for Cloud Run the PROJECT_DIR is /app/project
// For local dev, we proxy tool calls to the Cloud Run container

const resolveSafePath = (inputPath, projectDir) => {
  // Remove /app/project prefix if present (LLM might include full path)
  let cleanPath = inputPath.replace(/^\/app\/project\/?/, '');
  // Also handle paths starting with frontend/ or backend/ directly
  const normalized = path.normalize(cleanPath).replace(/^(\.\.[\/\\])+/, '');
  return path.join(projectDir, normalized);
}; 

// Tool executor functions - execute on the Cloud Run container via HTTP
// Cloud Run endpoints are: /api/read-file, /api/write-file, /api/bulk-write-files, etc.
const createToolExecutors = (cloudRunUrl) => ({
  // View file or directory - uses GET /api/read-file
  async mcp_view_file({ path: filePath, view_range }) {
    try {
      const params = new URLSearchParams({ path: filePath });
      if (view_range) params.append('view_range', JSON.stringify(view_range));
      const response = await fetch(`${cloudRunUrl}/api/read-file?${params}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      return await response.json();
    } catch (err) {
      return { error: `Failed to call Cloud Run: ${err.message}` };
    }
  },

  // Create/write file - uses POST /api/write-file
  async mcp_create_file({ path: filePath, file_text }) {
    try {
      const response = await fetch(`${cloudRunUrl}/api/write-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, file_text })
      });
      return await response.json();
    } catch (err) {
      return { error: `Failed to call Cloud Run: ${err.message}` };
    }
  },

  // Bulk write files - uses POST /api/bulk-write-files
  async mcp_bulk_file_writer({ files }) {
    try {
      const response = await fetch(`${cloudRunUrl}/api/bulk-write-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files })
      });
      return await response.json();
    } catch (err) {
      return { error: `Failed to call Cloud Run: ${err.message}` };
    }
  },

  // Search and replace - uses POST /api/search-replace
  async mcp_search_replace({ path: filePath, old_str, new_str, replace_all }) {
    try {
      const response = await fetch(`${cloudRunUrl}/api/search-replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, old_str, new_str, replace_all })
      });
      return await response.json();
    } catch (err) {
      return { error: `Failed to call Cloud Run: ${err.message}` };
    }
  },

  // TEMPORARILY DISABLED - execute_bash
  // async execute_bash({ command }) {
  //   try {
  //     const response = await fetch(`${cloudRunUrl}/api/execute-bash`, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ command })
  //     });
  //     return await response.json();
  //   } catch (err) {
  //     return { error: `Failed to call Cloud Run: ${err.message}` };
  //   }
  // }

  // Add npm dependency - uses POST /api/add-dependency
  async mcp_add_dependency({ packageName, isDev = false }) {
    try {
      const response = await fetch(`${cloudRunUrl}/api/add-dependency`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName, isDev })
      });
      return await response.json();
    } catch (err) {
      return { error: `Failed to call Cloud Run: ${err.message}` };
    }
  },

  // Add Python dependency - uses POST /api/add-python-dependency
  async mcp_add_python_dependency({ packageName, version }) {
    try {
      const response = await fetch(`${cloudRunUrl}/api/add-python-dependency`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName, version })
      });
      return await response.json();
    } catch (err) {
      return { error: `Failed to call Cloud Run: ${err.message}` };
    }
  },

  // Get backend logs - uses GET /api/backend-logs
  async mcp_get_backend_logs({ clear = false }) {
    try {
      const params = new URLSearchParams();
      if (clear) params.append('clear', 'true');
      params.append('limit', '50');

      const response = await fetch(`${cloudRunUrl}/api/backend-logs?${params}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();

      // Format errors nicely for the AI
      if (data.hasErrors && data.errors && data.errors.length > 0) {
        data.errorSummary = `⚠️ BACKEND ERRORS FOUND (${data.errorCount}):\n${data.errors.slice(0, 10).join('\n\n')}`;
      }

      return data;
    } catch (err) {
      return { error: `Failed to fetch backend logs: ${err.message}` };
    }
  }
});

// Tools that modify files and might cause Vite errors
const FILE_MODIFYING_TOOLS = ['mcp_create_file', 'mcp_bulk_file_writer', 'mcp_search_replace'];

// Extract clean error message from verbose Vite error
function cleanViteError(errorMsg) {
  if (!errorMsg) return null;

  // Extract the key error info - look for common patterns
  // Pattern 1: "Failed to resolve import X from Y"
  const importMatch = errorMsg.match(/Failed to resolve import ["']([^"']+)["'] from ["']([^"']+)["']/);
  if (importMatch) {
    return `Missing import: "${importMatch[1]}" in ${importMatch[2]}`;
  }

  // Pattern 2: "Expected X, got Y" (JSX syntax errors)
  const syntaxMatch = errorMsg.match(/Expected ['"]?([^'"]+)['"]?, got ['"]?([^'"]+)['"]?/);
  if (syntaxMatch) {
    const fileMatch = errorMsg.match(/File: ([^\n]+)/);
    const file = fileMatch ? fileMatch[1].replace('/app/project/frontend/', '') : 'unknown';
    return `Syntax error in ${file}: Expected ${syntaxMatch[1]}, got ${syntaxMatch[2]}`;
  }

  // Pattern 3: Pre-transform error
  const preTransformMatch = errorMsg.match(/\[vite\] (?:Pre-transform error|Internal server error): (.+?)(?:\n|$)/);
  if (preTransformMatch) {
    return preTransformMatch[1].slice(0, 150);
  }

  // Pattern 4: General error - just get first line
  const firstLine = errorMsg.split('\n')[0];
  if (firstLine.length > 150) {
    return firstLine.slice(0, 150) + '...';
  }
  return firstLine;
}

// Fetch Vite console logs (especially errors) from Cloud Run container
async function fetchViteLogs(cloudRunUrl) {
  try {
    const response = await fetch(`${cloudRunUrl}/api/console-logs?type=errors&clear=true`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();

    // Clean up the error messages to remove stack traces
    if (data && data.rawLogs && data.rawLogs.length > 0) {
      // Get unique clean errors (deduplicate)
      const seenErrors = new Set();
      const cleanErrors = [];

      for (const log of data.rawLogs) {
        const cleanMsg = cleanViteError(log.message);
        if (cleanMsg && !seenErrors.has(cleanMsg)) {
          seenErrors.add(cleanMsg);
          cleanErrors.push(cleanMsg);
        }
      }

      data.cleanErrors = cleanErrors;
    }

    return data;
  } catch (err) {
    console.log(`[Vite Logs] Failed to fetch: ${err.message}`);
    return null;
  }
}

// Execute a tool call
async function executeTool(toolExecutors, name, input, cloudRunUrl) {
  console.log(`[Tool Call] ${name}`, JSON.stringify(input).slice(0, 200));
  const executor = toolExecutors[name];
  if (!executor) return { error: `Unknown tool: ${name}` };
  const result = await executor(input);
  console.log(`[Tool Result] ${name}:`, JSON.stringify(result).slice(0, 300));

  // For file-modifying tools, wait a moment for Vite to process and then check for errors
  if (FILE_MODIFYING_TOOLS.includes(name) && cloudRunUrl) {
    // Wait for Vite to process the file change
    await new Promise(resolve => setTimeout(resolve, 1500));

    const viteLogs = await fetchViteLogs(cloudRunUrl);
    if (viteLogs && viteLogs.hasErrors && viteLogs.cleanErrors && viteLogs.cleanErrors.length > 0) {
      const errors = viteLogs.cleanErrors.slice(0, 5); // Limit to 5 unique errors
      console.log(`[Vite Errors] Found ${errors.length} errors after ${name}:`, errors);
      // Attach clean Vite errors to the result so AI can see and fix them
      result.vite_errors = errors;
      result.vite_error_message = `⚠️ VITE BUILD ERROR! Fix these before proceeding:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}`;
    }
  }

  return result;
}

// Helper: Save message to MongoDB (supports tool_calls and tool_call_id)
async function saveMessage(db, chatId, role, content, extras = {}) {
  const doc = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    conversation_id: chatId,
    role,
    content,
    sender: role === 'user' ? 'user' : (role === 'tool' ? 'tool' : 'bot'),
    timestamp: new Date().toISOString(),
    ...extras
  };
  await db.collection('messages').insertOne(doc);
}

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB on startup
connectMongo().catch(console.error);

// ============ CONVERSATION ENDPOINTS ============

// GET /api/conversations - List all conversations
app.get('/api/conversations', async (req, res) => {
  try {
    const db = await connectMongo();
    const conversations = await db.collection('conversations')
      .find({})
      .sort({ updated_at: -1 })
      .toArray();
    res.json(conversations);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:chatId - Get single conversation
app.get('/api/conversations/:chatId', async (req, res) => {
  try {
    const db = await connectMongo();
    const convo = await db.collection('conversations').findOne({ id: req.params.chatId });
    if (!convo) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations - Create new conversation AND deploy Cloud Run container
app.post('/api/conversations', async (req, res) => {
  try {
    const { title, initial_prompt } = req.body;
    const chatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const serviceName = `greta-${chatId}`;

    const db = await connectMongo();
    const convo = {
      id: chatId,
      title: title || `Project ${chatId.slice(0, 8)}`,
      status: 'creating',
      preview_url: `https://${serviceName}-671515087993.${GCP_REGION}.run.app`,
      initial_prompt: initial_prompt || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await db.collection('conversations').insertOne(convo);
    console.log(`✅ Created conversation: ${chatId}`);

    // Respond immediately so UI doesn't wait
    res.json(convo);

    // Deploy Cloud Run container in background
    deployCloudRunContainer(chatId, serviceName, db);

  } catch (err) {
    console.error('Error creating conversation:', err);
    res.status(500).json({ error: err.message });
  }
});

// Deploy Cloud Run container for a chat
async function deployCloudRunContainer(chatId, serviceName, db) {
  console.log(`🚀 Deploying Cloud Run container: ${serviceName}...`);

  const image = `gcr.io/${GCP_PROJECT}/greta-agentic:test`;
  const envVars = `PROJECT_ID=${chatId},GCS_BUCKET=${GCS_BUCKET},MONGO_URL=${MONGO_URL},DB_NAME=${DB_NAME}`;

  const cmd = `gcloud run deploy ${serviceName} --image=${image} --region=${GCP_REGION} --allow-unauthenticated --set-env-vars="${envVars}" --memory=4Gi --cpu=2 --timeout=3600 --min-instances=0 --max-instances=1 --execution-environment=gen2 --project=${GCP_PROJECT}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 300000 }); // 5 min timeout
    console.log(`✅ Container deployed: ${serviceName}`);
    console.log(stdout);

    // Update conversation status
    await db.collection('conversations').updateOne(
      { id: chatId },
      { $set: { status: 'running', updated_at: new Date().toISOString() } }
    );
  } catch (err) {
    console.error(`❌ Failed to deploy container: ${err.message}`);
    await db.collection('conversations').updateOne(
      { id: chatId },
      { $set: { status: 'error', error: err.message, updated_at: new Date().toISOString() } }
    );
  }
}

// GET /api/conversations/:chatId/messages - Get messages
app.get('/api/conversations/:chatId/messages', async (req, res) => {
  try {
    const db = await connectMongo();
    const messages = await db.collection('messages')
      .find({ conversation_id: req.params.chatId })
      .sort({ timestamp: 1 })
      .toArray();
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat - Real AI chat endpoint with OpenRouter + Tool Calling + Agentic Loop
app.post('/api/chat', async (req, res) => {
  const {
    message,
    chat_uuid,
    model = 'google/gemini-3-flash-preview',
    max_tokens = 32000,  // Increased for large tool calls
    temperature = 0.8,
    api_key
  } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const chatId = chat_uuid || `chat-${Date.now()}`;
  console.log(`\n========== NEW CHAT REQUEST ==========`);
  console.log(`[Chat API] chatId: ${chatId}`);
  console.log(`[Chat API] model: ${model}`);
  console.log(`[Chat API] message: ${message.slice(0, 100)}...`);

  // Check if API key is available
  const effectiveApiKey = api_key || OPEN_ROUTER_API_KEY;
  if (!effectiveApiKey) {
    return res.status(400).json({
      error: 'OpenRouter API key required. Set OPEN_ROUTER_API_KEY env var or pass api_key in request body.'
    });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendSSE = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const db = await connectMongo();

    // Get Cloud Run URL for this chat (for tool execution)
    const cloudRunUrl = `https://greta-${chatId}-671515087993.${GCP_REGION}.run.app`;
    const toolExecutors = createToolExecutors(cloudRunUrl);
    console.log(`[Chat API] Cloud Run URL for tools: ${cloudRunUrl}`);

    // Save user message
    await saveMessage(db, chatId, 'user', message);

    // Get project file structure from Cloud Run
    let projectStructure = '';
    try {
      const structureRes = await fetch(`${cloudRunUrl}/api/list-files`);
      if (structureRes.ok) {
        const structureData = await structureRes.json();
        if (structureData.files && structureData.files.length > 0) {
          // Format as tree-like structure
          const fileList = structureData.files.join('\n');
          projectStructure = `\n\n<CURRENT_PROJECT_FILES>\nThese files currently exist in the project. DO NOT waste loops viewing files you've already seen - use this list to know what exists:\n\n${fileList}\n</CURRENT_PROJECT_FILES>\n`;
          console.log(`[Chat API] Project has ${structureData.files.length} files`);
        }
      }
    } catch (err) {
      console.log('[Chat API] Could not fetch project structure:', err.message);
    }

    // Load chat history (including tool calls and results)
    const dbMessages = await db.collection('messages')
      .find({ conversation_id: chatId })
      .sort({ timestamp: 1 })
      .toArray();

    const history = dbMessages.map(msg => {
      const base = { role: msg.role, content: msg.content };
      // Include tool_calls for assistant messages that have them
      if (msg.tool_calls) {
        base.tool_calls = msg.tool_calls;
      }
      // Include tool_call_id for tool result messages
      if (msg.tool_call_id) {
        base.tool_call_id = msg.tool_call_id;
      }
      return base;
    });

    // Create OpenRouter client
    const client = createOpenRouterClient(effectiveApiKey);

    // Build messages array for LLM - include project structure in system prompt
    const enhancedSystemPrompt = SYSTEM_PROMPT + projectStructure;
    const messages = [
      { role: 'system', content: enhancedSystemPrompt },
      ...history
    ];

    // ============ DEBUG: LOG FULL CONTEXT BEING SENT TO AI ============
    console.log('\n' + '='.repeat(80));
    console.log('[AI CONTEXT] Full payload being sent to OpenRouter:');
    console.log('='.repeat(80));
    console.log(`[AI CONTEXT] Model: ${model}`);
    console.log(`[AI CONTEXT] Max Tokens: ${max_tokens}`);
    console.log(`[AI CONTEXT] Temperature: ${temperature}`);
    console.log(`[AI CONTEXT] Tools: ${TOOLS.map(t => t.function.name).join(', ')}`);
    console.log('-'.repeat(80));
    console.log(`[AI CONTEXT] System Prompt Length: ${enhancedSystemPrompt.length} chars (base: ${SYSTEM_PROMPT.length} + project structure)`);
    console.log(`[AI CONTEXT] Project Structure Included: ${projectStructure ? 'YES' : 'NO'}`);
    console.log('-'.repeat(80));
    console.log(`[AI CONTEXT] Conversation History: ${history.length} messages`);
    history.forEach((msg, i) => {
      const contentPreview = typeof msg.content === 'string'
        ? msg.content.substring(0, 200) + (msg.content.length > 200 ? '...' : '')
        : JSON.stringify(msg.content).substring(0, 200);
      console.log(`  [${i}] ${msg.role}: ${contentPreview}`);
    });
    console.log('-'.repeat(80));
    console.log(`[AI CONTEXT] Total Messages: ${messages.length} (1 system + ${history.length} history)`);
    console.log('='.repeat(80) + '\n');

    console.log(`[Chat API] Starting with ${messages.length} messages`);

    // ============ AGENTIC LOOP ============
    // Allow up to 20 loops for complex tasks
    const maxLoops = 20;
    let loopCount = 0;

    while (loopCount < maxLoops) {
      loopCount++;
      console.log(`[Chat API] Loop ${loopCount}/${maxLoops}`);

      // Create streaming chat completion WITH TOOLS
      const stream = await client.chat.completions.create({
        model,
        max_tokens,
        messages,
        tools: TOOLS,
        temperature,
        stream: true
      });

      // Process stream
      let currentText = '';
      const toolCalls = new Map();

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Handle text content
        if (delta.content) {
          currentText += delta.content;
          sendSSE({ type: 'chunk', content: delta.content });
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;
            if (!toolCalls.has(index)) {
              toolCalls.set(index, {
                id: toolCall.id || `tool_${index}`,
                name: toolCall.function?.name || '',
                arguments: ''
              });
            }
            const current = toolCalls.get(index);
            if (toolCall.function?.name) current.name = toolCall.function.name;
            if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments;
          }
        }
      }

      // Process tool calls if any
      if (toolCalls.size > 0) {
        const toolCallsArray = [];
        for (const [, tc] of toolCalls) {
          let parsedArgs = {};
          try {
            parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {};
          } catch (e) {
            console.error('Failed to parse tool args for', tc.name);
            console.error('Args length:', tc.arguments?.length);
            console.error('Args start:', tc.arguments?.slice(0, 200));
            console.error('Args end:', tc.arguments?.slice(-200));
            // Try to salvage partial JSON for debugging
          }
          toolCallsArray.push({ id: tc.id, name: tc.name, input: parsedArgs });
        }

        console.log(`[Chat API] Got ${toolCallsArray.length} tool calls`);

        // Build tool_calls array for the message
        const toolCallsForMessage = toolCallsArray.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input) }
        }));

        // Add assistant message with tool calls to messages array
        messages.push({
          role: 'assistant',
          content: currentText || null,
          tool_calls: toolCallsForMessage
        });

        // Save assistant message with tool_calls to MongoDB
        await saveMessage(db, chatId, 'assistant', currentText || null, { tool_calls: toolCallsForMessage });

        // Execute tools and add results
        let hasFileChanges = false;
        for (const tc of toolCallsArray) {
          sendSSE({ type: 'tool_call', name: tc.name, input: tc.input });
          const result = await executeTool(toolExecutors, tc.name, tc.input, cloudRunUrl);
          sendSSE({ type: 'tool_result', name: tc.name, result });

          // Track if any file-modifying tools were called
          if (['mcp_create_file', 'mcp_bulk_file_writer', 'mcp_search_replace'].includes(tc.name)) {
            hasFileChanges = true;
          }

          const toolResultContent = typeof result === 'string' ? result : JSON.stringify(result);

          // Add to messages array
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolResultContent
          });

          // Save tool result to MongoDB
          await saveMessage(db, chatId, 'tool', toolResultContent, { tool_call_id: tc.id });
        }

        // Signal frontend to refresh preview if files were changed
        if (hasFileChanges) {
          sendSSE({ type: 'refresh_preview' });
        }

        // Continue loop for next LLM response
        continue;
      }

      // No tool calls - done, save assistant response to MongoDB
      console.log(`[Chat API] No tool calls, finishing with ${currentText.length} chars`);
      await saveMessage(db, chatId, 'assistant', currentText);
      break;
    }

    sendSSE({ type: 'done', chat_uuid: chatId, loops: loopCount });
    res.end();

  } catch (err) {
    console.error('[Chat API] Error:', err);
    sendSSE({ type: 'error', message: err.message });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Local backend running at http://localhost:${PORT}`);
  console.log(`📦 MongoDB: ${DB_NAME}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /api/conversations - Create conversation`);
  console.log(`  GET  /api/conversations - List conversations`);
  console.log(`  POST /api/chat - Send message\n`);
});


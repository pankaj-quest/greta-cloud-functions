/**
 * Chat API - Agentic chat with Emergent-compatible tools
 * Uses OpenRouter API with function calling
 * Persists conversations and messages to MongoDB Atlas
 */
import express from 'express';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { MongoClient } from 'mongodb';
import { PROJECT_DIR } from './config.js';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = express.Router();

// ============ MONGODB CONNECTION ============
const MONGO_URL = process.env.MONGO_URL || 'mongodb+srv://tmxsmoke:aminocentesis@cluster0.zmgremb.mongodb.net/chat-testing?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'chat-testing';

let db = null;
let mongoClient = null;

async function connectMongo() {
  if (db) return db;
  try {
    mongoClient = new MongoClient(MONGO_URL);
    await mongoClient.connect();
    db = mongoClient.db(DB_NAME);
    console.log('[Chat API] Connected to MongoDB Atlas');
    return db;
  } catch (err) {
    console.error('[Chat API] MongoDB connection error:', err.message);
    throw err;
  }
}

// Initialize MongoDB connection
connectMongo().catch(console.error);

// ============ MONGODB HELPERS ============

// Get or create conversation
async function getOrCreateConversation(chatId) {
  const db = await connectMongo();
  const conversations = db.collection('conversations');

  let convo = await conversations.findOne({ id: chatId });
  if (!convo) {
    convo = {
      id: chatId,
      title: `Project ${chatId.slice(0, 8)}`,
      status: 'running',
      preview_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    await conversations.insertOne(convo);
    console.log(`[Chat API] Created new conversation: ${chatId}`);
  }
  return convo;
}

// Get messages for a conversation
async function getMessages(chatId) {
  const db = await connectMongo();
  const messages = db.collection('messages');
  return await messages.find({ conversation_id: chatId }).sort({ timestamp: 1 }).toArray();
}

// Save a message
async function saveMessage(chatId, role, content) {
  const db = await connectMongo();
  const messages = db.collection('messages');
  const conversations = db.collection('conversations');

  const message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    conversation_id: chatId,
    role: role,
    content: content,
    sender: role === 'user' ? 'user' : 'bot',
    timestamp: new Date().toISOString()
  };

  await messages.insertOne(message);
  await conversations.updateOne(
    { id: chatId },
    { $set: { updated_at: new Date().toISOString() } }
  );

  return message;
}

// Convert DB messages to chat history format
function formatMessagesForLLM(dbMessages) {
  return dbMessages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
}

// Load the exact Emergent system prompt from file
let SYSTEM_PROMPT = '';
try {
  const promptPath = path.join(__dirname, 'emergent-system-prompt.txt');
  if (fs.existsSync(promptPath)) {
    SYSTEM_PROMPT = fs.readFileSync(promptPath, 'utf-8');
    console.log(`[Chat API] Loaded Emergent system prompt (${SYSTEM_PROMPT.length} chars)`);
  } else {
    console.log('[Chat API] emergent-system-prompt.txt not found, using fallback');
    SYSTEM_PROMPT = `You are E1, an expert AI assistant that helps users build full-stack applications.`;
  }
} catch (err) {
  console.error('[Chat API] Error loading system prompt:', err.message);
  SYSTEM_PROMPT = `You are E1, an expert AI assistant that helps users build full-stack applications.`;
}

// OpenRouter client
const createOpenRouterClient = (apiKey) => {
  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: apiKey || process.env.OPEN_ROUTER_API_KEY,
    defaultHeaders: {
      'HTTP-Referer': 'https://greta.questera.ai',
      'X-Title': 'Greta',
    },
  });
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
      description: 'Write multiple files at once',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, content: { type: 'string' } },
              required: ['path', 'content']
            }
          },
          capture_logs_backend: { type: 'boolean' },
          capture_logs_frontend: { type: 'boolean' },
          status: { type: 'boolean' }
        },
        required: ['files']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_search_replace',
      description: 'Search and replace exact string in a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
          old_str: { type: 'string', description: 'Exact string to find' },
          new_str: { type: 'string', description: 'Replacement string' },
          replace_all: { type: 'boolean' }
        },
        required: ['path', 'old_str', 'new_str']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_insert_text',
      description: 'Insert text at a specific line number',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          new_str: { type: 'string' },
          insert_line: { type: 'integer' }
        },
        required: ['path', 'new_str', 'insert_line']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mcp_glob_files',
      description: 'Find files matching a glob pattern',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern like **/*.tsx' },
          path: { type: 'string', description: 'Directory to search in' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_tool',
      description: 'Search file contents with regex',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search' },
          path: { type: 'string', description: 'Directory or file to search' },
          include: { type: 'string', description: 'File pattern filter like *.tsx' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_bash',
      description: 'Execute a bash command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' }
        },
        required: ['command']
      }
    }
  }
];



// ============ TOOL EXECUTORS ============
// Execute tools by calling Greta's internal file APIs

// Helper: Safe path resolution
const resolveSafePath = (inputPath) => {
  // Remove /app/project prefix if present (LLM might include full path)
  let cleanPath = inputPath.replace(/^\/app\/project\/?/, '');
  // Also handle paths starting with frontend/ or backend/ directly
  const normalized = path.normalize(cleanPath).replace(/^(\.\.[\/\\])+/, '');
  return path.join(PROJECT_DIR, normalized);
};

// Tool executor functions
const toolExecutors = {
  // View file or directory
  async mcp_view_file({ path: filePath, view_range }) {
    const safePath = resolveSafePath(filePath);
    try {
      const stat = fs.statSync(safePath);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(safePath);
        return { type: 'directory', path: filePath, contents: entries };
      }
      let content = fs.readFileSync(safePath, 'utf-8');
      if (view_range && Array.isArray(view_range) && view_range.length === 2) {
        const lines = content.split('\n');
        const [start, end] = view_range;
        content = lines.slice(start - 1, end).join('\n');
      }
      return { type: 'file', path: filePath, content };
    } catch (err) {
      return { error: err.message };
    }
  },

  // Create/write file
  async mcp_create_file({ path: filePath, file_text }) {
    const safePath = resolveSafePath(filePath);
    try {
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(safePath, file_text, 'utf-8');
      return { success: true, path: filePath, message: 'File written successfully' };
    } catch (err) {
      return { error: err.message };
    }
  },

  // Bulk write files
  async mcp_bulk_file_writer({ files, capture_logs_backend, capture_logs_frontend, status }) {
    const results = [];
    for (const file of files) {
      const safePath = resolveSafePath(file.path);
      try {
        const dir = path.dirname(safePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(safePath, file.content, 'utf-8');
        results.push({ path: file.path, success: true });
      } catch (err) {
        results.push({ path: file.path, success: false, error: err.message });
      }
    }
    return { files_written: results.length, results };
  },

  // Search and replace
  async mcp_search_replace({ path: filePath, old_str, new_str, replace_all }) {
    const safePath = resolveSafePath(filePath);
    try {
      let content = fs.readFileSync(safePath, 'utf-8');
      const count = (content.match(new RegExp(old_str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      if (count === 0) return { success: false, error: 'String not found' };
      content = replace_all
        ? content.replaceAll(old_str, new_str)
        : content.replace(old_str, new_str);
      fs.writeFileSync(safePath, content, 'utf-8');
      return { success: true, path: filePath, replacements: replace_all ? count : 1 };
    } catch (err) {
      return { error: err.message };
    }
  },

  // Insert text at line
  async mcp_insert_text({ path: filePath, new_str, insert_line }) {
    const safePath = resolveSafePath(filePath);
    try {
      const content = fs.readFileSync(safePath, 'utf-8');
      const lines = content.split('\n');
      lines.splice(insert_line, 0, new_str);
      fs.writeFileSync(safePath, lines.join('\n'), 'utf-8');
      return { success: true, path: filePath, inserted_at_line: insert_line };
    } catch (err) {
      return { error: err.message };
    }
  },

  // Glob files
  async mcp_glob_files({ pattern, path: basePath }) {
    const searchDir = basePath ? resolveSafePath(basePath) : PROJECT_DIR;
    try {
      const { glob } = await import('glob');
      const files = await glob(pattern, { cwd: searchDir, nodir: true });
      return { pattern, files, total_matches: files.length };
    } catch (err) {
      return { error: err.message };
    }
  },

  // Grep search
  async grep_tool({ pattern, path: searchPath, include }) {
    const searchDir = searchPath ? resolveSafePath(searchPath) : PROJECT_DIR;
    try {
      let cmd = `grep -rn "${pattern.replace(/"/g, '\\"')}" "${searchDir}"`;
      if (include) cmd += ` --include="${include}"`;
      const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
      const matches = stdout.trim().split('\n').filter(Boolean).slice(0, 50);
      return { pattern, matches, total_matches: matches.length };
    } catch (err) {
      if (err.code === 1) return { pattern, matches: [], total_matches: 0 };
      return { error: err.message };
    }
  },

  // Execute bash command
  async execute_bash({ command }) {
    const blocked = ['rm -rf /', 'mkfs', ':(){', 'dd if='];
    if (blocked.some(b => command.includes(b))) {
      return { error: 'Command blocked for safety' };
    }
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: PROJECT_DIR,
        timeout: 30000,
        maxBuffer: 5 * 1024 * 1024
      });
      return { stdout: stdout.slice(0, 10000), stderr: stderr.slice(0, 2000) };
    } catch (err) {
      return { error: err.message, stdout: err.stdout?.slice(0, 5000), stderr: err.stderr?.slice(0, 2000) };
    }
  }
};

// Execute a tool call
async function executeTool(name, input) {
  console.log(`[Tool Call] ${name}`, JSON.stringify(input).slice(0, 200));
  const executor = toolExecutors[name];
  if (!executor) return { error: `Unknown tool: ${name}` };
  try {
    return await executor(input);
  } catch (err) {
    return { error: err.message };
  }
}

// ============ CHAT ENDPOINT ============

// POST /api/chat - Main chat endpoint with streaming
router.post('/chat', async (req, res) => {
  const {
    message,
    chat_uuid,
    model = 'anthropic/claude-sonnet-4',
    max_tokens = 8192,
    temperature = 0.7,
    api_key
  } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const chatId = chat_uuid || `chat_${Date.now()}`;
  console.log(`[Chat API] New request - chatId: ${chatId}, model: ${model}`);

  // Get or create conversation in MongoDB
  await getOrCreateConversation(chatId);

  // Save user message to MongoDB
  await saveMessage(chatId, 'user', message);

  // Load chat history from MongoDB
  const dbMessages = await getMessages(chatId);
  const history = formatMessagesForLLM(dbMessages);

  // Setup SSE streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const client = createOpenRouterClient(api_key);

    // Format messages with system prompt
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history
    ];

    let loopCount = 0;
    const maxLoops = 10; // Max tool execution loops

    while (loopCount < maxLoops) {
      loopCount++;
      console.log(`[Chat API] Loop ${loopCount}`);

      // Create streaming chat completion
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

      // Build assistant message content
      const assistantContent = [];
      if (currentText) {
        assistantContent.push({ type: 'text', text: currentText });
      }

      // Process tool calls if any
      if (toolCalls.size > 0) {
        const toolCallsArray = [];
        for (const [, tc] of toolCalls) {
          let parsedArgs = {};
          try {
            parsedArgs = tc.arguments ? JSON.parse(tc.arguments) : {};
          } catch (e) {
            console.error('Failed to parse tool args:', tc.arguments);
          }
          toolCallsArray.push({ id: tc.id, name: tc.name, input: parsedArgs });
          assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: parsedArgs });
        }

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: currentText || null,
          tool_calls: toolCallsArray.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.input) }
          }))
        });
        history.push({ role: 'assistant', content: assistantContent });

        // Execute tools and add results
        for (const tc of toolCallsArray) {
          sendSSE({ type: 'tool_call', name: tc.name, input: tc.input });
          const result = await executeTool(tc.name, tc.input);
          sendSSE({ type: 'tool_result', name: tc.name, result });

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result)
          });
        }

        // Continue loop for next LLM response
        continue;
      }

      // No tool calls - done, save assistant response to MongoDB
      messages.push({ role: 'assistant', content: currentText });
      await saveMessage(chatId, 'assistant', currentText);
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

// GET /api/chat/history - Get chat history from MongoDB
router.get('/chat/history', async (req, res) => {
  const { chat_uuid } = req.query;
  if (!chat_uuid) {
    return res.status(400).json({ error: 'chat_uuid is required' });
  }
  try {
    const dbMessages = await getMessages(chat_uuid);
    const history = formatMessagesForLLM(dbMessages);
    res.json({ chat_uuid, history, message_count: history.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat/history - Clear chat history from MongoDB
router.delete('/chat/history', async (req, res) => {
  const { chat_uuid } = req.query;
  try {
    const db = await connectMongo();
    if (chat_uuid) {
      await db.collection('messages').deleteMany({ conversation_id: chat_uuid });
      res.json({ success: true, message: `Cleared history for ${chat_uuid}` });
    } else {
      await db.collection('messages').deleteMany({});
      res.json({ success: true, message: 'Cleared all chat histories' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ CONVERSATION ENDPOINTS ============

// GET /api/conversations - List all conversations
router.get('/conversations', async (req, res) => {
  try {
    const db = await connectMongo();
    const conversations = await db.collection('conversations')
      .find({})
      .sort({ updated_at: -1 })
      .toArray();
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:chatId - Get single conversation
router.get('/conversations/:chatId', async (req, res) => {
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

// POST /api/conversations - Create new conversation
router.post('/conversations', async (req, res) => {
  try {
    const { title, preview_url } = req.body;
    const chatId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const db = await connectMongo();
    const convo = {
      id: chatId,
      title: title || `Project ${chatId.slice(0, 8)}`,
      status: 'creating',
      preview_url: preview_url || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await db.collection('conversations').insertOne(convo);
    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/conversations/:chatId - Update conversation
router.patch('/conversations/:chatId', async (req, res) => {
  try {
    const { title, status, preview_url } = req.body;
    const db = await connectMongo();

    const updateData = { updated_at: new Date().toISOString() };
    if (title) updateData.title = title;
    if (status) updateData.status = status;
    if (preview_url) updateData.preview_url = preview_url;

    const result = await db.collection('conversations').updateOne(
      { id: req.params.chatId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const convo = await db.collection('conversations').findOne({ id: req.params.chatId });
    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/conversations/:chatId - Delete conversation and messages
router.delete('/conversations/:chatId', async (req, res) => {
  try {
    const db = await connectMongo();
    await db.collection('conversations').deleteOne({ id: req.params.chatId });
    await db.collection('messages').deleteMany({ conversation_id: req.params.chatId });
    res.json({ success: true, message: `Deleted conversation ${req.params.chatId}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:chatId/messages - Get messages for conversation
router.get('/conversations/:chatId/messages', async (req, res) => {
  try {
    const messages = await getMessages(req.params.chatId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
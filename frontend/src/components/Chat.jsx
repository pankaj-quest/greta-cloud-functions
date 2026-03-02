import { useState, useRef, useEffect } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import './Chat.css';
import CodeChangePanel from './CodeChangePanel';

const API_URL = '/api';
const MEDIA_UPLOAD_URL = 'https://addons.questera.ai/api/greta/media/upload';

// Cloud Run URL pattern (includes project number)
const getCloudRunUrl = (chatId) => `https://greta-${chatId}-671515087993.us-central1.run.app`;

function Chat() {
  const { chatId } = useParams();
  const location = useLocation();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [conversationTitle, setConversationTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [containerStatus, setContainerStatus] = useState('checking'); // checking, creating, running, error
  const [uploadedImage, setUploadedImage] = useState(null); // { url, fileName, previewUrl }
  const [uploading, setUploading] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(null); // { currentVersion, latestVersion }
  const [isUpdating, setIsUpdating] = useState(false);
  const [fileChanges, setFileChanges] = useState([]); // Real-time code changes
  const [showCodePanel, setShowCodePanel] = useState(false);
  const messagesEndRef = useRef(null);
  const initialPromptSent = useRef(false);
  const iframeRef = useRef(null);
  const fileInputRef = useRef(null);

  // Function to refresh the preview iframe
  const refreshPreview = () => {
    if (iframeRef.current) {
      // Force reload by re-setting the src
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = '';
      setTimeout(() => {
        iframeRef.current.src = currentSrc;
      }, 100);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Set Cloud Run URL
  useEffect(() => {
    const cloudRunUrl = getCloudRunUrl(chatId);
    setPreviewUrl(cloudRunUrl);
  }, [chatId]);

  // Keep-alive ping to Cloud Run container every 30 seconds
  useEffect(() => {
    if (!chatId || containerStatus !== 'running') return;

    const cloudRunUrl = getCloudRunUrl(chatId);

    // Ping function
    const pingKeepAlive = async () => {
      try {
        const response = await fetch(`${cloudRunUrl}/api/keepAlive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          const data = await response.json();
          console.log('[KeepAlive] ✓', data.timestamp);
        }
      } catch (error) {
        console.log('[KeepAlive] Failed:', error.message);
      }
    };

    // Initial ping
    pingKeepAlive();

    // Ping every 30 seconds
    const intervalId = setInterval(pingKeepAlive, 30000);

    // Cleanup on unmount or chatId change
    return () => {
      clearInterval(intervalId);
      console.log('[KeepAlive] Stopped for', chatId);
    };
  }, [chatId, containerStatus]);

  // Check for version updates when container is running
  useEffect(() => {
    if (!chatId || containerStatus !== 'running') return;

    const checkForUpdates = async () => {
      try {
        const cloudRunUrl = getCloudRunUrl(chatId);

        // Get current container version
        const healthResponse = await fetch(`${cloudRunUrl}/health`);
        if (!healthResponse.ok) return;
        const health = await healthResponse.json();
        const currentVersion = health.imageVersion || '0.0.0';

        // Get latest available version from backend
        const latestResponse = await fetch(`${API_URL}/latest-version`);
        if (!latestResponse.ok) return;
        const latest = await latestResponse.json();
        const latestVersion = latest.version || '0.0.0';

        console.log(`[Version Check] Current: ${currentVersion}, Latest: ${latestVersion}`);

        // Compare versions
        if (currentVersion !== latestVersion) {
          setUpdateAvailable({ currentVersion, latestVersion });
        } else {
          setUpdateAvailable(null);
        }
      } catch (error) {
        console.log('[Version Check] Failed:', error.message);
      }
    };

    // Check once when container becomes running
    checkForUpdates();
  }, [chatId, containerStatus]);

  // Handle update button click
  const handleUpdateContainer = async () => {
    if (isUpdating) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`${API_URL}/conversations/${chatId}/redeploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        setUpdateAvailable(null);
        setContainerStatus('creating');
        // Wait for container to be ready again
        await waitForContainer();
      } else {
        const error = await response.json();
        alert(`Update failed: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error updating container:', error);
      alert(`Update failed: ${error.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // Poll for container status until it's running
  const waitForContainer = async () => {
    const maxAttempts = 60; // 5 minutes max (every 5 seconds)
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`${API_URL}/conversations/${chatId}`);
        if (response.ok) {
          const convo = await response.json();
          console.log(`[Container Status] ${convo.status}`);

          if (convo.status === 'running') {
            setContainerStatus('running');
            return true;
          } else if (convo.status === 'error') {
            setContainerStatus('error');
            return false;
          }
          // Still creating, keep polling
          setContainerStatus('creating');
        }
      } catch (error) {
        console.error('Error checking container status:', error);
      }

      // Wait 5 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
    }

    setContainerStatus('error');
    return false;
  };

  // Fetch conversation and messages when chatId changes
  useEffect(() => {
    const loadChat = async () => {
      const convo = await fetchConversation();
      const existingMessages = await fetchMessages();

      // Only send initial prompt if:
      // 1. We have an initial prompt from navigation
      // 2. We haven't sent it already (ref check)
      // 3. There are no existing messages (fresh chat, not a refresh)
      if (location.state?.initialPrompt && !initialPromptSent.current && existingMessages.length === 0) {
        initialPromptSent.current = true;

        // Wait for container to be ready before sending the message
        if (convo?.status !== 'running') {
          setContainerStatus('creating');
          console.log('⏳ Waiting for container to be ready...');
          const isReady = await waitForContainer();
          if (!isReady) {
            console.error('Container failed to start');
            return;
          }
          console.log('✅ Container is ready!');
        }

        // Small delay then send the initial prompt
        setTimeout(() => {
          sendMessage(location.state.initialPrompt);
        }, 1000);
      } else {
        // Existing chat, assume container is running
        setContainerStatus('running');
      }
    };
    loadChat();
  }, [chatId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText]);

  // Fetch conversation details
  const fetchConversation = async () => {
    try {
      const response = await fetch(`${API_URL}/conversations/${chatId}`);
      if (response.ok) {
        const convo = await response.json();
        setConversationTitle(convo.title || `Project ${chatId.slice(0, 8)}`);
        // If conversation has a custom preview_url, use it; otherwise keep Cloud Run URL
        if (convo.preview_url && convo.preview_url !== getCloudRunUrl(chatId)) {
          setPreviewUrl(convo.preview_url);
        }
        return convo; // Return conversation data to check status
      }
      return null;
    } catch (error) {
      console.error('Error fetching conversation:', error);
      return null;
    }
  };

  // Fetch messages from MongoDB
  const fetchMessages = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/conversations/${chatId}/messages`);
      if (response.ok) {
        const data = await response.json();
        const mappedMessages = data.map(msg => {
          // Generate display text from tool_calls if content is null
          let displayText = msg.content;
          if (!displayText && msg.tool_calls && msg.tool_calls.length > 0) {
            const toolNames = msg.tool_calls.map(tc => {
              const name = tc.function?.name || tc.name || 'tool';
              // Make tool names more readable
              return name.replace('mcp_', '').replace(/_/g, ' ');
            });
            const uniqueTools = [...new Set(toolNames)];
            displayText = `🔧 ${uniqueTools.join(', ')}`;
          }
          return {
            id: msg.id,
            text: displayText || '(processing...)',
            sender: msg.sender,
            timestamp: new Date(msg.timestamp)
          };
        });
        setMessages(mappedMessages);
        return data; // Return original data to check length
      }
      return [];
    } catch (error) {
      console.error('Error fetching messages:', error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Upload image to media server
  const handleImageUpload = async (file) => {
    if (!file) return null;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('randomFilename', 'true');

      const response = await fetch(MEDIA_UPLOAD_URL, {
        method: 'POST',
        headers: {
          'apikey': 'k-7a9018ba-083d-495f-a86e-aa565469e1b4',
          'userId': 'u-2ad602bf-9d52-47a2-8689-b8b8c6aec936',
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to upload image');
      }

      const result = await response.json();
      if (result.success && result.data?.url) {
        const imageData = {
          url: result.data.url,
          fileName: result.data.fileName,
          previewUrl: URL.createObjectURL(file)
        };
        setUploadedImage(imageData);
        return imageData;
      }
      throw new Error('Upload failed');
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Failed to upload image. Please try again.');
      return null;
    } finally {
      setUploading(false);
    }
  };

  // Handle file input change
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        alert('Image size must be less than 10MB');
        return;
      }
      await handleImageUpload(file);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Remove uploaded image
  const removeUploadedImage = () => {
    if (uploadedImage?.previewUrl) {
      URL.revokeObjectURL(uploadedImage.previewUrl);
    }
    setUploadedImage(null);
  };

  // Send message with SSE streaming response
  const sendMessage = async (messageContent, imageUrl = null) => {
    if ((!messageContent.trim() && !imageUrl) || sending) return;

    setSending(true);
    setStreamingText('');

    // Optimistically add user message
    const tempUserMsg = {
      id: `temp-${Date.now()}`,
      text: messageContent,
      sender: 'user',
      timestamp: new Date(),
      imageUrl: imageUrl, // Include image URL for display (from uploadedImage?.url)
    };

    console.log('[Chat] Sending message with image:', imageUrl ? 'Yes' : 'No', imageUrl);
    setMessages(prev => [...prev, tempUserMsg]);

    // Clear uploaded image after sending
    if (uploadedImage) {
      removeUploadedImage();
    }

    try {
      // Send message to /api/chat endpoint with SSE streaming
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageContent,
          chat_uuid: chatId,
          image_url: imageUrl, // Send image URL to backend
        })
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'loop_start') {
                // New loop starting - show thinking indicator
                if (data.loop > 1) {
                  setStreamingText(prev => prev + `\n\n🧠 Thinking... (step ${data.loop}/${data.maxLoops})`);
                }
              } else if (data.type === 'loop_end') {
                // Loop completed - optional: could show timing
                console.log(`Loop ${data.loop} completed in ${data.duration}s`);
              } else if (data.type === 'chunk') {
                // Stream text content
                accumulatedText += data.content;
                setStreamingText(accumulatedText);
              } else if (data.type === 'tool_call') {
                // Show tool being called
                setStreamingText(prev => prev + `\n\n🔧 Using tool: ${data.name}...`);
              } else if (data.type === 'tool_result') {
                // Tool completed
                setStreamingText(prev => prev + ` ✓`);
              } else if (data.type === 'file_change') {
                // Real-time code change - show in panel
                console.log('📝 File change:', data.path, data.operation);
                setFileChanges(prev => [...prev, {
                  path: data.path,
                  content: data.content,
                  oldStr: data.oldStr,
                  newStr: data.newStr,
                  operation: data.operation,
                  tool: data.tool
                }]);
                setShowCodePanel(true);
              } else if (data.type === 'refresh_preview') {
                // AI made file changes - refresh the preview iframe
                console.log('🔄 Refreshing preview...');
                refreshPreview();
              } else if (data.type === 'done') {
                // Stream complete - add final bot message
                if (accumulatedText) {
                  setMessages(prev => [...prev, {
                    id: `msg-${Date.now()}`,
                    text: accumulatedText,
                    sender: 'bot',
                    timestamp: new Date()
                  }]);
                }
                setStreamingText('');
                // Clear file changes and close panel after a delay
                setTimeout(() => {
                  setFileChanges([]);
                  setShowCodePanel(false);
                }, 3000);
                // Final refresh after everything is done
                setTimeout(refreshPreview, 500);
              } else if (data.type === 'error') {
                console.error('Stream error:', data.message);
                setStreamingText(`Error: ${data.message}`);
              }
            } catch (parseError) {
              // Ignore parse errors for partial JSON
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setStreamingText(`Error: ${error.message}`);
    } finally {
      setSending(false);
    }
  };

  // Form submit handler
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (inputValue.trim() || uploadedImage) {
      sendMessage(inputValue, uploadedImage?.url);
      setInputValue('');
    }
  };

  // Trigger file input click
  const handleImageButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="chat-container">
      {/* Left Side - Messages */}
      <div className="chat-panel">
        <div className="chat-header">
          <Link to="/" className="back-button">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </Link>
          <h2>{conversationTitle || `Project ${chatId.slice(0, 8)}`}</h2>
          <span className={`status-badge ${containerStatus}`}>
            {containerStatus === 'running' ? '🟢 Live' : containerStatus === 'creating' ? '🟡 Creating...' : '⚪ Checking'}
          </span>
        </div>

        {/* Update Available Banner */}
        {updateAvailable && (
          <div className="update-banner">
            <div className="update-banner-content">
              <span className="update-icon">🚀</span>
              <span className="update-text">
                New version available! ({updateAvailable.currentVersion} → {updateAvailable.latestVersion})
              </span>
              <button
                className="update-button"
                onClick={handleUpdateContainer}
                disabled={isUpdating}
              >
                {isUpdating ? 'Updating...' : 'Update Now'}
              </button>
            </div>
          </div>
        )}

        <div className="messages-container">
          {containerStatus === 'creating' && (
            <div className="container-creating-banner">
              <span className="spinner">⏳</span>
              <span>Setting up your project environment... This may take 1-2 minutes.</span>
            </div>
          )}
          {loading ? (
            <div className="loading-messages">Loading messages...</div>
          ) : messages.length === 0 && !streamingText ? (
            <div className="no-messages">
              {containerStatus === 'creating'
                ? 'Your message will be sent once the container is ready...'
                : 'No messages yet. Start the conversation!'}
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`message ${message.sender === 'user' ? 'user-message' : 'bot-message'}`}
                >
                  <div className="message-content">
                    {message.imageUrl && (
                      <img
                        src={message.imageUrl}
                        alt="Uploaded"
                        className="message-image"
                        onClick={() => window.open(message.imageUrl, '_blank')}
                      />
                    )}
                    {message.text && <p>{message.text}</p>}
                    <span className="message-time">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
              {/* Show streaming response */}
              {streamingText && (
                <div className="message bot-message streaming">
                  <div className="message-content">
                    <p>{streamingText}</p>
                    <span className="message-time typing">
                      <span className="typing-indicator">
                        <span></span><span></span><span></span>
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Image upload preview */}
        {uploadedImage && (
          <div className="image-preview-bar">
            <img src={uploadedImage.previewUrl} alt="To upload" className="preview-thumb" />
            <span className="preview-filename">{uploadedImage.fileName}</span>
            <button
              type="button"
              className="remove-image-btn"
              onClick={removeUploadedImage}
              title="Remove image"
            >
              ✕
            </button>
          </div>
        )}

        <form className="chat-input-form" onSubmit={handleSendMessage}>
          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*"
            style={{ display: 'none' }}
          />

          {/* Image upload button */}
          <button
            type="button"
            className="image-upload-btn"
            onClick={handleImageButtonClick}
            disabled={sending || uploading}
            title="Upload image"
          >
            {uploading ? '⏳' : '🖼️'}
          </button>

          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={uploadedImage ? "Add a message about this image..." : "Type your message..."}
            className="chat-input"
            disabled={sending}
          />
          <button type="submit" className="send-button" disabled={sending || uploading}>
            {sending ? '⏳' : '➤'}
          </button>
        </form>
      </div>

      {/* Right Side - Preview */}
      <div className="preview-panel">
        <div className="preview-header">
          <h2>Preview</h2>
          <input
            type="text"
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
            placeholder="Enter Cloud Run URL..."
            className="url-input"
          />
          <button onClick={refreshPreview} className="refresh-btn" title="Refresh preview">
            🔄
          </button>
        </div>
        <div className="iframe-container">
          {previewUrl ? (
            <iframe
              ref={iframeRef}
              src={previewUrl}
              title="Preview"
              className="preview-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          ) : (
            <div className="no-preview">
              <p>🚀 Preview will appear here once the project is deployed</p>
            </div>
          )}
        </div>
      </div>

      {/* Real-time code changes panel */}
      <CodeChangePanel
        fileChanges={fileChanges}
        isVisible={showCodePanel}
        onClose={() => setShowCodePanel(false)}
      />
    </div>
  );
}

export default Chat;


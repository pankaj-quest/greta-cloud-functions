import { useState, useEffect, useRef } from 'react';
import './CodeChangePanel.css';

// Simple syntax highlighting for common file types
const getLanguage = (path) => {
  if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.jsx') || path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.html')) return 'html';
  return 'text';
};

// Basic syntax highlighting
const highlightCode = (code, language) => {
  if (!code) return '';
  
  // Escape HTML
  let highlighted = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Keywords for different languages
  const jsKeywords = /\b(import|export|from|const|let|var|function|return|if|else|for|while|class|extends|async|await|try|catch|throw|new|this|typeof|instanceof|default|switch|case|break|continue)\b/g;
  const pyKeywords = /\b(import|from|def|class|return|if|elif|else|for|while|try|except|raise|with|as|async|await|True|False|None|and|or|not|in|is|lambda|yield|pass|break|continue)\b/g;
  
  // Apply highlighting based on language
  if (language === 'javascript' || language === 'typescript') {
    highlighted = highlighted
      .replace(jsKeywords, '<span class="keyword">$1</span>')
      .replace(/(["'`])(?:(?!\1)[^\\]|\\.)*?\1/g, '<span class="string">$&</span>')
      .replace(/\/\/.*$/gm, '<span class="comment">$&</span>')
      .replace(/\/\*[\s\S]*?\*\//g, '<span class="comment">$&</span>')
      .replace(/\b(\d+)\b/g, '<span class="number">$1</span>');
  } else if (language === 'python') {
    highlighted = highlighted
      .replace(pyKeywords, '<span class="keyword">$1</span>')
      .replace(/(["'])(?:(?!\1)[^\\]|\\.)*?\1/g, '<span class="string">$&</span>')
      .replace(/#.*$/gm, '<span class="comment">$&</span>')
      .replace(/\b(\d+)\b/g, '<span class="number">$1</span>');
  } else if (language === 'css') {
    highlighted = highlighted
      .replace(/([.#]?[\w-]+)\s*\{/g, '<span class="selector">$1</span> {')
      .replace(/([\w-]+)\s*:/g, '<span class="property">$1</span>:')
      .replace(/\/\*[\s\S]*?\*\//g, '<span class="comment">$&</span>');
  }
  
  return highlighted;
};

function CodeChangePanel({ fileChanges, isVisible, onClose }) {
  const [activeTab, setActiveTab] = useState(0);
  const [displayedContent, setDisplayedContent] = useState({});
  const codeRef = useRef(null);
  
  // Typing animation effect
  useEffect(() => {
    if (!fileChanges || fileChanges.length === 0) return;
    
    const currentFile = fileChanges[activeTab];
    if (!currentFile || displayedContent[currentFile.path] === currentFile.content) return;
    
    const content = currentFile.content || '';
    let charIndex = displayedContent[currentFile.path]?.length || 0;
    
    const typeInterval = setInterval(() => {
      if (charIndex < content.length) {
        // Type 50 characters at a time for speed
        const nextChunk = content.slice(0, Math.min(charIndex + 50, content.length));
        setDisplayedContent(prev => ({
          ...prev,
          [currentFile.path]: nextChunk
        }));
        charIndex += 50;
        
        // Auto-scroll to bottom
        if (codeRef.current) {
          codeRef.current.scrollTop = codeRef.current.scrollHeight;
        }
      } else {
        clearInterval(typeInterval);
      }
    }, 10);
    
    return () => clearInterval(typeInterval);
  }, [fileChanges, activeTab, displayedContent]);
  
  if (!isVisible || !fileChanges || fileChanges.length === 0) return null;
  
  const currentFile = fileChanges[activeTab];
  const language = getLanguage(currentFile?.path || '');
  const content = displayedContent[currentFile?.path] || '';
  const isComplete = content === currentFile?.content;
  
  return (
    <div className="code-change-panel">
      <div className="code-panel-header">
        <div className="code-panel-title">
          <span className="code-icon">📝</span>
          <span>Code Changes</span>
          <span className="file-count">{fileChanges.length} file{fileChanges.length > 1 ? 's' : ''}</span>
        </div>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>
      
      {/* File tabs */}
      <div className="file-tabs">
        {fileChanges.map((file, index) => (
          <button
            key={file.path}
            className={`file-tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            <span className="file-icon">{file.operation === 'replace' ? '✏️' : '📄'}</span>
            <span className="file-name">{file.path.split('/').pop()}</span>
            {!isComplete && activeTab === index && <span className="writing-indicator">...</span>}
          </button>
        ))}
      </div>
      
      {/* File path */}
      <div className="file-path">
        <span className="path-label">Path:</span>
        <span className="path-value">{currentFile?.path}</span>
        <span className={`status-badge ${isComplete ? 'complete' : 'writing'}`}>
          {isComplete ? '✓ Complete' : '⏳ Writing...'}
        </span>
      </div>
      
      {/* Code content */}
      <div className="code-content" ref={codeRef}>
        {currentFile?.operation === 'replace' ? (
          <div className="diff-view">
            <div className="diff-section removed">
              <div className="diff-label">- Replacing:</div>
              <pre><code>{currentFile.oldStr}</code></pre>
            </div>
            <div className="diff-section added">
              <div className="diff-label">+ With:</div>
              <pre><code dangerouslySetInnerHTML={{ __html: highlightCode(currentFile.newStr, language) }} /></pre>
            </div>
          </div>
        ) : (
          <pre className={`language-${language}`}>
            <code dangerouslySetInnerHTML={{ __html: highlightCode(content, language) }} />
            {!isComplete && <span className="cursor">|</span>}
          </pre>
        )}
      </div>
    </div>
  );
}

export default CodeChangePanel;


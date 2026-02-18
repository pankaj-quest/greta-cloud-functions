import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';

const API_URL = 'http://localhost:8000/api';

function Home() {
  const [prompt, setPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim() || isCreating) return;

    setIsCreating(true);

    try {
      // Create a new conversation in MongoDB
      const response = await fetch(`${API_URL}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: prompt.slice(0, 50) + (prompt.length > 50 ? '...' : ''),
          initial_prompt: prompt
        })
      });

      if (response.ok) {
        const conversation = await response.json();
        // Navigate to chat page with the new chatId and pass the initial prompt
        navigate(`/chat/${conversation.id}`, { state: { initialPrompt: prompt } });
      } else {
        console.error('Failed to create conversation');
        alert('Failed to create project. Please try again.');
      }
    } catch (error) {
      console.error('Error creating conversation:', error);
      alert('Error creating project. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="home-container">
      {/* Gradient background */}
      <div className="gradient-bg">
        <div className="gradient-layer gradient-1"></div>
        <div className="gradient-layer gradient-2"></div>
        <div className="gradient-layer gradient-3"></div>
      </div>

      {/* Content */}
      <div className="home-content">
        {/* Badge */}
        <div className="badge-container">
          <span className="badge">
            <span className="badge-new">New</span>
            Introducing Greta AI →
          </span>
        </div>

        {/* Heading */}
        <h1 className="home-title">What's on your mind?</h1>

        {/* Input Form */}
        <form className="prompt-form" onSubmit={handleSubmit}>
          <div className="prompt-input-container">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask Greta to create a landing page for my..."
              className="prompt-input"
              disabled={isCreating}
            />
            <div className="prompt-actions">
              <button type="button" className="action-btn plan-btn">Plan</button>
              <button type="button" className="action-btn voice-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                  <line x1="12" y1="19" x2="12" y2="23"></line>
                  <line x1="8" y1="23" x2="16" y2="23"></line>
                </svg>
              </button>
              <button 
                type="submit" 
                className="action-btn submit-btn"
                disabled={isCreating || !prompt.trim()}
              >
                {isCreating ? (
                  <span className="spinner"></span>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"></path>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Recent Projects (optional) */}
        <div className="recent-projects">
          <p className="recent-label">Recent projects</p>
          <div className="project-chips">
            <a href="/chat/demo-1" className="project-chip">Todo App</a>
            <a href="/chat/demo-2" className="project-chip">Landing Page</a>
            <a href="/chat/demo-3" className="project-chip">Dashboard</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;


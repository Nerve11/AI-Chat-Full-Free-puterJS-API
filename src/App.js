import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ThemeProvider as CustomThemeProvider } from './contexts/ThemeContext';
import ChatInterface from './components/ChatInterface';
import ModelSelector from './components/ModelSelector';
import SystemPrompt from './components/SystemPrompt';
import AuthManager from './components/AuthManager';
import { isPuterAvailable, sendMessageToClaude, loadPuterScript, CLAUDE_MODELS } from './utils/puterApi';
import { setDebugMode, isDebugMode, collectDiagnostics } from './utils/debugUtils';
import { testPuterApi, testClaude37Access } from './utils/puterTest';
import ErrorBoundary from './components/ErrorBoundary';

// Function to handle Claude API calls
const sendToClaude = async (message, setStreamingMessage, selectedModel, systemPrompt) => {
  try {
    // Check if Puter.js is loaded and available
    if (!isPuterAvailable()) {
      throw new Error("Puter.js API not available");
    }

    // Clear any previous streaming message
    setStreamingMessage({ content: '', role: 'assistant', id: Date.now() });

    // Create response buffer to handle potential state update issues
    let responseBuffer = '';
    
    try {
      // Call Claude through Puter.js with updated parameters
      await sendMessageToClaude(
        message, 
        (update) => {
          // Make sure update is valid text
          if (typeof update !== 'string') {
            console.warn("Invalid update received:", update);
            return;
          }
          
          // Append to buffer first
          responseBuffer += update;
          
          // Use functional state update to prevent race conditions
          setStreamingMessage(prev => {
            // If somehow the previous state is lost, reconstruct it
            if (!prev || prev.content === undefined) {
              return { 
                content: responseBuffer, 
                role: 'assistant', 
                id: Date.now() 
              };
            }
            
            // Ensure the text isn't duplicated if the update replaces content
            // (this can happen with some streaming implementations)
            const existingContent = prev.content || '';
            
            // If update would create duplicate content, replace instead of append
            if (responseBuffer.endsWith(update) && 
                existingContent.endsWith(update.substring(0, Math.min(update.length, 10)))) {
              return {
                ...prev,
                content: responseBuffer
              };
            }
            
            // Normal case: append the update
            return {
              ...prev,
              content: responseBuffer // Use complete buffer instead of incremental
            };
          });
        },
        selectedModel,
        systemPrompt
      );

      return true;
    } catch (apiError) {
      console.error("API Error in sendToClaude:", apiError);
      
      // Ensure final buffer content is displayed even after an error
      if (responseBuffer) {
        setStreamingMessage(prev => ({
          ...prev,
          content: responseBuffer
        }));
      }
      
      // Let the error from the API flow through - don't add a generic message
      // The detailed error message is already added by sendMessageToClaude
      return false;
    }
  } catch (error) {
    console.error("Error in sendToClaude:", error);
    
    // Only add an error message if one wasn't already set by the API
    setStreamingMessage(prev => {
      // Check if the error message is already in the content
      if (!prev || !prev.content || !prev.content.includes("⚠️ Error")) {
        return {
          ...prev,
          content: (prev?.content || '') + 
            "\n\n⚠️ Ошибка: " + (error.message || "Не удалось подключиться к API.")
        };
      }
      return prev;
    });
    
    return false;
  }
};

const App = ({ puterLoaded, puterTimeout }) => {
  const [connectionStatus, setConnectionStatus] = useState('loading');
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState(null);
  const inputRef = useRef(null);
  const currentStreamingMessageRef = useRef(null);
  const [debugActive, setDebugActive] = useState(isDebugMode());
  const [selectedModel, setSelectedModel] = useState(CLAUDE_MODELS.CLAUDE_3_5_SONNET);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(() => {
    const savedPrompt = localStorage.getItem('systemPrompt');
    console.log('Loading system prompt from localStorage:', savedPrompt);
    return savedPrompt || '';
  });
  const [isSystemPromptVisible, setIsSystemPromptVisible] = useState(false);
  const [showPromptNotification, setShowPromptNotification] = useState(false);
  
  // Keep the ref in sync with the state
  useEffect(() => {
    currentStreamingMessageRef.current = streamingMessage;
  }, [streamingMessage]);
  
  // Close model dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Only check if dropdown is open
      if (isModelDropdownOpen) {
        try {
          // Check if the click is on a model option or on the selector itself
          const isClickOnOption = event.target.closest('.model-option');
          const isClickOnSelector = event.target.closest('.select-model');
          const isClickOnDropdown = event.target.closest('.model-dropdown');
          
          // If click is not on selector, option, or the dropdown itself, close it
          if (!isClickOnSelector && !isClickOnOption && !isClickOnDropdown) {
            setIsModelDropdownOpen(false);
          }
        } catch (error) {
          console.error('Error in handleClickOutside:', error);
          // Force close dropdown if there's an error
          setIsModelDropdownOpen(false);
        }
      }
    };

    // Use event capturing to ensure we catch the event before it reaches the portal
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isModelDropdownOpen]);
  
  // Effect to save systemPrompt to localStorage when it changes
  useEffect(() => {
    if (systemPrompt) {
      console.log(`Saving system prompt to localStorage (${systemPrompt.length} chars)`);
      localStorage.setItem('systemPrompt', systemPrompt);
    } else {
      console.log('Removing system prompt from localStorage');
      localStorage.removeItem('systemPrompt');
    }
  }, [systemPrompt]);
  
  // Effect to show notification for 3 seconds when system prompt is set
  useEffect(() => {
    if (showPromptNotification) {
      const timer = setTimeout(() => {
        setShowPromptNotification(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showPromptNotification]);
  
  // Check connection status and load Puter.js if needed
  useEffect(() => {
    const setupPuter = async () => {
      try {
        if (puterLoaded) {
          setConnectionStatus('loaded');
        } else if (puterTimeout) {
          // Try to load Puter.js directly if it timed out
          const loaded = await loadPuterScript();
          if (loaded) {
            setConnectionStatus('loaded');
          } else {
            setConnectionStatus('error');
          }
        } else {
          setConnectionStatus('loading');
        }
      } catch (error) {
        console.error("Connection error:", error);
        setConnectionStatus('error');
      }
    };
    
    setupPuter();
  }, [puterLoaded, puterTimeout]);

  // Get connection status text
  const connectionStatusText = useMemo(() => {
    switch(connectionStatus) {
      case 'loading': return 'Соединение...';
      case 'loaded': return 'Подключено';
      case 'error': return 'Ошибка соединения';
      default: return 'Неизвестный статус';
    }
  }, [connectionStatus]);

  // Get connection status class
  const connectionStatusClass = useMemo(() => {
    switch(connectionStatus) {
      case 'loading': return 'connecting';
      case 'loaded': return 'connected';
      case 'error': return 'error';
      default: return '';
    }
  }, [connectionStatus]);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Handle message sending
  const handleSendMessage = async () => {
    if (!inputValue.trim() || isStreaming) return;
    
    const userMessage = {
      content: inputValue.trim(),
      role: 'user',
      id: Date.now()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsStreaming(true);
    
    try {
      console.log(`Sending message using model: ${selectedModel}`);
      if (systemPrompt) {
        console.log(`Using system prompt (${systemPrompt.length} chars): "${systemPrompt.substring(0, 50)}${systemPrompt.length > 50 ? '...' : ''}"`, 
          systemPrompt ? { role: 'system', content: systemPrompt } : null);
      } else {
        console.log('No system prompt provided');
      }
      
      // Ensure we have a valid model selected
      const modelToUse = selectedModel || CLAUDE_MODELS.CLAUDE_3_5_SONNET;
      
      // Clear any previous streaming message
      setStreamingMessage({ content: '', role: 'assistant', id: Date.now() });
      
      const success = await sendToClaude(
        userMessage.content, 
        setStreamingMessage,
        modelToUse,
        systemPrompt
      );
      
      // Use the ref to access the most current streamingMessage
      const currentMessage = currentStreamingMessageRef.current;
      
      // Add completed assistant message to messages list
      if (currentMessage && currentMessage.content) {
        // Better detection for incomplete responses
        let finalContent = currentMessage.content;
        const isCompleteSentence = finalContent.trim().endsWith('.') || 
                                   finalContent.trim().endsWith('?') || 
                                   finalContent.trim().endsWith('!') ||
                                   finalContent.trim().endsWith(':') ||
                                   finalContent.trim().endsWith(')') ||
                                   finalContent.trim().endsWith('"') ||
                                   finalContent.trim().endsWith("'");
        
        // Check for very short responses or responses with abrupt endings
        const isPotentiallyIncomplete = 
          (finalContent.length < 100 && !isCompleteSentence) || 
          // Check if ends mid-sentence (ends with a word character)
          /[a-zA-Z0-9а-яА-Я]$/.test(finalContent.trim());
        
        if (isPotentiallyIncomplete) {
          console.warn("Response appears to be incomplete:", finalContent);
          
          // Add a warning to the message
          finalContent += "\n\n[Ответ может быть неполным. Пожалуйста, попробуйте задать вопрос снова.]";
        }
        
        const assistantMessage = {
          content: finalContent,
          role: 'assistant',
          id: currentMessage.id || Date.now()
        };
        
        setMessages(prev => [...prev, assistantMessage]);
      } else if (!success) {
        // Provide a clear error message when there's no response content
        setMessages(prev => [...prev, {
          content: "Произошла ошибка при обработке запроса. Ответ не был получен. Пожалуйста, попробуйте снова.",
          role: 'assistant',
          id: Date.now()
        }]);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages(prev => [...prev, {
        content: "Произошла ошибка при обработке запроса. Пожалуйста, попробуйте снова.",
        role: 'assistant',
        id: Date.now()
      }]);
    } finally {
      setIsStreaming(false);
      setStreamingMessage(null);
    }
  };

  // Handle Enter key to send message
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Functions for bottom control buttons
  const handleModelSelect = (e) => {
    try {
      if (e && e.stopPropagation) {
        e.stopPropagation();  // Prevent event bubbling
      }
      setIsModelDropdownOpen(prev => !prev);
    } catch (error) {
      console.error('Error in handleModelSelect:', error);
    }
  };

  const handleSelectModel = (modelId) => {
    try {
      if (modelId) {
        console.log(`Selecting model: ${modelId}`);
        setSelectedModel(modelId);
        // Use setTimeout to avoid React unmounting issues
        setTimeout(() => {
          setIsModelDropdownOpen(false);
        }, 0);
      } else {
        console.error("Attempted to select model with invalid ID");
      }
    } catch (error) {
      console.error("Error in model selection:", error);
    }
  };
  
  // Functions for system prompt
  const handleSystemPromptChange = (newPrompt) => {
    console.log("System prompt updated:", newPrompt === null ? 'null' : newPrompt === undefined ? 'undefined' : `"${newPrompt.substring(0, 50)}${newPrompt.length > 50 ? '...' : ''}"`);
    // Преобразуем null и undefined в пустую строку
    const cleanPrompt = newPrompt !== null && newPrompt !== undefined ? newPrompt : '';
    setSystemPrompt(cleanPrompt);
    setIsSystemPromptVisible(false);
    if (cleanPrompt) {
      setShowPromptNotification(true);
    }
  };

  const handleClearSystemPrompt = () => {
    if (window.confirm("Вы уверены, что хотите удалить системный промпт?")) {
      console.log("System prompt cleared");
      setSystemPrompt('');
    }
  };

  const toggleSystemPromptVisibility = () => {
    setIsSystemPromptVisible(!isSystemPromptVisible);
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  const handleSearch = () => {
    console.log("Search clicked");
  };

  // Toggle debug mode when the debug button is clicked
  const handleToggleDebug = async () => {
    const newDebugState = !debugActive;
    setDebugActive(newDebugState);
    setDebugMode(newDebugState);
    
    if (newDebugState) {
      console.log("Debug mode activated");
      localStorage.setItem('claude_debug_mode', 'true');
      
      // Run diagnostic tests
      const diagnostics = await collectDiagnostics();
      console.log("Client diagnostics:", diagnostics);
      
      // Test Puter.js API
      const apiTest = await testPuterApi();
      console.log("Puter.js API test results:", apiTest);
      
      // Test Claude access if API is available
      if (apiTest.isClaudeAvailable) {
        const claudeTest = await testClaude37Access();
        console.log("Claude 3.7 access test:", claudeTest ? "PASSED" : "FAILED");
      }
    } else {
      console.log("Debug mode deactivated");
      localStorage.removeItem('claude_debug_mode');
    }
  };

  // Handle authentication changes
  const handleAuthChange = (isAuth, user) => {
    if (isAuth && user) {
      console.log(`User authenticated: ${user.username}`);
      // You can add additional logic here when a user logs in
      // For example, loading user-specific settings or history
    } else {
      console.log('User signed out');
      // You can add additional logic here when a user logs out
      // For example, clearing user-specific data
    }
  };

  return (
    <CustomThemeProvider>
      <div className="main-container">
        <div className="header">
          <div className="logo-container">
            <div className="logo" />
            <span className="claude-sonnet-chat"><span>Claude Free Sonnet Chat</span></span>
          </div>
          <div className={`connected ${connectionStatusClass}`}>
            <div className="group">
              <span className="connected-1"><span>{connectionStatusText}</span></span>
              <div className="vector" />
            </div>
          </div>
          <AuthManager onAuthChange={handleAuthChange} />
          <div className="theme" />
        </div>
        
        <div className="chat">
          <ChatInterface 
            messages={messages} 
            setMessages={setMessages}
            streamingMessage={streamingMessage}
            puterLoaded={puterLoaded}
          />
        </div>
        
        <div className="write-message">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Claude Free Sonnet"
            disabled={!puterLoaded || isStreaming}
            className="message-claude-sonnet"
            style={{
              background: 'transparent',
              border: 'none',
              width: 'calc(100% - 100px)'
            }}
          />
          <div className="path" />
          <div className="frame-3" onClick={handleSendMessage} />
        </div>
        
        <div className="flex-row">
          <ErrorBoundary>
            <SystemPrompt 
              systemPrompt={systemPrompt} 
              onSystemPromptChange={handleSystemPromptChange}
              isVisible={isSystemPromptVisible}
              onToggleVisibility={toggleSystemPromptVisibility}
              onClearPrompt={handleClearSystemPrompt}
            />
          </ErrorBoundary>
          
          <div className="choose-model">
            <ErrorBoundary>
              <ModelSelector 
                selectedModel={selectedModel}
                onSelectModel={handleSelectModel}
                isOpen={isModelDropdownOpen}
                toggleDropdown={handleModelSelect}
              />
            </ErrorBoundary>
          </div>
          <div className="clear-chat" onClick={handleClearChat}>
            <div className="group-6">
              <span className="clear-chat-7"><span>Clear chat</span></span>
              <div className="vector-8" />
            </div>
          </div>
          <div className="search" onClick={handleSearch}>
            <div className="group-9">
              <span className="search-a"><span>Search</span></span>
            </div>
            <div className="vector-b" />
          </div>
          <div className={`debug-button ${debugActive ? 'active' : ''}`} onClick={handleToggleDebug}>
            <div className="group-debug">
              <span className="debug-text"><span>Debug</span></span>
            </div>
          </div>
        </div>
        
        {showPromptNotification && systemPrompt && (
          <div className="system-prompt-notification">
            <div className="notification-icon">S</div>
            <div className="notification-text">Системный промпт активирован</div>
          </div>
        )}
        
        <span className="designed-by-chronix"><span>© Designed by Chronix</span></span>
      </div>
    </CustomThemeProvider>
  );
};

export default App; 
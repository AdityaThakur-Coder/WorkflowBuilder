import React, { useState, useCallback, useRef } from 'react';
import ReactFlow, { 
  addEdge, 
  Controls, 
  Background, 
  useNodesState, 
  useEdgesState,
  MarkerType
} from 'reactflow';
import 'reactflow/dist/style.css';
import './App.css';

// Custom node component
const CustomNode = ({ data, selected }) => {
  return (
    <div className={`custom-node ${selected ? 'selected' : ''}`}>
      <div className="node-header">
        <span className="node-icon">{data.icon}</span>
        <span className="node-title">{data.label}</span>
      </div>
      <div className="node-content">
        {data.description}
      </div>
    </div>
  );
};

// Define node types
const nodeTypes = {
  custom: CustomNode,
};

// Initial node configurations
const initialNodes = [
  {
    id: '1',
    type: 'custom',
    position: { x: 250, y: 100 },
    data: { 
      label: 'User Query',
      icon: '❓',
      description: 'Input from user',
      config: { placeholder: 'Enter your question...' }
    },
  },
];

const initialEdges = [];

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [documents, setDocuments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const fileInputRef = useRef(null);

  // Component library for dragging
  const componentLibrary = [
    {
      id: 'user-query',
      type: 'custom',
      label: 'User Query',
      icon: '❓',
      description: 'Input from user',
      config: { placeholder: 'Enter your question...' }
    },
    {
      id: 'knowledge-base',
      type: 'custom',
      label: 'Knowledge Base',
      icon: '📚',
      description: 'Document storage',
      config: { documents: [] }
    },
    {
      id: 'llm-engine',
      type: 'custom',
      label: 'LLM Engine',
      icon: '🧠',
      description: 'AI processing',
      config: { model: 'gpt-3.5-turbo', temperature: 0.7 }
    },
    {
      id: 'output',
      type: 'custom',
      label: 'Output',
      icon: '📤',
      description: 'Response output',
      config: { format: 'text' }
    }
  ];

  // Handle edge connections
  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({
      ...params,
      markerEnd: {
        type: MarkerType.ArrowClosed,
      },
    }, eds));
  }, [setEdges]);

  // Handle node selection
  const onSelectionChange = useCallback((elements) => {
    const selectedElements = elements.nodes || [];
    if (selectedElements.length > 0) {
      setSelectedNode(selectedElements[0]);
    } else {
      setSelectedNode(null);
    }
  }, []);

  // Handle drag start from component library
  const onDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  // Handle drop on canvas
  const onDrop = useCallback((event) => {
    event.preventDefault();
    
    if (!reactFlowInstance) return;
    
    const reactFlowBounds = event.currentTarget.getBoundingClientRect();
    const type = event.dataTransfer.getData('application/reactflow');
    
    if (typeof type === 'undefined' || !type) {
      return;
    }

    const component = componentLibrary.find(c => c.id === type);
    if (!component) return;

    const position = reactFlowInstance.project({
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top,
    });

    const newNode = {
      id: `${type}-${Date.now()}`,
      type: 'custom',
      position,
      data: {
        label: component.label,
        icon: component.icon,
        description: component.description,
        config: { ...component.config }
      },
    };

    setNodes((nds) => nds.concat(newNode));
  }, [reactFlowInstance, setNodes, componentLibrary]);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Handle file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://localhost:8000/upload-document', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      setDocuments(prev => [...prev, result]);
      
      // Generate embeddings for the uploaded document
      try {
        const embeddingResponse = await fetch(`http://localhost:8000/generate-embeddings/${result.document_id}`, {
          method: 'POST',
        });

        if (embeddingResponse.ok) {
          const embeddingResult = await embeddingResponse.json();
          console.log('Embeddings generated:', embeddingResult);
        }
      } catch (embeddingError) {
        console.log('Embedding generation failed, but document uploaded successfully');
      }

    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Error uploading file. Make sure backend is running on port 8000');
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle workflow validation
  const handleBuildStack = () => {
    if (nodes.length === 0) {
      alert('Please add components to build a workflow');
      return;
    }
    
    // Check for required components
    const hasUserQuery = nodes.some(node => node.data.label === 'User Query');
    const hasOutput = nodes.some(node => node.data.label === 'Output');
    
    if (!hasUserQuery || !hasOutput) {
      alert('Workflow must include at least User Query and Output components');
      return;
    }
    
    // Save workflow
    const workflowData = {
      nodes: nodes,
      edges: edges
    };
    
    // Try to save to backend, but don't fail if backend is down
    fetch('http://localhost:8000/save-workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(workflowData),
    })
    .then(response => response.json())
    .then(result => {
      console.log('Workflow saved:', result);
      alert('✅ Workflow built successfully!');
    })
    .catch(error => {
      console.error('Backend not available, but workflow is valid:', error);
      alert('✅ Workflow built successfully! (Backend connection failed, but workflow is valid)');
    });
  };

  // Handle chat
  const handleSendMessage = async () => {
    if (!currentMessage.trim()) return;

    const userMessage = { text: currentMessage, sender: 'user', timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMessage]);
    const messageToSend = currentMessage;
    setCurrentMessage('');

    try {
      const response = await fetch('http://localhost:8000/execute-workflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: messageToSend }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const result = await response.json();
      const aiMessage = { 
        text: result.response, 
        sender: 'ai', 
        timestamp: Date.now(),
        method: result.method 
      };
      setChatMessages(prev => [...prev, aiMessage]);

    } catch (error) {
      console.error('Error sending message:', error);
      // Fallback response when backend is not available
      const fallbackResponses = [
        `I understand you're asking about "${messageToSend}". However, I'm currently unable to connect to the backend server. Please make sure the FastAPI server is running on port 8000.`,
        `Your question "${messageToSend}" is noted. To get proper responses, please ensure both frontend and backend servers are running.`,
        `I see your query about "${messageToSend}". The backend service seems to be unavailable. Please check if the Python FastAPI server is started.`
      ];
      
      const errorMessage = { 
        text: fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)], 
        sender: 'ai', 
        timestamp: Date.now(),
        method: 'fallback'
      };
      setChatMessages(prev => [...prev, errorMessage]);
    }
  };

  // Handle Enter key in chat
  const handleChatKeyPress = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🔧 Workflow Builder</h1>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={handleBuildStack}>
            🔨 Build Stack
          </button>
          <button className="btn btn-secondary" onClick={() => setShowChat(!showChat)}>
            💬 Chat with Stack
          </button>
        </div>
      </header>

      <div className="app-content">
        {/* Left Panel - Component Library */}
        <div className="left-panel">
          <h3>📦 Components</h3>
          <div className="component-library">
            {componentLibrary.map((component) => (
              <div
                key={component.id}
                className="component-item"
                draggable
                onDragStart={(event) => onDragStart(event, component.id)}
              >
                <span className="component-icon">{component.icon}</span>
                <div className="component-info">
                  <div className="component-name">{component.label}</div>
                  <div className="component-desc">{component.description}</div>
                </div>
              </div>
            ))}
          </div>

          <h3>📄 Documents</h3>
          <div className="document-section">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".pdf"
              style={{ display: 'none' }}
            />
            <button 
              className="btn btn-outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? '⏳ Uploading...' : '📁 Upload PDF'}
            </button>
            
            <div className="document-list">
              {documents.map((doc, index) => (
                <div key={index} className="document-item">
                  <span className="document-icon">📄</span>
                  <div className="document-info">
                    <div className="document-name">{doc.filename}</div>
                    <div className="document-stats">
                      {doc.word_count} words
                    </div>
                  </div>
                </div>
              ))}
              {documents.length === 0 && (
                <div className="no-documents">
                  <p>No documents uploaded yet</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center Panel - React Flow Canvas */}
        <div className="center-panel">
          <div 
            className="reactflow-wrapper"
            onDrop={onDrop}
            onDragOver={onDragOver}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={onSelectionChange}
              onInit={setReactFlowInstance}
              nodeTypes={nodeTypes}
              fitView
              attributionPosition="bottom-left"
            >
              <Controls />
              <Background />
            </ReactFlow>
          </div>
        </div>

        {/* Right Panel - Configuration */}
        <div className="right-panel">
          <h3>⚙️ Configuration</h3>
          {selectedNode ? (
            <div className="config-panel">
              <h4>{selectedNode.data.label} Settings</h4>
              <div className="config-form">
                {selectedNode.data.label === 'User Query' && (
                  <div className="form-group">
                    <label>Placeholder Text:</label>
                    <input
                      type="text"
                      value={selectedNode.data.config.placeholder || ''}
                      onChange={(e) => {
                        const updatedNode = {
                          ...selectedNode,
                          data: {
                            ...selectedNode.data,
                            config: {
                              ...selectedNode.data.config,
                              placeholder: e.target.value
                            }
                          }
                        };
                        setNodes(nds => nds.map(n => n.id === selectedNode.id ? updatedNode : n));
                        setSelectedNode(updatedNode);
                      }}
                    />
                  </div>
                )}
                
                {selectedNode.data.label === 'LLM Engine' && (
                  <>
                    <div className="form-group">
                      <label>Model:</label>
                      <select
                        value={selectedNode.data.config.model || 'gpt-3.5-turbo'}
                        onChange={(e) => {
                          const updatedNode = {
                            ...selectedNode,
                            data: {
                              ...selectedNode.data,
                              config: {
                                ...selectedNode.data.config,
                                model: e.target.value
                              }
                            }
                          };
                          setNodes(nds => nds.map(n => n.id === selectedNode.id ? updatedNode : n));
                          setSelectedNode(updatedNode);
                        }}
                      >
                        <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                        <option value="gpt-4">GPT-4</option>
                        <option value="claude-3">Claude 3</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Temperature: {selectedNode.data.config.temperature || 0.7}</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={selectedNode.data.config.temperature || 0.7}
                        onChange={(e) => {
                          const updatedNode = {
                            ...selectedNode,
                            data: {
                              ...selectedNode.data,
                              config: {
                                ...selectedNode.data.config,
                                temperature: parseFloat(e.target.value)
                              }
                            }
                          };
                          setNodes(nds => nds.map(n => n.id === selectedNode.id ? updatedNode : n));
                          setSelectedNode(updatedNode);
                        }}
                      />
                    </div>
                  </>
                )}
                
                {selectedNode.data.label === 'Output' && (
                  <div className="form-group">
                    <label>Format:</label>
                    <select
                      value={selectedNode.data.config.format || 'text'}
                      onChange={(e) => {
                        const updatedNode = {
                          ...selectedNode,
                          data: {
                            ...selectedNode.data,
                            config: {
                              ...selectedNode.data.config,
                              format: e.target.value
                            }
                          }
                        };
                        setNodes(nds => nds.map(n => n.id === selectedNode.id ? updatedNode : n));
                        setSelectedNode(updatedNode);
                      }}
                    >
                      <option value="text">Text</option>
                      <option value="json">JSON</option>
                      <option value="markdown">Markdown</option>
                      <option value="html">HTML</option>
                    </select>
                  </div>
                )}

                {selectedNode.data.label === 'Knowledge Base' && (
                  <div className="form-group">
                    <label>Documents Available:</label>
                    <div className="document-count">
                      {documents.length} document(s) uploaded
                    </div>
                    {documents.length > 0 && (
                      <div className="document-preview">
                        {documents.map((doc, idx) => (
                          <div key={idx} className="mini-doc">
                            📄 {doc.filename}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="no-selection">
              <p>👆 Select a component to configure its settings</p>
              <div className="help-text">
                <p>💡 Tips:</p>
                <ul>
                  <li>Drag components from left panel to canvas</li>
                  <li>Click on components to select them</li>
                  <li>Connect components by dragging between them</li>
                  <li>Upload PDF documents for knowledge base</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chat Modal */}
      {showChat && (
        <div className="chat-modal" onClick={(e) => e.target.className === 'chat-modal' && setShowChat(false)}>
          <div className="chat-container">
            <div className="chat-header">
              <h3>💬 Chat with Your Stack</h3>
              <button className="close-btn" onClick={() => setShowChat(false)}>×</button>
            </div>
            
            <div className="chat-messages">
              {chatMessages.length === 0 ? (
                <div className="chat-welcome">
                  <div className="welcome-icon">🤖</div>
                  <p><strong>Welcome to your AI Assistant!</strong></p>
                  <p>I can help you with questions about your uploaded documents.</p>
                  <div className="chat-tips">
                    <p>💡 Try asking:</p>
                    <ul>
                      <li>"What is this document about?"</li>
                      <li>"Summarize the main points"</li>
                      <li>"Find information about [topic]"</li>
                    </ul>
                  </div>
                </div>
              ) : (
                chatMessages.map((message, index) => (
                  <div key={index} className={`message ${message.sender}`}>
                    <div className="message-content">
                      {message.text}
                      {message.method && (
                        <div className="message-meta">
                          {message.method === 'openai' && '🤖 OpenAI'}
                          {message.method === 'mock' && '🎭 Mock Response'}
                          {message.method === 'fallback' && '⚠️ Offline Mode'}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="chat-input">
              <input
                type="text"
                value={currentMessage}
                onChange={(e) => setCurrentMessage(e.target.value)}
                onKeyPress={handleChatKeyPress}
                placeholder="Type your message..."
                disabled={isUploading}
              />
              <button 
                onClick={handleSendMessage} 
                disabled={!currentMessage.trim() || isUploading}
                className="send-btn"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
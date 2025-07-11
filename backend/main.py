from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
from typing import Dict, List, Optional
import fitz  # PyMuPDF
from dotenv import load_dotenv
import random
import time

# Load environment variables
load_dotenv()

app = FastAPI(title="Workflow Builder API", version="1.0.0")

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for simplicity
documents_store = {}
embeddings_store = {}
workflows_store = {}

# Data models
class WorkflowNode(BaseModel):
    id: str
    type: str
    position: Dict[str, float]
    data: Dict

class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str

class WorkflowData(BaseModel):
    nodes: List[WorkflowNode]
    edges: List[WorkflowEdge]

class ChatMessage(BaseModel):
    message: str
    workflow_id: Optional[str] = None

class ComponentConfig(BaseModel):
    component_id: str
    config: Dict

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "Workflow Builder API is running"}

@app.post("/upload-document")
async def upload_document(file: UploadFile = File(...)):
    """Upload and extract text from PDF documents"""
    try:
        if not file.filename.endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are supported")
        
        # Read the uploaded file
        content = await file.read()
        
        # Extract text using PyMuPDF
        doc = fitz.open(stream=content, filetype="pdf")
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        
        # Generate a unique document ID
        doc_id = f"doc_{int(time.time())}"
        
        # Store document info
        documents_store[doc_id] = {
            "filename": file.filename,
            "text": text,
            "upload_time": time.time(),
            "word_count": len(text.split())
        }
        
        return {
            "document_id": doc_id,
            "filename": file.filename,
            "text_length": len(text),
            "word_count": len(text.split()),
            "preview": text[:500] + "..." if len(text) > 500 else text
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing document: {str(e)}")

@app.post("/generate-embeddings/{doc_id}")
async def generate_embeddings(doc_id: str):
    """Generate embeddings for a document (mock or real based on API key)"""
    if doc_id not in documents_store:
        raise HTTPException(status_code=404, detail="Document not found")
    
    try:
        document = documents_store[doc_id]
        text = document["text"]
        
        # Check if OpenAI API key is available
        openai_key = os.getenv("OPENAI_API_KEY")
        
        if openai_key:
            # Use real OpenAI embeddings
            try:
                import openai
                client = openai.OpenAI(api_key=openai_key)
                
                # Split text into chunks for embedding
                chunks = [text[i:i+8000] for i in range(0, len(text), 8000)]
                embeddings = []
                
                for chunk in chunks:
                    response = client.embeddings.create(
                        model="text-embedding-ada-002",
                        input=chunk
                    )
                    embeddings.append(response.data[0].embedding)
                
                embeddings_store[doc_id] = {
                    "embeddings": embeddings,
                    "chunks": chunks,
                    "method": "openai"
                }
                
                return {
                    "document_id": doc_id,
                    "embeddings_count": len(embeddings),
                    "method": "openai",
                    "chunks_count": len(chunks)
                }
                
            except Exception as e:
                # Fall back to mock embeddings if OpenAI fails
                pass
        
        # Generate mock embeddings
        chunks = [text[i:i+1000] for i in range(0, len(text), 1000)]
        mock_embeddings = []
        
        for chunk in chunks:
            # Generate random embeddings (1536 dimensions like OpenAI)
            embedding = [random.random() for _ in range(1536)]
            mock_embeddings.append(embedding)
        
        embeddings_store[doc_id] = {
            "embeddings": mock_embeddings,
            "chunks": chunks,
            "method": "mock"
        }
        
        return {
            "document_id": doc_id,
            "embeddings_count": len(mock_embeddings),
            "method": "mock",
            "chunks_count": len(chunks)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating embeddings: {str(e)}")

@app.post("/save-workflow")
async def save_workflow(workflow: WorkflowData):
    """Save workflow configuration"""
    workflow_id = f"workflow_{int(time.time())}"
    workflows_store[workflow_id] = {
        "nodes": [node.dict() for node in workflow.nodes],
        "edges": [edge.dict() for edge in workflow.edges],
        "created_at": time.time()
    }
    
    return {"workflow_id": workflow_id, "message": "Workflow saved successfully"}

@app.post("/execute-workflow")
async def execute_workflow(chat_data: ChatMessage):
    """Execute workflow logic based on user query"""
    try:
        user_query = chat_data.message
        
        # For demo purposes, we'll simulate workflow execution
        # In a real implementation, this would process the workflow graph
        
        # Check if we have any documents and embeddings
        if not documents_store:
            return {
                "response": "No documents have been uploaded yet. Please upload a PDF document first to enable knowledge-based responses."
            }
        
        # Get the most recent document
        latest_doc_id = max(documents_store.keys(), key=lambda x: documents_store[x]["upload_time"])
        document = documents_store[latest_doc_id]
        
        # Simple keyword matching for demo
        doc_text = document["text"].lower()
        query_lower = user_query.lower()
        
        # Find relevant sentences
        sentences = doc_text.split('.')
        relevant_sentences = [s.strip() for s in sentences if any(word in s.lower() for word in query_lower.split())]
        
        if relevant_sentences:
            context = '. '.join(relevant_sentences[:3])  # Use top 3 relevant sentences
        else:
            context = document["text"][:500]  # Use first 500 chars as fallback
        
        # Generate response using OpenAI or mock
        openai_key = os.getenv("OPENAI_API_KEY")
        
        if openai_key:
            try:
                import openai
                client = openai.OpenAI(api_key=openai_key)
                
                response = client.chat.completions.create(
                    model="gpt-3.5-turbo",
                    messages=[
                        {"role": "system", "content": f"You are a helpful assistant. Use the following context to answer the user's question: {context}"},
                        {"role": "user", "content": user_query}
                    ],
                    max_tokens=150
                )
                
                ai_response = response.choices[0].message.content
                
                return {
                    "response": ai_response,
                    "context_used": context[:200] + "..." if len(context) > 200 else context,
                    "method": "openai"
                }
                
            except Exception as e:
                # Fall back to mock response
                pass
        
        # Mock response
        mock_responses = [
            f"Based on the document '{document['filename']}', I can see that your query about '{user_query}' relates to the following information: {context[:200]}...",
            f"According to the uploaded document, here's what I found regarding '{user_query}': {context[:200]}...",
            f"From the knowledge base, I can provide this information about '{user_query}': {context[:200]}..."
        ]
        
        return {
            "response": random.choice(mock_responses),
            "context_used": context[:200] + "..." if len(context) > 200 else context,
            "method": "mock"
        }
        
    except Exception as e:
        return {
            "response": f"I apologize, but I encountered an error while processing your request: {str(e)}",
            "method": "error"
        }

@app.get("/documents")
async def get_documents():
    """Get list of uploaded documents"""
    return {"documents": documents_store}

@app.get("/embeddings")
async def get_embeddings():
    """Get list of generated embeddings"""
    return {"embeddings": {k: {"method": v["method"], "chunks_count": len(v["chunks"])} for k, v in embeddings_store.items()}}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
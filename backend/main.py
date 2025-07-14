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

# ✅ Enable CORS for local and deployed frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "https://workflowbuilder-9.onrender.com"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage
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
    return {"message": "Workflow Builder API is running"}

@app.post("/upload-document")
async def upload_document(file: UploadFile = File(...)):
    try:
        if not file.filename.endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are supported")

        content = await file.read()
        doc = fitz.open(stream=content, filetype="pdf")
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()

        doc_id = f"doc_{int(time.time())}"
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
    if doc_id not in documents_store:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        document = documents_store[doc_id]
        text = document["text"]
        openai_key = os.getenv("OPENAI_API_KEY")

        if openai_key:
            try:
                import openai
                openai.api_key = openai_key

                chunks = [text[i:i+8000] for i in range(0, len(text), 8000)]
                embeddings = []

                for chunk in chunks:
                    response = openai.Embedding.create(
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
                pass  # Fall back to mock

        # Mock embeddings
        chunks = [text[i:i+1000] for i in range(0, len(text), 1000)]
        mock_embeddings = [[random.random() for _ in range(1536)] for _ in chunks]

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
    workflow_id = f"workflow_{int(time.time())}"
    workflows_store[workflow_id] = {
        "nodes": [node.dict() for node in workflow.nodes],
        "edges": [edge.dict() for edge in workflow.edges],
        "created_at": time.time()
    }
    return {"workflow_id": workflow_id, "message": "Workflow saved successfully"}

@app.post("/execute-workflow")
async def execute_workflow(chat_data: ChatMessage):
    try:
        user_query = chat_data.message

        if not documents_store:
            return {
                "response": "No documents have been uploaded yet. Please upload a PDF document first to enable knowledge-based responses."
            }

        latest_doc_id = max(documents_store.keys(), key=lambda x: documents_store[x]["upload_time"])
        document = documents_store[latest_doc_id]

        doc_text = document["text"].lower()
        query_lower = user_query.lower()
        sentences = doc_text.split('.')
        relevant_sentences = [s.strip() for s in sentences if any(word in s.lower() for word in query_lower.split())]

        context = '. '.join(relevant_sentences[:3]) if relevant_sentences else document["text"][:500]

        openai_key = os.getenv("OPENAI_API_KEY")

        if openai_key:
            try:
                import openai
                openai.api_key = openai_key

                response = openai.ChatCompletion.create(
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
                pass  # Fall back to mock

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
    return {"documents": documents_store}

@app.get("/embeddings")
async def get_embeddings():
    return {"embeddings": {k: {"method": v["method"], "chunks_count": len(v["chunks"])} for k, v in embeddings_store.items()}}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

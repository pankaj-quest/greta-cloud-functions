"""
Chat API - FastAPI Backend with MongoDB Atlas
Each chat deploys to Cloud Run with unique chatId
"""
from fastapi import FastAPI, HTTPException, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone
from dotenv import load_dotenv
import uuid
import os
import logging
from pathlib import Path

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.environ.get('DB_NAME', 'chat-testing')
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

# Create the main app
app = FastAPI(title="Chat API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# ============================================
# Pydantic Models
# ============================================

# --- Message Schema ---
class MessageCreate(BaseModel):
    content: str
    sender: str = "user"  # "user" or "bot" or "system"
    metadata: Optional[dict] = None  # For tool calls, code blocks, etc.

class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    conversation_id: str
    content: str
    sender: str = "user"  # "user" | "bot" | "system"
    metadata: Optional[dict] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# --- Conversation Schema ---
class ConversationCreate(BaseModel):
    title: Optional[str] = "New Project"

class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    preview_url: Optional[str] = None

class Conversation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # This is the chatId
    title: str = "New Project"
    status: str = "creating"  # "creating" | "deploying" | "running" | "stopped" | "error"
    preview_url: Optional[str] = None  # Cloud Run URL for iframe preview
    cloud_run_service: Optional[str] = None  # Cloud Run service name
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ============================================
# Routes
# ============================================

@api_router.get("/")
async def root():
    return {"message": "Chat API is running!"}

# --- Conversations (each chat = unique Cloud Run deployment) ---

@api_router.get("/conversations", response_model=List[Conversation])
async def get_conversations():
    """Get all conversations/projects"""
    convos = await db.conversations.find({}, {"_id": 0}).sort("updated_at", -1).to_list(100)
    return convos

@api_router.post("/conversations", response_model=Conversation)
async def create_conversation(input: ConversationCreate):
    """Create a new conversation - triggers Cloud Run deployment"""
    convo = Conversation(title=input.title)
    convo_dict = convo.model_dump()
    convo_dict["created_at"] = convo_dict["created_at"].isoformat()
    convo_dict["updated_at"] = convo_dict["updated_at"].isoformat()
    await db.conversations.insert_one(convo_dict)

    # TODO: Trigger Cloud Run deployment here
    # preview_url = deploy_to_cloud_run(convo.id)

    return convo

@api_router.get("/conversations/{chat_id}", response_model=Conversation)
async def get_conversation(chat_id: str):
    """Get a specific conversation by chatId"""
    convo = await db.conversations.find_one({"id": chat_id}, {"_id": 0})
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return convo

@api_router.patch("/conversations/{chat_id}", response_model=Conversation)
async def update_conversation(chat_id: str, input: ConversationUpdate):
    """Update conversation (title, status, preview_url)"""
    update_data = {k: v for k, v in input.model_dump().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = await db.conversations.update_one(
        {"id": chat_id},
        {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")

    convo = await db.conversations.find_one({"id": chat_id}, {"_id": 0})
    return convo

@api_router.delete("/conversations/{chat_id}")
async def delete_conversation(chat_id: str):
    """Delete a conversation and its messages"""
    result = await db.conversations.delete_one({"id": chat_id})
    await db.messages.delete_many({"conversation_id": chat_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # TODO: Stop/delete Cloud Run service

    return {"message": "Conversation deleted", "id": chat_id}

# --- Messages ---

@api_router.get("/conversations/{chat_id}/messages", response_model=List[Message])
async def get_messages(chat_id: str):
    """Get all messages for a conversation"""
    messages = await db.messages.find(
        {"conversation_id": chat_id}, {"_id": 0}
    ).sort("timestamp", 1).to_list(1000)
    return messages

@api_router.post("/conversations/{chat_id}/messages", response_model=Message)
async def create_message(chat_id: str, input: MessageCreate):
    """Create a new message in a conversation"""
    # Check if conversation exists, create if not
    convo = await db.conversations.find_one({"id": chat_id})
    if not convo:
        new_convo = Conversation(id=chat_id, title=f"Project {chat_id[:8]}")
        convo_dict = new_convo.model_dump()
        convo_dict["created_at"] = convo_dict["created_at"].isoformat()
        convo_dict["updated_at"] = convo_dict["updated_at"].isoformat()
        await db.conversations.insert_one(convo_dict)

    # Create message
    message = Message(
        conversation_id=chat_id,
        content=input.content,
        sender=input.sender,
        metadata=input.metadata
    )
    msg_dict = message.model_dump()
    msg_dict["timestamp"] = msg_dict["timestamp"].isoformat()
    await db.messages.insert_one(msg_dict)

    # Update conversation timestamp
    await db.conversations.update_one(
        {"id": chat_id},
        {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )

    return message

@api_router.delete("/conversations/{chat_id}/messages/{message_id}")
async def delete_message(chat_id: str, message_id: str):
    """Delete a specific message"""
    result = await db.messages.delete_one({"id": message_id, "conversation_id": chat_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"message": "Message deleted", "id": message_id}

# Include the router
app.include_router(api_router)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


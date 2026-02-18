from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.environ.get('DB_NAME', 'todo_database')
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

# Create the main app
app = FastAPI(title="Todo API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Define Models
class TodoCreate(BaseModel):
    title: str
    description: Optional[str] = ""

class TodoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    completed: Optional[bool] = None

class Todo(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str = ""
    completed: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Routes
@api_router.get("/")
async def root():
    return {"message": "Todo API is running!"}

@api_router.get("/todos", response_model=List[Todo])
async def get_todos():
    todos = await db.todos.find({}, {"_id": 0}).to_list(100)
    return todos

@api_router.post("/todos", response_model=Todo)
async def create_todo(todo_input: TodoCreate):
    todo = Todo(title=todo_input.title, description=todo_input.description)
    todo_dict = todo.model_dump()
    # Convert datetime to string for MongoDB
    todo_dict["created_at"] = todo_dict["created_at"].isoformat()
    await db.todos.insert_one(todo_dict)
    return todo

@api_router.put("/todos/{todo_id}", response_model=Todo)
async def update_todo(todo_id: str, todo_update: TodoUpdate):
    update_data = {k: v for k, v in todo_update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")

    result = await db.todos.update_one({"id": todo_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Todo not found")

    updated_todo = await db.todos.find_one({"id": todo_id}, {"_id": 0})
    return updated_todo

@api_router.delete("/todos/{todo_id}")
async def delete_todo(todo_id: str):
    result = await db.todos.delete_one({"id": todo_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"message": "Todo deleted", "id": todo_id}

# Include the router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shutdown handler to close MongoDB connection
@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


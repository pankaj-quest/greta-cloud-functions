import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Plus, Loader2 } from "lucide-react";

interface Todo {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  created_at: string;
}

const API_URL = "/api";

const Index = () => {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodo, setNewTodo] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // Fetch todos on mount
  useEffect(() => {
    fetchTodos();
  }, []);

  const fetchTodos = async () => {
    try {
      const response = await fetch(`${API_URL}/todos`);
      if (response.ok) {
        const data = await response.json();
        setTodos(data);
      }
    } catch (error) {
      console.error("Error fetching todos:", error);
    } finally {
      setLoading(false);
    }
  };

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodo.trim()) return;

    setAdding(true);
    try {
      const response = await fetch(`${API_URL}/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTodo, description: "" }),
      });
      if (response.ok) {
        const todo = await response.json();
        setTodos([...todos, todo]);
        setNewTodo("");
      }
    } catch (error) {
      console.error("Error adding todo:", error);
    } finally {
      setAdding(false);
    }
  };

  const toggleTodo = async (id: string, completed: boolean) => {
    try {
      const response = await fetch(`${API_URL}/todos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !completed }),
      });
      if (response.ok) {
        setTodos(todos.map((t) => (t.id === id ? { ...t, completed: !completed } : t)));
      }
    } catch (error) {
      console.error("Error updating todo:", error);
    }
  };

  const deleteTodo = async (id: string) => {
    try {
      const response = await fetch(`${API_URL}/todos/${id}`, { method: "DELETE" });
      if (response.ok) {
        setTodos(todos.filter((t) => t.id !== id));
      }
    } catch (error) {
      console.error("Error deleting todo:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-orange-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Card className="shadow-lg border-orange-200">
          <CardHeader className="bg-gradient-to-r from-orange-400 to-orange-500 text-white rounded-t-lg">
            <CardTitle className="text-2xl font-bold text-center">
              📝 Todo App with MongoDB
            </CardTitle>
            <p className="text-center text-orange-100 text-sm">
              Data persists in MongoDB (backed up to GCS)
            </p>
          </CardHeader>
          <CardContent className="p-6">
            {/* Add Todo Form */}
            <form onSubmit={addTodo} className="flex gap-2 mb-6">
              <Input
                value={newTodo}
                onChange={(e) => setNewTodo(e.target.value)}
                placeholder="What needs to be done?"
                className="flex-1 border-orange-200 focus:border-orange-400"
              />
              <Button type="submit" disabled={adding} className="bg-orange-500 hover:bg-orange-600">
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </Button>
            </form>

            {/* Todo List */}
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
              </div>
            ) : todos.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No todos yet. Add one above!</p>
            ) : (
              <ul className="space-y-2">
                {todos.map((todo) => (
                  <li
                    key={todo.id}
                    className="flex items-center gap-3 p-3 bg-white rounded-lg border border-orange-100 hover:border-orange-200 transition-colors"
                  >
                    <Checkbox
                      checked={todo.completed}
                      onCheckedChange={() => toggleTodo(todo.id, todo.completed)}
                      className="border-orange-300 data-[state=checked]:bg-orange-500"
                    />
                    <span className={`flex-1 ${todo.completed ? "line-through text-gray-400" : ""}`}>
                      {todo.title}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteTodo(todo.id)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-center text-xs text-gray-400 mt-6">
              {todos.length} todo{todos.length !== 1 ? "s" : ""} • Powered by FastAPI + MongoDB
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Index;

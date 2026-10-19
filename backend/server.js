const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool, types } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// PostgreSQL BIGINT IDs are returned as strings by default.
// This demo uses numeric IDs for its frontend.
types.setTypeParser(20, value => Number(value));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.use(cors());
app.use(express.json({ limit: "10kb" }));

// Serve the frontend from the same server.
app.use(express.static(path.join(__dirname, "../frontend")));

// Health check
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Database health check failed:", error.message);
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

// GET /api/todos — retrieve all tasks
app.get("/api/todos", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, done, created_at
      FROM todos
      ORDER BY id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Fetch todos failed:", error.message);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// POST /api/todos — create a task
app.post("/api/todos", async (req, res) => {
  const title = req.body?.title;

  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({
      error: "A non-empty title is required"
    });
  }

  if (title.trim().length > 200) {
    return res.status(400).json({
      error: "Title must be 200 characters or fewer"
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO todos (title)
       VALUES ($1)
       RETURNING id, title, done, created_at`,
      [title.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Create todo failed:", error.message);
    res.status(500).json({ error: "Failed to create task" });
  }
});

// PATCH /api/todos/:id — update completion
app.patch("/api/todos/:id", async (req, res) => {
  const { id } = req.params;

  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({ error: "Invalid task ID" });
  }

  if (typeof req.body?.done !== "boolean") {
    return res.status(400).json({
      error: "The done field must be a boolean"
    });
  }

  try {
    const result = await pool.query(
      `UPDATE todos
       SET done = $1
       WHERE id = $2
       RETURNING id, title, done, created_at`,
      [req.body.done, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Update todo failed:", error.message);
    res.status(500).json({ error: "Failed to update task" });
  }
});

// DELETE /api/todos/:id — delete a task
app.delete("/api/todos/:id", async (req, res) => {
  const { id } = req.params;

  if (!/^[1-9]\d*$/.test(id)) {
    return res.status(400).json({ error: "Invalid task ID" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM todos WHERE id = $1 RETURNING id",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.status(204).end();
  } catch (error) {
    console.error("Delete todo failed:", error.message);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// Handle invalid JSON bodies.
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  next(error);
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Taskflow server listening on port ${PORT}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
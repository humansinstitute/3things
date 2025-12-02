import { Database } from "bun:sqlite";

export type TodoState = "new" | "ready" | "in_progress" | "done";
export type TodoPriority = "rock" | "pebble" | "sand";

export type Todo = {
  id: number;
  title: string;
  owner: string;
  description: string;
  priority: TodoPriority;
  state: TodoState;
  done: number;
  deleted: number;
  created_at: string;
  scheduled_for: string | null;
};

export type Summary = {
  id: number;
  owner: string;
  summary_date: string;
  day_ahead: string | null;
  week_ahead: string | null;
  suggestions: string | null;
  created_at: string;
  updated_at: string;
};

const db = new Database("do-the-other-stuff.sqlite");

db.run(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const addColumn = (sql: string) => {
  try {
    db.run(sql);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("duplicate column")) {
      throw error;
    }
  }
};

addColumn("ALTER TABLE todos ADD COLUMN description TEXT DEFAULT ''");
addColumn("ALTER TABLE todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'sand'");
addColumn("ALTER TABLE todos ADD COLUMN state TEXT NOT NULL DEFAULT 'new'");
addColumn("ALTER TABLE todos ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
addColumn("ALTER TABLE todos ADD COLUMN owner TEXT NOT NULL DEFAULT ''");
addColumn("ALTER TABLE todos ADD COLUMN scheduled_for TEXT DEFAULT NULL");

db.run(`
  CREATE TABLE IF NOT EXISTS ai_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    summary_date TEXT NOT NULL,
    day_ahead TEXT NULL,
    week_ahead TEXT NULL,
    suggestions TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner, summary_date)
  )
`);

const listByOwnerStmt = db.query<Todo>(
  "SELECT * FROM todos WHERE deleted = 0 AND owner = ? ORDER BY created_at DESC"
);
const listScheduledStmt = db.query<Todo>(
  `SELECT * FROM todos
   WHERE deleted = 0
     AND owner = ?
     AND scheduled_for IS NOT NULL
     AND scheduled_for != ''
     AND date(scheduled_for) <= date(?)
   ORDER BY scheduled_for ASC, created_at DESC`
);
const listUnscheduledStmt = db.query<Todo>(
  `SELECT * FROM todos
   WHERE deleted = 0
     AND owner = ?
     AND (scheduled_for IS NULL OR scheduled_for = '')
   ORDER BY created_at DESC`
);
const insertStmt = db.query(
  "INSERT INTO todos (title, description, priority, state, done, owner) VALUES (?, '', 'sand', 'new', 0, ?) RETURNING *"
);
const deleteStmt = db.query("UPDATE todos SET deleted = 1 WHERE id = ? AND owner = ?");
const updateStmt = db.query<Todo>(
  `UPDATE todos
   SET
    title = ?,
    description = ?,
    priority = ?,
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END,
    scheduled_for = ?
   WHERE id = ? AND owner = ?
   RETURNING *`
);
const transitionStmt = db.query<Todo>(
  `UPDATE todos
   SET
    state = ?,
    done = CASE WHEN ? = 'done' THEN 1 ELSE 0 END
   WHERE id = ? AND owner = ?
   RETURNING *`
);
const upsertSummaryStmt = db.query<Summary>(
  `INSERT INTO ai_summaries (owner, summary_date, day_ahead, week_ahead, suggestions)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(owner, summary_date) DO UPDATE SET
     day_ahead = excluded.day_ahead,
     week_ahead = excluded.week_ahead,
     suggestions = excluded.suggestions,
     updated_at = CURRENT_TIMESTAMP
   RETURNING *`
);
const latestDaySummaryStmt = db.query<Summary>(
  `SELECT * FROM ai_summaries
   WHERE owner = ? AND summary_date = ?
   ORDER BY updated_at DESC
   LIMIT 1`
);
const latestWeekSummaryStmt = db.query<Summary>(
  `SELECT * FROM ai_summaries
   WHERE owner = ? AND summary_date BETWEEN ? AND ?
   ORDER BY updated_at DESC
   LIMIT 1`
);

export function listTodos(owner: string | null) {
  if (!owner) return [];
  return listByOwnerStmt.all(owner);
}

export function listScheduledTodos(owner: string, endDate: string) {
  return listScheduledStmt.all(owner, endDate);
}

export function listUnscheduledTodos(owner: string) {
  return listUnscheduledStmt.all(owner);
}

export function addTodo(title: string, owner: string) {
  if (!title.trim()) return null;
  const todo = insertStmt.get(title.trim(), owner) as Todo | undefined;
  return todo ?? null;
}

export function deleteTodo(id: number, owner: string) {
  deleteStmt.run(id, owner);
}

export function updateTodo(
  id: number,
  owner: string,
  fields: {
    title: string;
    description: string;
    priority: TodoPriority;
    state: TodoState;
    scheduled_for: string | null;
  }
) {
  const todo = updateStmt.get(
    fields.title,
    fields.description,
    fields.priority,
    fields.state,
    fields.state,
    fields.scheduled_for,
    id,
    owner
  ) as Todo | undefined;
  return todo ?? null;
}

export function transitionTodo(id: number, owner: string, state: TodoState) {
  const todo = transitionStmt.get(state, state, id, owner) as Todo | undefined;
  return todo ?? null;
}

export function assignAllTodosToOwner(npub: string) {
  if (!npub) return;
  db.run("UPDATE todos SET owner = ? WHERE owner = '' OR owner IS NULL", npub);
}

export function upsertSummary({
  owner,
  summaryDate,
  dayAhead,
  weekAhead,
  suggestions,
}: {
  owner: string;
  summaryDate: string;
  dayAhead: string | null;
  weekAhead: string | null;
  suggestions: string | null;
}) {
  const summary = upsertSummaryStmt.get(owner, summaryDate, dayAhead, weekAhead, suggestions) as Summary | undefined;
  return summary ?? null;
}

export function getLatestSummaries(owner: string, today: string, weekStart: string, weekEnd: string) {
  const day = latestDaySummaryStmt.get(owner, today) as Summary | undefined;
  const week = latestWeekSummaryStmt.get(owner, weekStart, weekEnd) as Summary | undefined;
  return { day: day ?? null, week: week ?? null };
}

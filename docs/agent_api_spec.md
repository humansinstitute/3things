# Agent API Specification

Local-only endpoints for AI agents to fetch todos and submit summaries. All endpoints assume the agent runs on localhost; no authentication required. Dates use the server’s local time.

## Base URL
- `http://localhost:3000`

## Todos Feed

### GET `/ai/tasks/:days/:includeUnscheduled?`
Fetch scheduled and unscheduled todos for a given horizon.

- `:days` — integer > 0 (e.g., `7`, `31`). End date is `today + days - 1`.
- `:includeUnscheduled` — optional `yes|no` (default `yes`).
- Query params:
  - `owner` (required): npub of the user.

Behavior:
- Includes todos with `scheduled_for` on/before the end date, even if overdue (past dates are treated as urgent).
- Unscheduled todos appear in `unscheduled` when `includeUnscheduled` is `yes`.

Example:
```bash
curl -s 'http://localhost:3000/ai/tasks/7/yes?owner=npub1abc...'
```

Response:
```json
{
  "owner": "npub1abc...",
  "range_days": 7,
  "generated_at": "2025-12-02T02:00:55.628Z",
  "scheduled": [
    {
      "id": 8,
      "title": "Setup humanitix for first two workshops",
      "description": "",
      "priority": "pebble",
      "state": "new",
      "scheduled_for": "2025-11-28",
      "tags": "work,events",
      "created_at": "2025-11-13 10:31:26"
    }
  ],
  "unscheduled": [
    {
      "id": 6,
      "title": "Build todo list starter app",
      "description": "",
      "priority": "sand",
      "state": "in_progress",
      "scheduled_for": null,
      "tags": "",
      "created_at": "2025-11-13 10:30:58"
    }
  ]
}
```

Note: The `tags` field contains a comma-separated string of tags (e.g., `"work,urgent"`) or an empty string if no tags are assigned.

## Create Tasks

### POST `/ai/tasks`
Create one or more tasks for a user. Useful for AI agents that analyze existing todos and generate follow-up tasks or project breakdowns.

Body (JSON):
```json
{
  "owner": "npub1abc...",
  "tasks": [
    {
      "title": "Research competitor features",
      "description": "Look at top 3 competitors and document their key features",
      "priority": "pebble",
      "state": "new",
      "scheduled_for": "2025-12-20",
      "tags": "research,product"
    },
    {
      "title": "Draft project scope document",
      "priority": "rock"
    }
  ]
}
```

Rules:
- `owner` (required): npub of the user.
- `tasks` (required): Array of 1–50 task objects.
- Each task requires `title` (non-empty, max 500 chars).
- Optional fields with defaults:
  - `description`: free text (default: `""`)
  - `priority`: `rock` | `pebble` | `sand` (default: `"sand"`)
  - `state`: `new` | `ready` | `in_progress` | `done` (default: `"new"`)
  - `scheduled_for`: `YYYY-MM-DD` or `null` (default: `null`)
  - `tags`: comma-separated string (default: `""`)
- Invalid priority/state values are normalized to defaults.
- Invalid dates are ignored (set to `null`).

Example:
```bash
curl -s -X POST 'http://localhost:3000/ai/tasks' \
  -H 'Content-Type: application/json' \
  -d '{
    "owner": "npub1abc...",
    "tasks": [
      {"title": "Review project requirements", "priority": "rock"},
      {"title": "Set up development environment", "tags": "setup"}
    ]
  }'
```

Response:
```json
{
  "owner": "npub1abc...",
  "created_at": "2025-12-16T10:30:00.000Z",
  "created": [
    {
      "id": 42,
      "title": "Review project requirements",
      "description": "",
      "priority": "rock",
      "state": "new",
      "scheduled_for": null,
      "tags": "",
      "created_at": "2025-12-16 10:30:00"
    },
    {
      "id": 43,
      "title": "Set up development environment",
      "description": "",
      "priority": "sand",
      "state": "new",
      "scheduled_for": null,
      "tags": "setup",
      "created_at": "2025-12-16 10:30:00"
    }
  ],
  "failed": []
}
```

Error handling:
- Tasks with missing/empty titles are skipped and reported in `failed` array.
- The `failed` array contains objects with `index`, `title`, and `reason` fields.
- Partial success is possible: some tasks may be created while others fail.

## Submit Summaries

### POST `/ai/summary`
Upsert daily/weekly free-text summaries for a user.

Body (JSON):
```json
{
  "owner": "npub1abc...",
  "summary_date": "2025-12-02",
  "day_ahead": "Lead with overdue workshop setup...",
  "week_ahead": "Finish workshop logistics, onboard teammate...",
  "suggestions": "1) Prioritize overdue items; 2) Timebox..."
}
```

Rules:
- `owner` and `summary_date` required (`YYYY-MM-DD`).
- At least one of `day_ahead`, `week_ahead`, `suggestions` must be present.
- Text fields are trimmed and capped at ~10k chars.
- Upserts a single row per (`owner`, `summary_date`), updating `updated_at`.

Response:
```json
{
  "owner": "npub1abc...",
  "summary_date": "2025-12-02",
  "updated_at": "2025-12-02 02:01:53"
}
```

## Fetch Latest Summaries (for UI or agent verification)

### GET `/ai/summary/latest?owner=npub1abc...`
Returns the latest summaries for today and the current week.

Example:
```bash
curl -s 'http://localhost:3000/ai/summary/latest?owner=npub1abc...'
```

Response:
```json
{
  "owner": "npub1abc...",
  "day": {
    "summary_date": "2025-12-02",
    "day_ahead": "Lead with overdue workshop setup...",
    "suggestions": "1) Prioritize overdue items...",
    "updated_at": "2025-12-02 02:01:53"
  },
  "week": {
    "summary_date": "2025-11-28",
    "week_ahead": "Finish workshop logistics...",
    "suggestions": "1) Prioritize overdue items...",
    "updated_at": "2025-12-02 02:01:53"
  }
}
```

Week selection:
- The API selects the most recent summary whose `summary_date` falls in the current week (Mon–Sun), preferring the latest `updated_at` if multiple exist.

## Workflow for an Agent

### Summary Agent
1) Fetch todos: `GET /ai/tasks/7/yes?owner=npub...`
2) Generate summaries based on scheduled + unscheduled tasks.
3) Post summaries: `POST /ai/summary` with `summary_date` = today.
4) (Optional) Verify: `GET /ai/summary/latest?owner=npub...`

### Task Creation Agent
1) Fetch todos: `GET /ai/tasks/7/yes?owner=npub...`
2) Analyze existing tasks and identify follow-ups, subtasks, or project breakdowns.
3) Create new tasks: `POST /ai/tasks` with array of tasks.
4) (Optional) Verify by fetching todos again.

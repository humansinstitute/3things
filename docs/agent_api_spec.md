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
      "created_at": "2025-11-13 10:30:58"
    }
  ]
}
```

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
1) Fetch todos: `GET /ai/tasks/7/yes?owner=npub...`
2) Generate summaries based on scheduled + unscheduled tasks.
3) Post summaries: `POST /ai/summary` with `summary_date` = today.
4) (Optional) Verify: `GET /ai/summary/latest?owner=npub...`

# AI Summary Feature

Design for the "Summary" feature that lets a local AI agent fetch upcoming todos and post back daily/weekly summaries. No scheduling/orchestration is in scope—just endpoints, data shapes, storage, and UI surfacing.

## Goals
- Allow an AI agent (localhost) to fetch upcoming and unscheduled todos for a given user and horizon (`/ai/tasks/:days`).
- Allow the agent to post back a free-text daily and weekly summary for that user (`/ai/summary`), overwriting prior entries for the same day/week while persisting history.
- Surface the latest summaries in the UI when present; otherwise keep the section hidden.

## Assumptions
- Per-user: all requests include `owner` (npub) to scope data.
- Auth: localhost-only, no auth needed.
- Timezone: server local time; dates as ISO date strings (`YYYY-MM-DD`) using server clock.
- Size: up to ~10k chars per text field is acceptable.
- Overwrite semantics: newest post for a given scope replaces the displayed one; we still store history with timestamps.

## Data Model

### Todos (existing + scheduling)
- Current fields: `id`, `title`, `description`, `priority`, `state`, `done`, `deleted`, `owner`, `created_at`.
- **Scheduling**: add `scheduled_for TEXT NULL` (ISO date). Interpret as the intended work date.
  - Upcoming query uses `scheduled_for` between `today` and `today + days`.
  - Unscheduled = `scheduled_for IS NULL`.
  - If `scheduled_for` absent on a row, treat as unscheduled for filtering and responses.

### Summaries (new table)
- `id INTEGER PRIMARY KEY`
- `owner TEXT NOT NULL` (npub)
- `summary_date TEXT NOT NULL` (`YYYY-MM-DD`; anchor date for both day/week views—e.g., “today”)
- `day_ahead TEXT NULL` (free text; optional)
- `week_ahead TEXT NULL` (free text; optional)
- `suggestions TEXT NULL` (free text; optional)
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- Uniqueness: (`owner`, `summary_date`) so POST overwrites the latest for that day; keep `updated_at` to track freshness. Display uses the latest row for `summary_date = today` (day) and the latest row whose `summary_date` falls in the current week (week), preferring most recent `updated_at` when multiple exist.

## API Contracts (agent ↔ app)

### Fetch tasks for summarization
- `GET /ai/tasks/:days/:includeUnscheduled?`
  - `:days` number; e.g. `7` (default agent call) or `31` fallback.
  - `:includeUnscheduled` optional: `yes|no` (default `yes` if omitted). `yes` includes unscheduled array; `no` omits.
  - Query/body: none; assumes localhost. Requires `owner` header or query? → propose query `?owner=npub...`.
  - Response `200`:
    ```json
    {
      "owner": "<npub>",
      "range_days": 7,
      "generated_at": "2024-05-09T10:00:00Z",
      "scheduled": [
        {
          "id": 1,
          "title": "Ship feature",
          "description": "…",
          "priority": "rock",
          "state": "ready",
          "scheduled_for": "2024-05-10",
          "created_at": "2024-05-01T12:00:00Z"
        }
      ],
      "unscheduled": [
        { "id": 2, "title": "Backlog grooming", "description": "", "priority": "sand", "state": "new", "scheduled_for": null, "created_at": "2024-05-01T12:00:00Z" }
      ]
    }
    ```
  - Overdue handling: tasks with `scheduled_for` in the past are included in `scheduled` (treated as urgent “today”) even if older than the start date; we cap only by the provided end date (`today + days - 1`).
  - Empty result: `scheduled: []` and `unscheduled: []` as applicable; no error.

### Post summaries
- `POST /ai/summary`
  - Body:
    ```json
    {
      "owner": "<npub>",
      "summary_date": "2024-05-09",
      "day_ahead": "Your day has…",
      "week_ahead": "This week focus on…",
      "suggestions": "Start with rocks; group similar tasks…"
    }
    ```
  - Behavior:
    - Upsert a single row for (`owner`, `summary_date`); overwrite any existing row.
    - Any of `day_ahead`, `week_ahead`, `suggestions` may be omitted/null; UI shows whatever is present.
    - `updated_at` refreshed on write.
  - Response `200`:
    ```json
    {
      "owner": "<npub>",
      "summary_date": "2024-05-09",
      "updated_at": "…"
    }
    ```
  - Validation: require `owner`, `summary_date`, and at least one of `day_ahead|week_ahead|suggestions`.
  - Size: trim/limit to ~10k chars per text field.

### Fetch latest summaries for UI
- `GET /ai/summary/latest?owner=<npub>`
  - Returns the most recent row whose `summary_date` is today (day view) and the most recent row whose `summary_date` falls in the current week (week view).
  - Response:
    ```json
    {
      "owner": "<npub>",
      "day": { "summary_date": "2024-05-09", "day_ahead": "…", "suggestions": "…", "updated_at": "…" } | null,
      "week": { "summary_date": "2024-05-06", "week_ahead": "…", "suggestions": "…", "updated_at": "…" } | null
    }
    ```

## UI Surfacing
- Location: add a “Summaries” card/section on the home page.
- Visibility: hidden when both day/week summaries are absent for the logged-in user; shown when either exists.
- Content: show “Today” + “This week” blocks and “Suggestions” list; include updated-at timestamp. If only one exists, show what’s available.
- State updates: when client receives new summaries (e.g., after POST or page load), call `refreshUI()` to redraw controls.

## Flows
1) Agent fetches tasks via `GET /ai/tasks/7/yes?owner=npub`.
2) Agent generates text.
3) Agent posts via `POST /ai/summary` with `owner` and texts.
4) UI reads `GET /ai/summary/latest?owner=npub` and renders the card if data exists.

## Open Question
- Resolved: add `scheduled_for` to todos for scheduling; do not reuse `created_at`.

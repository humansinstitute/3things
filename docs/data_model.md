# Data Model

This app stores todos and AI summaries in SQLite (`do-the-other-stuff.sqlite`). All records are scoped by `owner` (npub). Schema creation and migrations are in `src/db.ts`.

## Tables

### `todos`
Tasks owned by a user.

| Column         | Type    | Notes                                                   |
| -------------- | ------- | ------------------------------------------------------- |
| `id`           | INTEGER | PK AUTOINCREMENT                                        |
| `title`        | TEXT    | Required                                                |
| `description`  | TEXT    | Free text                                               |
| `priority`     | TEXT    | `rock` \| `pebble` \| `sand`; default `sand`            |
| `state`        | TEXT    | `new` \| `ready` \| `in_progress` \| `done`; default `new` |
| `done`         | INTEGER | 0/1 mirror of `state === "done"`                        |
| `deleted`      | INTEGER | Soft delete flag; 0 active, 1 deleted                   |
| `owner`        | TEXT    | npub; required                                          |
| `created_at`   | TEXT    | Default `CURRENT_TIMESTAMP`                             |
| `scheduled_for`| TEXT    | `YYYY-MM-DD` or NULL; used for horizon and overdue logic |
| `tags`         | TEXT    | Comma-separated tags (e.g., `"work,urgent"`); default `''` |

Behavior:
- Soft delete via `deleted`.
- Scheduling: `scheduled_for` in the past counts as overdue and is returned in the scheduled feed (treated as “today” urgent).
- Updates set `done` automatically when `state` is `done`.
- Listing filters: active lists exclude `deleted = 1`; archive lists are `state === "done"`.

### `ai_summaries`
Free-text summaries per owner and date.

| Column        | Type    | Notes                                                   |
| ------------- | ------- | ------------------------------------------------------- |
| `id`          | INTEGER | PK AUTOINCREMENT                                        |
| `owner`       | TEXT    | npub; required                                          |
| `summary_date`| TEXT    | `YYYY-MM-DD`; anchor date for day/week views            |
| `day_ahead`   | TEXT    | Optional free text (day view)                           |
| `week_ahead`  | TEXT    | Optional free text (week view)                          |
| `suggestions` | TEXT    | Optional free text                                      |
| `created_at`  | TEXT    | Default `CURRENT_TIMESTAMP`                             |
| `updated_at`  | TEXT    | Default `CURRENT_TIMESTAMP`; refreshed on upsert        |

Constraints:
- `UNIQUE(owner, summary_date)`; upsert overwrites the row and bumps `updated_at`.

Selection rules:
- Latest day summary: row where `summary_date` == today, ordered by `updated_at` desc.
- Latest week summary: most recent row whose `summary_date` falls in the current week (Mon–Sun), preferring newest `updated_at`.

## Ownership & Auth
- All DB rows include `owner` (npub). The web app uses nostr-auth sessions in memory (`src/server.ts`), not persisted.
- AI endpoints are localhost-only and require `owner` as a query/body field; no auth token.

## Derived Lists
- Active todos: `deleted = 0` and `state != 'done'`.
- Archive: `state = 'done'`.
- Scheduled feed: `scheduled_for` <= requested end date (includes overdue).
- Unscheduled feed: `scheduled_for IS NULL OR = ''`.
- Tag filtered: todos where `tags` contains at least one of the requested tags (case-insensitive match).

## Not Stored
- Sessions are kept in-memory (`sessions` Map in `src/server.ts`), not in SQLite.

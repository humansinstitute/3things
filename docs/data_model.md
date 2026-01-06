# Data Model

Three Things stores encrypted gratitude journal entries in SQLite (`three-things.sqlite`). All records are scoped by `owner` (npub). Schema creation is in `src/db.ts`.

## Tables

### `entries`
Encrypted journal entries, 3 per day per user.

| Column              | Type    | Notes                                           |
| ------------------- | ------- | ----------------------------------------------- |
| `id`                | INTEGER | PK AUTOINCREMENT                                |
| `owner`             | TEXT    | npub; required                                  |
| `entry_date`        | TEXT    | `YYYY-MM-DD` in user's local timezone           |
| `slot`              | INTEGER | 1, 2, or 3 (the three daily things)             |
| `encrypted_content` | TEXT    | NIP-44 encrypted ciphertext                     |
| `created_at`        | TEXT    | Default `CURRENT_TIMESTAMP`                     |
| `updated_at`        | TEXT    | Default `CURRENT_TIMESTAMP`; refreshed on edit  |

Constraints:
- `UNIQUE(owner, entry_date, slot)` - one entry per slot per day per user
- Upsert pattern: editing an entry overwrites the existing row for that slot

Behavior:
- Entries are encrypted client-side using NIP-44 before being sent to the server
- Server stores only ciphertext; cannot read entry content
- Decryption happens client-side using the user's signing method
- Dates are determined by the client's local timezone

### Legacy Tables (unused)

The following tables exist from the previous todo app but are not used:

- `todos` - Previous task management data
- `ai_summaries` - Previous AI summary feature data

## Encryption

All entry content is encrypted using NIP-44:

1. **Encryption**: Client encrypts to user's own pubkey (self-encryption)
2. **Storage**: Server receives and stores only ciphertext
3. **Decryption**: Client decrypts using user's secret key via:
   - Browser extension (NIP-07 `nip44.decrypt`)
   - Ephemeral key (stored in localStorage)
   - PIN-protected secret (decrypted in memory)
   - Bunker signer (NIP-46)

## Ownership & Auth

- All DB rows include `owner` (npub)
- Web app uses Nostr auth with sessions stored in memory (`src/server.ts`)
- Session cookie (`nostr_session`) maps to in-memory session data
- No server-side user accounts; identity comes from Nostr keypair

## API Endpoints

### `GET /entries?date=YYYY-MM-DD`
Fetch entries for a specific date.

Response:
```json
{
  "entries": [
    {
      "id": 1,
      "owner": "npub1...",
      "entry_date": "2025-01-06",
      "slot": 1,
      "encrypted_content": "<nip44-ciphertext>",
      "created_at": "2025-01-06 10:30:00",
      "updated_at": "2025-01-06 10:30:00"
    }
  ]
}
```

### `GET /entries/recent?before=YYYY-MM-DD&limit=30`
Fetch recent entries before a date (for history/pagination).

### `POST /entries`
Save or update an entry (upsert by owner + date + slot).

Body:
```json
{
  "entry_date": "2025-01-06",
  "slot": 1,
  "encrypted_content": "<nip44-ciphertext>"
}
```

## Not Stored

- **Sessions**: Kept in-memory (`sessions` Map in `src/server.ts`), not in SQLite
- **Decrypted content**: Never sent to or stored on server
- **User profiles**: Fetched from Nostr relays, cached in browser localStorage

# Code Structure

Overview of the Three Things codebase layout.

## Server (`src/`)

| File | Purpose |
| ---- | ------- |
| `server.ts` | Bun entry point; wires routes, serves static assets from `public/` |
| `config.ts` | Central constants (port, app name, cookie names, paths) |
| `db.ts` | SQLite database setup, schema, and query functions for entries |
| `http.ts` | Response helpers (`jsonResponse`, `redirect`, cookie parsing) |
| `types.ts` | Shared TypeScript types for sessions |

### Routes (`src/routes/`)

| File | Purpose |
| ---- | ------- |
| `auth.ts` | Login/logout handlers, session management |
| `entries.ts` | Journal entry CRUD (get, save encrypted entries) |
| `home.ts` | Home page route handler |

### Render (`src/render/`)

| File | Purpose |
| ---- | ------- |
| `home.ts` | Server-rendered HTML template for the app shell |

## Client (`public/`)

### Core Modules

| File | Purpose |
| ---- | ------- |
| `app.js` | Entry point; initializes all modules |
| `app.css` | All styles (warm diary theme, responsive layout) |
| `state.js` | Client state management (`session`) |
| `dom.js` | DOM element references |
| `ui.js` | UI helpers (show/hide panels, error display) |

### Authentication

| File | Purpose |
| ---- | ------- |
| `auth.js` | Login flow, auto-login, logout |
| `pin.js` | PIN modal for encrypting/decrypting secrets |
| `nostr.js` | Nostr library loading and helpers |
| `crypto.js` | Cryptographic utilities |

### Journal Features

| File | Purpose |
| ---- | ------- |
| `entries.js` | Entry management (load, save, render today/history) |
| `entryCrypto.js` | NIP-44 encryption/decryption for entries |

### Profile & Avatar

| File | Purpose |
| ---- | ------- |
| `avatar.js` | Avatar display, profile modal, profile editing |

### PWA Features

| File | Purpose |
| ---- | ------- |
| `sw.js` | Service worker (caching external libs, images) |
| `pullRefresh.js` | Pull-to-refresh for mobile |
| `manifest.webmanifest` | PWA manifest |
| `constants.js` | Client-side constants |

## Patterns

### Server
- **Thin handlers**: Routes delegate to db functions, minimal business logic
- **Session in memory**: Sessions stored in Map, not database
- **Static serving**: `public/` served directly by Bun

### Client
- **ES Modules**: All JS uses native ES modules
- **State pattern**: `state.js` holds session; modules import as needed
- **Lazy loading**: Nostr libraries loaded on-demand from esm.sh
- **Encryption first**: Content encrypted before leaving browser

### Rendering
- **Server-side HTML**: Initial page rendered by `src/render/home.ts`
- **Client hydration**: `app.js` bootstraps modules after page load
- **Session seed**: `window.__NOSTR_SESSION__` set inline for initial state

## When Adding Features

1. **Database changes**: Update schema and queries in `src/db.ts`
2. **New endpoints**: Add route handler in `src/routes/`, wire in `src/server.ts`
3. **UI changes**: Update `src/render/home.ts` for markup, `public/app.css` for styles
4. **Client behavior**: Add/update module in `public/`, import in `app.js`
5. **Service worker**: Bump `CACHE_NAME` version, add new files to `LOCAL_ASSETS`

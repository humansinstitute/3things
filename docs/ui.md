# UI Guide

How the Three Things journal UI is structured and styled.

## Design Philosophy

The UI is designed to feel like writing in a personal diary:
- **Warm color palette**: Cream backgrounds, ivory surfaces, warm browns
- **Serif typography**: Georgia for headers and dates
- **Minimal chrome**: Focus on the writing, not the interface
- **One thing at a time**: Entry flow guides you through each of the three things

## Page Structure

Single HTML page rendered server-side in `src/render/home.ts`:

```
┌─────────────────────────────────────┐
│  Header (title + avatar menu)       │
├─────────────────────────────────────┤
│  Auth Panel (when logged out)       │
│  - Welcome message                  │
│  - "Begin Writing, Anon" button     │
│  - Advanced options (extension,     │
│    bunker, secret)                  │
├─────────────────────────────────────┤
│  Journal (when logged in)           │
│  ┌─────────────────────────────────┐│
│  │ Today Section                   ││
│  │ - Date header                   ││
│  │ - Completed entries (clickable) ││
│  │ - Entry form (current slot)     ││
│  │ - Progress indicator            ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │ History Section                 ││
│  │ - "Looking Back" header         ││
│  │ - Past days with entries        ││
│  │ - Load more button              ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  Modals (hidden by default)         │
│  - PIN modal                        │
│  - Profile modal                    │
│  - QR code modal                    │
└─────────────────────────────────────┘
```

## Entry Flow

### Adding Entries
1. User sees prompt: "What made today good?"
2. Types in textarea, presses "Continue" (or Shift+Enter)
3. Entry encrypts and saves; appears above as completed
4. Next prompt: "What else are you grateful for?"
5. Repeat for third: "One more thing..."
6. After 3 entries: "All three things captured"

### Editing Entries
- Click any completed entry to edit it
- Form populates with existing content
- Press Escape to cancel editing
- Editing only available for today's entries

## Styling

### Theme Variables (`public/app.css`)

```css
:root {
  --bg: #f8f5f0;           /* Page background (warm cream) */
  --surface: #fffcf7;       /* Card background (ivory) */
  --surface-warm: #faf7f2;  /* Hover states */
  --border: #e8e2d9;        /* Borders */
  --border-soft: #efe9e0;   /* Subtle dividers */
  --text: #3d3833;          /* Main text (warm charcoal) */
  --text-warm: #5c554d;     /* Secondary text */
  --muted: #7a7267;         /* Muted text */
  --accent: #8b7355;        /* Buttons, highlights (warm brown) */
  --accent-light: #a69076;  /* Hover accent */
  --success: #6b8f71;       /* Completion state */

  --font-serif: Georgia, "Times New Roman", serif;
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

### Key Components

| Class | Purpose |
| ----- | ------- |
| `.today-section` | Main journal card for today |
| `.completed-entry` | Saved entry (clickable to edit) |
| `.entry-form` | Current entry input form |
| `.entry-input` | Textarea for writing |
| `.entry-prompt` | Italic prompt text |
| `.history-section` | Past entries container |
| `.history-day` | Single day's entries card |
| `.auth-panel` | Login options |
| `.avatar-menu` | Profile dropdown |

### Mobile Optimizations

- `touch-action: manipulation` prevents double-tap zoom
- `font-size: 16px` on inputs prevents iOS auto-zoom
- Viewport: `maximum-scale=1, user-scalable=no`
- Pull-to-refresh on touch devices

## Client Modules

### `entries.js`
- Manages today's entries and history
- Handles encryption/decryption via `entryCrypto.js`
- Renders completed entries and form state
- Wires up edit functionality

### `avatar.js`
- Avatar button and dropdown menu
- Profile modal (view and edit)
- Fetches profiles from Nostr relays
- Caches profiles in localStorage

### `auth.js`
- Login methods (ephemeral, extension, secret, bunker)
- Auto-login on page load
- Logout and session cleanup

### `pullRefresh.js`
- Touch gesture detection
- Pull indicator animation
- Triggers page reload

## Visibility Rules

| Element | Visible When |
| ------- | ------------ |
| Auth panel | No session |
| Avatar button | Has session |
| Journal section | Has session |
| Entry form | < 3 entries today, or editing |
| Today status | All 3 entries complete |
| History section | Has session |

## Keyboard Shortcuts

| Shortcut | Action |
| -------- | ------ |
| Shift+Enter | Save current entry |
| Escape | Cancel editing |

## Adding UI Features

1. Add markup in `src/render/home.ts`
2. Add styles in `public/app.css`
3. Add element refs in `public/dom.js`
4. Add behavior in appropriate module
5. Bump service worker cache version

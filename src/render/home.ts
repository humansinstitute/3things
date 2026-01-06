import { APP_NAME, NOSTR_RELAYS } from "../config";

import type { Session } from "../types";

type RenderArgs = {
  session: Session | null;
};

export function renderHomePage({ session }: RenderArgs) {
  return `<!doctype html>
<html lang="en">
${renderHead()}
<body>
  <main class="app-shell">
    ${renderHeader(session)}
    ${renderAuth(session)}
    ${renderJournal(session)}
    ${renderQrModal()}
    ${renderNostrConnectModal()}
    ${renderPinModal()}
    ${renderProfileModal()}
  </main>
  ${renderSessionSeed(session)}
  <script type="module" src="/app.js"></script>
</body>
</html>`;
}

function renderHead() {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <title>${APP_NAME}</title>
  <meta name="theme-color" content="#111111" />
  <meta name="application-name" content="${APP_NAME}" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/app.css" />
</head>`;
}

function renderHeader(session: Session | null) {
  return `<header class="page-header">
    <h1>${APP_NAME}</h1>
    <div class="session-controls" data-session-controls ${session ? "" : "hidden"}>
      <button class="avatar-chip" type="button" data-avatar ${session ? "" : "hidden"} title="Account menu">
        <span class="avatar-fallback" data-avatar-fallback>${session ? formatAvatarFallback(session.npub) : "•••"}</span>
        <img data-avatar-img alt="Profile photo" loading="lazy" ${session ? "" : "hidden"} />
      </button>
      <div class="avatar-menu" data-avatar-menu hidden>
        <button type="button" data-view-profile ${session ? "" : "hidden"}>View Profile</button>
        <button type="button" data-export-secret ${session?.method === "ephemeral" ? "" : "hidden"}>Export Secret</button>
        <button type="button" data-show-login-qr ${session?.method === "ephemeral" ? "" : "hidden"}>Show Login QR</button>
        <button type="button" data-copy-id ${session ? "" : "hidden"}>Copy ID</button>
        <button type="button" data-logout>Log out</button>
      </div>
    </div>
  </header>`;
}

function renderAuth(session: Session | null) {
  return `<section class="auth-panel" data-login-panel ${session ? "hidden" : ""}>
    <h2>Welcome to your journal</h2>
    <p class="auth-description">A quiet space to notice the good in each day. Record three things you're grateful for.</p>
    <div class="auth-actions">
      <button class="auth-option" type="button" data-login-method="ephemeral">Begin Writing, Anon</button>
    </div>
    <details class="auth-advanced">
      <summary>Already have a Nostr identity?</summary>
      <p class="auth-description" style="margin-top: 0.75rem; margin-bottom: 0.75rem; font-size: 0.9rem;">Connect with your browser extension or remote signer.</p>
      <button class="auth-option" type="button" data-login-method="extension">Browser extension</button>
      <button class="auth-option auth-nostr-connect" type="button" data-nostr-connect-btn>Nostr Connect (Mobile Signer)</button>
      <form data-bunker-form>
        <input name="bunker" placeholder="nostrconnect://… or name@example.com" autocomplete="off" />
        <button class="bunker-submit" type="submit">Connect bunker</button>
      </form>
      <form data-secret-form>
        <input type="password" name="secret" placeholder="nsec1…" autocomplete="off" />
        <button class="bunker-submit" type="submit">Sign in with secret</button>
      </form>
    </details>
    <p class="auth-error" data-login-error hidden></p>
  </section>`;
}

function renderJournal(session: Session | null) {
  // Always render full journal HTML (hidden when not logged in)
  // This allows soft login transitions without page reload
  return `<section class="journal" data-journal ${session ? "" : "hidden"}>
    <div class="today-section" data-today-section>
      <div class="today-header">
        <h2 class="today-date" data-today-date></h2>
        <span class="today-status" data-today-status hidden></span>
      </div>

      <div class="completed-entries" data-completed-entries></div>

      <div class="entry-form-container" data-entry-form-container>
        <form class="entry-form" data-entry-form>
          <label class="entry-prompt" data-entry-prompt>What's your first thing?</label>
          <textarea
            class="entry-input"
            data-entry-input
            name="content"
            rows="4"
            placeholder="Take a moment to reflect..."
            required
          ></textarea>
          <div class="entry-footer">
            <span class="entry-progress" data-entry-progress>Thing 1 of 3</span>
            <button type="submit" class="entry-submit" data-entry-submit>Save & Continue</button>
          </div>
        </form>
      </div>
    </div>

    <div class="history-section" data-history-section>
      <h2 class="history-title">Looking Back</h2>
      <div class="history-list" data-history-list>
        <p class="history-loading" data-history-loading>Loading...</p>
      </div>
      <div class="history-load-more" data-history-load-more hidden>
        <button type="button" data-load-more-btn>Load more</button>
      </div>
    </div>
  </section>`;
}

function renderQrModal() {
  return `<div class="qr-modal-overlay" data-qr-modal hidden>
    <div class="qr-modal">
      <button class="qr-modal-close" type="button" data-qr-close aria-label="Close">&times;</button>
      <h2>Login QR Code</h2>
      <p>Scan this code with your mobile device to log in</p>
      <div class="qr-canvas-container" data-qr-container></div>
    </div>
  </div>`;
}

function renderNostrConnectModal() {
  return `<div class="nostr-connect-overlay" data-nostr-connect-modal hidden>
    <div class="nostr-connect-modal">
      <button class="nostr-connect-close" type="button" data-nostr-connect-close aria-label="Close">&times;</button>
      <h2>Connect with Mobile Signer</h2>
      <p>Scan this QR code with Amber, Nostrsigner, or another NIP-46 signer app</p>
      <div class="nostr-connect-qr" data-nostr-connect-qr></div>
      <div class="nostr-connect-uri-wrapper">
        <input type="text" class="nostr-connect-uri" data-nostr-connect-uri readonly />
        <button type="button" class="nostr-connect-copy" data-nostr-connect-copy>Copy</button>
      </div>
      <p class="nostr-connect-status" data-nostr-connect-status>Waiting for connection...</p>
      <p class="nostr-connect-timer" data-nostr-connect-timer></p>
      <button type="button" class="nostr-connect-cancel" data-nostr-connect-cancel>Cancel</button>
    </div>
  </div>`;
}

function renderPinModal() {
  return `<div class="pin-modal-overlay" data-pin-modal hidden>
    <div class="pin-modal">
      <button class="pin-modal-close" type="button" data-pin-close aria-label="Close">&times;</button>
      <h2 data-pin-title>Enter PIN</h2>
      <p data-pin-description>Create a PIN to secure your secret key</p>
      <div class="pin-display" data-pin-display>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
        <span class="pin-dot" data-pin-dot></span>
      </div>
      <p class="pin-error" data-pin-error hidden></p>
      <div class="pin-keypad" data-pin-keypad>
        <button type="button" data-pin-key="1">1</button>
        <button type="button" data-pin-key="2">2</button>
        <button type="button" data-pin-key="3">3</button>
        <button type="button" data-pin-key="4">4</button>
        <button type="button" data-pin-key="5">5</button>
        <button type="button" data-pin-key="6">6</button>
        <button type="button" data-pin-key="7">7</button>
        <button type="button" data-pin-key="8">8</button>
        <button type="button" data-pin-key="9">9</button>
        <button type="button" data-pin-key="clear" class="pin-key-action">Clear</button>
        <button type="button" data-pin-key="0">0</button>
        <button type="button" data-pin-key="back" class="pin-key-action">&larr;</button>
      </div>
    </div>
  </div>`;
}

function renderProfileModal() {
  return `<div class="profile-modal-overlay" data-profile-modal hidden>
    <div class="profile-modal">
      <button class="profile-modal-close" type="button" data-profile-close aria-label="Close">&times;</button>

      <div class="profile-view" data-profile-view>
        <div class="profile-header">
          <div class="profile-avatar" data-profile-avatar></div>
          <div class="profile-info">
            <h2 class="profile-name" data-profile-name>Loading...</h2>
            <p class="profile-nip05" data-profile-nip05></p>
          </div>
        </div>
        <p class="profile-about" data-profile-about></p>
        <p class="profile-npub" data-profile-npub></p>
        <button type="button" class="profile-edit-btn" data-profile-edit-btn>Edit Profile</button>
      </div>

      <form class="profile-edit-form" data-profile-edit-form hidden>
        <h2>Edit Profile</h2>
        <label>
          Display Name
          <input type="text" name="displayName" data-profile-edit-name placeholder="Your name" />
        </label>
        <label>
          About
          <textarea name="about" data-profile-edit-about rows="3" placeholder="Tell us about yourself"></textarea>
        </label>
        <label>
          Profile Picture URL
          <input type="url" name="picture" data-profile-edit-picture placeholder="https://..." />
        </label>
        <p class="profile-edit-status" data-profile-edit-status hidden></p>
        <div class="profile-edit-actions">
          <button type="button" data-profile-edit-cancel>Cancel</button>
          <button type="submit">Save Profile</button>
        </div>
      </form>
    </div>
  </div>`;
}

function renderSessionSeed(session: Session | null) {
  return `<script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session ?? null)};
    window.__NOSTR_RELAYS__ = ${JSON.stringify(NOSTR_RELAYS)};
    window.__APP_NAME__ = ${JSON.stringify(APP_NAME)};
    window.__APP_FAVICON__ = "/favicon.png";
  </script>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "•••";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}

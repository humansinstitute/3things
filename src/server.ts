import {
  Todo,
  TodoPriority,
  TodoState,
  addTodo,
  deleteTodo,
  listTodos,
  transitionTodo,
  updateTodo,
} from "./db";
import { nip19 } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";
import { extname, join } from "path";

const PORT = Number(Bun.env.PORT ?? 3000);
const SESSION_COOKIE = "nostr_session";
const LOGIN_EVENT_KIND = 27235;
const LOGIN_MAX_AGE_SECONDS = 60;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const COOKIE_SECURE = Bun.env.NODE_ENV === "production";
const APP_NAME = "Other Stuff To Do";
const APP_TAG = "other-stuff-to-do";
const PUBLIC_DIR = join(import.meta.dir, "../public");

const STATIC_FILES = new Map<string, string>([
  ["/favicon.ico", "favicon.png"],
  ["/favicon.png", "favicon.png"],
  ["/apple-touch-icon.png", "apple-touch-icon.png"],
  ["/icon-192.png", "icon-192.png"],
  ["/icon-512.png", "icon-512.png"],
  ["/manifest.webmanifest", "manifest.webmanifest"],
]);

type LoginMethod = "ephemeral" | "extension" | "bunker";

type Session = {
  token: string;
  pubkey: string;
  npub: string;
  method: LoginMethod;
  createdAt: number;
};

type LoginRequestBody = {
  method?: LoginMethod;
  event?: {
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    content: string;
    created_at: number;
    tags: string[][];
  };
};

const sessions = new Map<string, Session>();

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;
    const session = getSessionFromRequest(req);

    if (req.method === "GET") {
      const staticResponse = await serveStatic(pathname);
      if (staticResponse) return staticResponse;
    }

    if (req.method === "GET" && pathname === "/") {
      return new Response(renderPage({ showArchive: url.searchParams.get("archive") === "1", session }), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (req.method === "POST" && pathname === "/auth/login") {
      return handleLogin(req);
    }

    if (req.method === "POST" && pathname === "/auth/logout") {
      return handleLogout(req);
    }

    if (req.method === "POST") {
      const form = await req.formData();

      if (pathname === "/todos") {
        if (!session) return unauthorized();
        addTodo(String(form.get("title") ?? ""), session.npub);
        return redirect("/");
      }

      const updateMatch = pathname.match(/^\/todos\/(\d+)\/update$/);
      if (updateMatch) {
        if (!session) return unauthorized();
        const id = Number(updateMatch[1]);
        const fields = parseUpdateForm(form);
        if (fields) {
          updateTodo(id, session.npub, fields);
        }
        return redirect("/");
      }

      const stateMatch = pathname.match(/^\/todos\/(\d+)\/state$/);
      if (stateMatch) {
        if (!session) return unauthorized();
        const id = Number(stateMatch[1]);
        const state = normalizeState(String(form.get("state") ?? ""));
        transitionTodo(id, session.npub, state);
        return redirect("/");
      }

      const deleteMatch = pathname.match(/^\/todos\/(\d+)\/delete$/);
      if (deleteMatch) {
        if (!session) return unauthorized();
        deleteTodo(Number(deleteMatch[1]), session.npub);
        return redirect("/");
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`${APP_NAME} ready on http://localhost:${server.port}`);

async function serveStatic(pathname: string) {
  const fileName = STATIC_FILES.get(pathname);
  if (!fileName) return null;
  const file = Bun.file(join(PUBLIC_DIR, fileName));
  if (!(await file.exists())) return null;
  return new Response(file, { headers: { "Content-Type": contentTypeFor(fileName) } });
}

function contentTypeFor(fileName: string) {
  const ext = extname(fileName).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".webmanifest":
    case ".json":
      return "application/manifest+json";
    default:
      return "application/octet-stream";
  }
}

function redirect(path: string) {
  return new Response(null, { status: 303, headers: { Location: path } });
}

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

function renderPage({ showArchive, session }: { showArchive: boolean; session: Session | null }) {
  const todos = session ? listTodos(session.npub) : [];
  const activeTodos = todos.filter((t) => t.state !== "done");
  const doneTodos = todos.filter((t) => t.state === "done");
  const remaining = session ? activeTodos.length : 0;
  const archiveHref = showArchive ? "/" : "/?archive=1";
  const archiveLabel = showArchive ? "Hide archive" : `Archive (${doneTodos.length})`;
  const emptyActiveMessage = session ? "No active work. Add something new!" : "Sign in to view your todos.";
  const emptyArchiveMessage = session ? "Nothing archived yet." : "Sign in to view your archive.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP_NAME}</title>
  <meta name="theme-color" content="#111111" />
  <meta name="application-name" content="${APP_NAME}" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <style>
    :root {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f4f4f4;
      color: #111;
    }
    body {
      margin: 0 auto;
      padding: 2rem;
      max-width: 640px;
    }
    h1 {
      margin-bottom: 0.25rem;
      font-size: clamp(2rem, 5vw, 3rem);
    }
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
    .session-controls {
      position: relative;
      min-height: 48px;
      min-width: 48px;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      padding-top: 0.65rem;
    }
    .avatar-chip {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      background: #111;
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      padding: 0;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.2);
      cursor: pointer;
      transition: transform 150ms ease, box-shadow 150ms ease;
    }
    .avatar-chip:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.25);
    }
    .avatar-chip img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .avatar-fallback {
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .avatar-menu {
      position: absolute;
      top: calc(100% + 0.5rem);
      right: 0;
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      padding: 0.25rem;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.2);
      min-width: 140px;
      z-index: 20;
    }
    .avatar-menu button {
      width: 100%;
      background: transparent;
      border: none;
      padding: 0.5rem 0.75rem;
      text-align: left;
      cursor: pointer;
      border-radius: 8px;
      font-size: 0.9rem;
    }
    .avatar-menu button:hover {
      background: #f3f4f6;
    }
    .subtitle {
      margin-top: 0;
      color: #666;
      font-size: 0.95rem;
    }
    .hero-entry {
      width: 100%;
      padding: 0;
      background: transparent;
      border: none;
      border-radius: 0;
      margin-top: 1.5rem;
      margin-bottom: 2rem;
      box-shadow: none;
    }
    .todo-form {
      margin: 0;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      max-width: 820px;
    }
    .hero-input-wrapper {
      width: 100%;
    }
    .hero-input {
      display: block;
      padding: 0.85rem 1rem;
      width: 100%;
      font-size: 1rem;
      border: 1px solid #0f172a;
      border-radius: 10px;
      box-sizing: border-box;
      line-height: 1.3;
      background: #fff;
      box-shadow: none;
    }
    .hero-submit:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 14px rgba(15, 23, 42, 0.25);
    }
    .remaining-summary {
      margin: 0 0 1rem;
      color: #333;
      font-weight: 500;
    }
    button {
      border: none;
      background: #111;
      color: #fff;
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    ul {
      list-style: none;
      padding: 0;
      margin: 1rem 0;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    li {
      background: #fff;
      border-radius: 10px;
      border: 1px solid #e5e5e5;
    }
    details {
      padding: 0.6rem 0.9rem;
    }
    details[open] {
      border-top-left-radius: 10px;
      border-top-right-radius: 10px;
    }
    summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      cursor: pointer;
      list-style: none;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    .todo-title {
      font-weight: 600;
      flex: 1;
    }
    .badges {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
      font-size: 0.8rem;
    }
    .badge {
      border-radius: 999px;
      padding: 0.1rem 0.6rem;
      text-transform: capitalize;
      border: 1px solid #ddd;
    }
    .badge.priority-rock {
      background: #ffe3e3;
      border-color: #f5b5b5;
    }
    .badge.priority-pebble {
      background: #fff1d6;
      border-color: #f5c97c;
    }
    .badge.priority-sand {
      background: #e9f4ff;
      border-color: #b5d8ff;
    }
    .badge.state-done {
      background: #e7f8e9;
      border-color: #b0e2b8;
    }
    .badge.state-in_progress {
      background: #f0e8ff;
      border-color: #cdbdff;
    }
    .badge.state-ready {
      background: #fff2f0;
      border-color: #ffcfc3;
    }
    .todo-body {
      margin-top: 0.75rem;
      border-top: 1px solid #f0f0f0;
      padding-top: 0.75rem;
      display: grid;
      gap: 0.75rem;
    }
    .todo-description {
      margin: 0;
      color: #444;
      white-space: pre-wrap;
    }
    .todo-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .todo-actions form {
      margin: 0;
    }
    .edit-form {
      display: grid;
      gap: 0.5rem;
    }
    .edit-form label {
      display: flex;
      flex-direction: column;
      font-size: 0.85rem;
      color: #333;
      gap: 0.25rem;
    }
    .edit-form input,
    .edit-form textarea,
    .edit-form select {
      padding: 0.35rem 0.45rem;
      font-size: 0.9rem;
      border-radius: 6px;
      border: 1px solid #ccc;
      font-family: inherit;
    }
    .work-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 2rem;
      border-top: 1px solid #ddd;
      padding-top: 1rem;
    }
    .section-heading {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .archive-section {
      margin-top: 2rem;
    }
    .archive-toggle {
      text-decoration: none;
      font-size: 0.9rem;
      color: #111;
      border: 1px solid #ddd;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      background: #fff;
    }
    .auth-panel {
      border: 1px solid #e5e5e5;
      border-radius: 14px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
      background: #fff;
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08);
    }
    .auth-panel h2 {
      margin: 0 0 0.5rem;
      font-size: 1.2rem;
    }
    .auth-description {
      margin: 0 0 1rem;
      color: #555;
    }
    .auth-actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .auth-option {
      padding: 0.75rem 1rem;
      border: 1px solid #111;
      background: #fff;
      color: #111;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }
    .auth-option:hover:not(:disabled) {
      background: #111;
      color: #fff;
    }
    .auth-option:disabled {
      opacity: 0.6;
      cursor: progress;
    }
    .auth-advanced {
      margin-top: 0.5rem;
      padding-top: 0.75rem;
      border-top: 1px dashed #ddd;
    }
    .auth-advanced summary {
      cursor: pointer;
      color: #333;
      font-weight: 600;
    }
    .auth-advanced form {
      margin-top: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .auth-advanced input {
      padding: 0.6rem 0.75rem;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-size: 0.95rem;
    }
    .bunker-submit {
      align-self: flex-start;
      padding: 0.5rem 1rem;
      border-radius: 999px;
      background: #111;
      color: #fff;
      border: none;
      cursor: pointer;
    }
    .auth-error {
      margin-top: 0.75rem;
      color: #b91c1c;
      font-size: 0.9rem;
    }
    .auth-status {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
    }
    .auth-status button {
      padding: 0.4rem 0.9rem;
      border-radius: 999px;
      border: 1px solid #111;
      background: transparent;
      cursor: pointer;
    }
    details summary {
      cursor: pointer;
      font-weight: 600;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .hero-hint {
      margin: 0.5rem 0 0;
      color: #555;
      font-size: 0.9rem;
    }
    .hero-input:disabled {
      background: #f5f5f5;
      border-color: #ddd;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <main class="app-shell">
    <header class="page-header">
      <h1>${APP_NAME}</h1>
      <div class="session-controls" data-session-controls ${session ? "" : "hidden"}>
        <button
          class="avatar-chip"
          type="button"
          data-avatar
          ${session ? "" : "hidden"}
          title="Account menu"
        >
          <span class="avatar-fallback" data-avatar-fallback>
            ${session ? formatAvatarFallback(session.npub) : "•••"}
          </span>
          <img data-avatar-img alt="Profile photo" loading="lazy" ${session ? "" : "hidden"} />
        </button>
        <div class="avatar-menu" data-avatar-menu hidden>
          <button type="button" data-logout>Log out</button>
        </div>
      </div>
    </header>
    <section class="auth-panel" data-login-panel ${session ? "hidden" : ""}>
      <h2>Sign in with Nostr to get started</h2>
      <p class="auth-description">Start with a quick Ephemeral ID or bring your own signer.</p>
      <div class="auth-actions">
        <button class="auth-option" type="button" data-login-method="ephemeral">Sign Up</button>
      </div>
      <details class="auth-advanced">
        <summary>Advanced options</summary>
        <p>Use a browser extension or connect to a remote bunker.</p>
        <button class="auth-option" type="button" data-login-method="extension">Browser extension</button>
        <form data-bunker-form>
          <input name="bunker" placeholder="nostrconnect://… or name@example.com" autocomplete="off" />
          <button class="bunker-submit" type="submit">Connect bunker</button>
        </form>
      </details>
      <p class="auth-error" data-login-error hidden></p>
    </section>
    <section class="hero-entry">
      <form class="todo-form" method="post" action="/todos">
        <label for="title" class="sr-only">Add a task</label>
        <div class="hero-input-wrapper">
          <input class="hero-input" data-hero-input id="title" name="title" placeholder="${session ? "Add something else…" : "Add a task"}" autocomplete="off" autofocus required ${session ? "" : "disabled"} />
        </div>
        <p class="hero-hint" data-hero-hint hidden>Sign in above to add tasks.</p>
      </form>
    </section>
    <div class="work-header">
      <h2>Work</h2>
      <a class="archive-toggle" href="${archiveHref}">${archiveLabel}</a>
    </div>
    <p class="remaining-summary" ${session ? "" : "hidden"}>${
      session ? (remaining === 0 ? "All clear." : `${remaining} left to go.`) : ""
    }</p>
    ${renderTodoList(activeTodos, emptyActiveMessage)}
    ${showArchive ? renderArchiveSection(doneTodos, emptyArchiveMessage) : ""}
  </main>
  <script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session ?? null)};
  </script>
  <script type="module">
    const LOGIN_KIND = ${LOGIN_EVENT_KIND};
    const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.devvul.com", "wss://purplepag.es"];
    const AUTO_LOGIN_METHOD_KEY = "nostr_auto_login_method";
    const AUTO_LOGIN_PUBKEY_KEY = "nostr_auto_login_pubkey";
    const state = { session: window.__NOSTR_SESSION__ };

    const focusInput = () => {
      const input = document.getElementById("title");
      if (input) input.focus();
    };

    window.addEventListener("load", focusInput);

    const loginPanel = document.querySelector("[data-login-panel]");
    const sessionControls = document.querySelector("[data-session-controls]");
    const errorTarget = document.querySelector("[data-login-error]");
    const logoutBtn = document.querySelector("[data-logout]");
    const heroInput = document.querySelector("[data-hero-input]");
    const heroHint = document.querySelector("[data-hero-hint]");
    const avatarButton = document.querySelector("[data-avatar]");
    const avatarImg = document.querySelector("[data-avatar-img]");
    const avatarFallback = document.querySelector("[data-avatar-fallback]");
    const avatarMenu = document.querySelector("[data-avatar-menu]");

    const updatePanels = () => {
      if (state.session) {
        loginPanel?.setAttribute("hidden", "hidden");
        sessionControls?.removeAttribute("hidden");
        focusInput();
      } else {
        loginPanel?.removeAttribute("hidden");
        sessionControls?.setAttribute("hidden", "hidden");
        closeAvatarMenu();
      }
      updateHeroState();
      updateAvatar();
    };

    // Single place to trigger a UI redraw after state mutations.
    const refreshUI = () => {
      updatePanels();
    };

    const updateHeroState = () => {
      if (heroInput instanceof HTMLInputElement) {
        heroInput.disabled = !state.session;
        heroInput.placeholder = state.session ? "Add something else…" : "Add a task";
        if (state.session) {
          heroInput.focus();
        }
      }
      if (heroHint instanceof HTMLElement) {
        heroHint.setAttribute("hidden", "hidden");
      }
    };

    const showError = (message) => {
      if (!errorTarget) return;
      errorTarget.textContent = message;
      errorTarget.removeAttribute("hidden");
    };

    const clearError = () => {
      if (!errorTarget) return;
      errorTarget.textContent = "";
      errorTarget.setAttribute("hidden", "hidden");
    };

    const clearAutoLogin = () => {
      localStorage.removeItem(AUTO_LOGIN_METHOD_KEY);
      localStorage.removeItem(AUTO_LOGIN_PUBKEY_KEY);
    };

    const loadNostrLibs = async () => {
      if (!window.__NOSTR_LIBS__) {
        const base = "https://esm.sh/nostr-tools@2.7.2";
        window.__NOSTR_LIBS__ = {
          pure: await import(\`\${base}/pure\`),
          nip46: await import(\`\${base}/nip46\`),
        };
      }
      return window.__NOSTR_LIBS__;
    };

    const loadApplesauceLibs = async () => {
      if (!window.__APPLESAUCE_LIBS__) {
        window.__APPLESAUCE_LIBS__ = {
          relay: await import("https://esm.sh/applesauce-relay@4.0.0?bundle"),
          helpers: await import("https://esm.sh/applesauce-core@4.0.0/helpers?bundle"),
          rxjs: await import("https://esm.sh/rxjs@7.8.1?bundle"),
        };
      }
      return window.__APPLESAUCE_LIBS__;
    };

    let profilePool;
    let avatarMenuWatcherActive = false;
    let avatarRequestId = 0;
    let autoLoginAttempted = false;

    const fallbackAvatarUrl = (pubkey) => \`https://robohash.org/\${pubkey || "nostr"}.png?set=set3\`;

    const formatAvatarLabel = (npub) => {
      if (!npub) return "•••";
      const trimmed = npub.replace(/^npub1/, "");
      return trimmed.slice(0, 2).toUpperCase();
    };

    const updateAvatar = async () => {
      if (!avatarButton || !avatarFallback) return;
      if (!state.session) {
        avatarButton.setAttribute("hidden", "hidden");
        if (avatarImg) {
          avatarImg.src = "";
          avatarImg.setAttribute("hidden", "hidden");
        }
        avatarFallback.textContent = "•••";
        return;
      }
      avatarButton.removeAttribute("hidden");
      avatarFallback.textContent = formatAvatarLabel(state.session.npub);
      avatarFallback.removeAttribute("hidden");
      avatarImg?.setAttribute("hidden", "hidden");
      const currentRequest = ++avatarRequestId;
      const picture = await fetchProfilePicture(state.session.pubkey);
      if (currentRequest !== avatarRequestId) return;
      if (picture && avatarImg) {
        avatarImg.src = picture;
        avatarImg.removeAttribute("hidden");
        avatarFallback.setAttribute("hidden", "hidden");
      } else {
        avatarImg?.setAttribute("hidden", "hidden");
        avatarFallback.removeAttribute("hidden");
      }
    };

    const fetchProfilePicture = async (pubkey) => {
      if (!pubkey) return null;
      const fallback = fallbackAvatarUrl(pubkey);
      try {
        const libs = await loadApplesauceLibs();
        const { RelayPool, onlyEvents } = libs.relay;
        const { getProfilePicture } = libs.helpers;
        const { firstValueFrom, take, takeUntil, timer } = libs.rxjs;
        profilePool = profilePool || new RelayPool();
        const observable = profilePool
          .subscription(DEFAULT_RELAYS, [{ authors: [pubkey], kinds: [0], limit: 1 }])
          .pipe(onlyEvents(), take(1), takeUntil(timer(5000)));
        const event = await firstValueFrom(observable, { defaultValue: null });
        if (!event) return fallback;
        return getProfilePicture(event, fallback);
      } catch (error) {
        console.warn("Unable to load profile picture", error);
        return fallback;
      }
    };

    const openAvatarMenu = () => {
      if (!avatarMenu) return;
      avatarMenu.removeAttribute("hidden");
      if (!avatarMenuWatcherActive) {
        avatarMenuWatcherActive = true;
        document.addEventListener("click", handleAvatarOutside, { once: true });
      }
    };

    const closeAvatarMenu = () => {
      avatarMenu?.setAttribute("hidden", "hidden");
      avatarMenuWatcherActive = false;
    };

    const handleAvatarOutside = (event) => {
      avatarMenuWatcherActive = false;
      if (
        (avatarMenu && avatarMenu.contains(event.target)) ||
        (avatarButton && avatarButton.contains(event.target))
      ) {
        document.addEventListener("click", handleAvatarOutside, { once: true });
        avatarMenuWatcherActive = true;
        return;
      }
      closeAvatarMenu();
    };

    avatarButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!state.session) return;
      if (avatarMenu?.hasAttribute("hidden")) openAvatarMenu();
      else closeAvatarMenu();
    });

    avatarMenu?.addEventListener("click", (event) => event.stopPropagation());

    const hexToBytes = (hex) => {
      if (!hex) return new Uint8Array();
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
      return bytes;
    };

    const bytesToHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const buildUnsignedEvent = (method) => ({
      kind: LOGIN_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["app", "${APP_TAG}"],
        ["method", method],
      ],
      content: "Authenticate with Other Stuff To Do",
    });

    const loginButtons = document.querySelectorAll("[data-login-method]");
    loginButtons.forEach((button) => {
      button.addEventListener("click", async (event) => {
        const target = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
        if (!target) return;
        const method = target.getAttribute("data-login-method");
        if (!method) return;
        target.disabled = true;
        clearError();
        try {
          const signedEvent = await signLoginEvent(method);
          await completeLogin(method, signedEvent);
        } catch (err) {
          console.error(err);
          showError(err?.message || "Login failed.");
        } finally {
          target.disabled = false;
        }
      });
    });

    const maybeAutoLogin = async () => {
      if (autoLoginAttempted || state.session) return;
      autoLoginAttempted = true;
      const method = localStorage.getItem(AUTO_LOGIN_METHOD_KEY);
      const hasSecret = !!localStorage.getItem("nostr_ephemeral_secret");
      if (method !== "ephemeral" || !hasSecret) return;
      try {
        const signedEvent = await signLoginEvent("ephemeral");
        await completeLogin("ephemeral", signedEvent);
      } catch (err) {
        console.error("Auto login failed", err);
        clearAutoLogin();
      }
    };

    const bunkerForm = document.querySelector("[data-bunker-form]");
    bunkerForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = bunkerForm.querySelector("input[name='bunker']");
      if (!input?.value.trim()) {
        showError("Enter a bunker nostrconnect URI or NIP-05 handle.");
        return;
      }
      bunkerForm.classList.add("is-busy");
      clearError();
      try {
        const signedEvent = await signLoginEvent("bunker", input.value.trim());
        await completeLogin("bunker", signedEvent);
        input.value = "";
      } catch (err) {
        console.error(err);
        showError(err?.message || "Unable to connect to bunker.");
      } finally {
        bunkerForm.classList.remove("is-busy");
      }
    });

    async function signLoginEvent(method, supplemental) {
      if (method === "ephemeral") {
        const { pure } = await loadNostrLibs();
        let stored = localStorage.getItem("nostr_ephemeral_secret");
        if (!stored) {
          stored = bytesToHex(pure.generateSecretKey());
          localStorage.setItem("nostr_ephemeral_secret", stored);
        }
        const secret = hexToBytes(stored);
        return pure.finalizeEvent(buildUnsignedEvent(method), secret);
      }

      if (method === "extension") {
        if (!window.nostr?.signEvent) {
          throw new Error("No NIP-07 browser extension found.");
        }
        const event = buildUnsignedEvent(method);
        event.pubkey = await window.nostr.getPublicKey();
        return window.nostr.signEvent(event);
      }

      if (method === "bunker") {
        const { pure, nip46 } = await loadNostrLibs();
        const pointer = await nip46.parseBunkerInput(supplemental || "");
        if (!pointer) throw new Error("Unable to parse bunker details.");
        const clientSecret = pure.generateSecretKey();
        const signer = new nip46.BunkerSigner(clientSecret, pointer);
        await signer.connect();
        try {
          return await signer.signEvent(buildUnsignedEvent(method));
        } finally {
          await signer.close();
        }
      }
      throw new Error("Unsupported login method.");
    }

    async function completeLogin(method, event) {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, event }),
      });
      if (!response.ok) {
        let message = "Login failed.";
        try {
          const data = await response.json();
          if (data?.message) message = data.message;
        } catch (_err) {}
        throw new Error(message);
      }
      state.session = await response.json();
      if (method === "ephemeral") {
        localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "ephemeral");
        localStorage.setItem(AUTO_LOGIN_PUBKEY_KEY, state.session.pubkey);
      } else {
        clearAutoLogin();
      }
      refreshUI();
    }

    logoutBtn?.addEventListener("click", async () => {
      closeAvatarMenu();
      await fetch("/auth/logout", { method: "POST" });
      state.session = null;
      clearAutoLogin();
      refreshUI();
    });

    refreshUI();
    maybeAutoLogin();
  </script>
</body>
</html>`;
}

function renderTodoList(todos: Todo[], emptyMessage: string) {
  if (todos.length === 0) {
    return `<ul class="todo-list"><li>${emptyMessage}</li></ul>`;
  }
  return `<ul class="todo-list">${todos.map(renderTodoItem).join("")}</ul>`;
}

function renderArchiveSection(todos: Todo[], emptyMessage: string) {
  return `
    <section class="archive-section">
      <div class="section-heading"><h2>Archive</h2></div>
      ${renderTodoList(todos, emptyMessage)}
    </section>`;
}

function formatAvatarFallback(npub: string) {
  if (!npub) return "•••";
  return npub.replace(/^npub1/, "").slice(0, 2).toUpperCase();
}

async function handleLogin(req: Request) {
  const body = (await safeJson(req)) as LoginRequestBody | null;
  if (!body?.method || !body.event) {
    return jsonResponse({ message: "Invalid payload." }, 400);
  }
  const validation = validateLoginEvent(body.method, body.event);
  if (!validation.ok) {
    return jsonResponse({ message: validation.message }, 422);
  }
  const token = crypto.randomUUID();
  const session: Session = {
    token,
    pubkey: body.event.pubkey,
    npub: nip19.npubEncode(body.event.pubkey),
    method: body.method,
    createdAt: Date.now(),
  };
  sessions.set(token, session);
  return jsonResponse(session, 200, serializeSessionCookie(token));
}

async function handleLogout(req: Request) {
  const cookies = parseCookies(req.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  if (token) {
    sessions.delete(token);
  }
  return jsonResponse({ ok: true }, 200, serializeSessionCookie(null));
}

function validateLoginEvent(method: LoginMethod, event: LoginRequestBody["event"]) {
  if (!event) return { ok: false, message: "Missing event." };
  if (event.kind !== LOGIN_EVENT_KIND) return { ok: false, message: "Unexpected event kind." };
  if (!verifyEvent(event as any)) return { ok: false, message: "Invalid event signature." };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - event.created_at) > LOGIN_MAX_AGE_SECONDS) {
    return { ok: false, message: "Login event expired." };
  }
  const hasAppTag = event.tags.some((tag) => tag[0] === "app" && tag[1] === APP_TAG);
  if (!hasAppTag) return { ok: false, message: "Missing app tag." };
  const hasMethodTag = event.tags.some((tag) => tag[0] === "method" && tag[1] === method);
  if (!hasMethodTag) return { ok: false, message: "Method mismatch." };
  return { ok: true };
}

function getSessionFromRequest(req: Request): Session | null {
  const cookies = parseCookies(req.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return sessions.get(token) ?? null;
}

function parseCookies(header: string | null) {
  const map: Record<string, string> = {};
  if (!header) return map;
  const pairs = header.split(";").map((part) => part.trim());
  for (const pair of pairs) {
    const [key, ...rest] = pair.split("=");
    if (!key) continue;
    map[key] = decodeURIComponent(rest.join("="));
  }
  return map;
}

function serializeSessionCookie(token: string | null) {
  if (!token) {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
  const secure = COOKIE_SECURE ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

async function safeJson(req: Request) {
  try {
    return await req.json();
  } catch (_err) {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(body), { status, headers });
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseUpdateForm(form: FormData):
  | { title: string; description: string; priority: TodoPriority; state: TodoState }
  | null {
  const title = String(form.get("title") ?? "").trim();
  if (!title) return null;
  const description = String(form.get("description") ?? "").trim();
  const priority = normalizePriority(String(form.get("priority") ?? "sand"));
  const state = normalizeState(String(form.get("state") ?? "ready"));
  return { title, description, priority, state };
}

function normalizePriority(input: string): TodoPriority {
  const value = input.toLowerCase();
  if (value === "rock" || value === "pebble" || value === "sand") return value;
  return "sand";
}

function normalizeState(input: string): TodoState {
  const value = input.toLowerCase();
  if (value === "new" || value === "ready" || value === "in_progress" || value === "done") {
    return value;
  }
  return "ready";
}

function renderTodoItem(todo: Todo) {
  const description = todo.description ? `<p class="todo-description">${escapeHtml(todo.description)}</p>` : "";
  return `
    <li>
      <details>
        <summary>
          <span class="todo-title">${escapeHtml(todo.title)}</span>
          <span class="badges">
            <span class="badge priority-${todo.priority}">${formatPriorityLabel(todo.priority)}</span>
            <span class="badge state-${todo.state}">${formatStateLabel(todo.state)}</span>
          </span>
        </summary>
        <div class="todo-body">
          ${description}
          <form class="edit-form" method="post" action="/todos/${todo.id}/update">
            <label>Title
              <input name="title" value="${escapeHtml(todo.title)}" required />
            </label>
            <label>Description
              <textarea name="description" rows="3">${escapeHtml(todo.description ?? "")}</textarea>
            </label>
            <label>Priority
              <select name="priority">
                ${renderPriorityOption("rock", todo.priority)}
                ${renderPriorityOption("pebble", todo.priority)}
                ${renderPriorityOption("sand", todo.priority)}
              </select>
            </label>
            <label>State
              <select name="state">
                ${renderStateOption("new", todo.state)}
                ${renderStateOption("ready", todo.state)}
                ${renderStateOption("in_progress", todo.state)}
                ${renderStateOption("done", todo.state)}
              </select>
            </label>
            <button type="submit">Update</button>
          </form>
          ${renderLifecycleActions(todo)}
        </div>
      </details>
    </li>`;
}

function renderLifecycleActions(todo: Todo) {
  const transitions: Array<{ label: string; state: TodoState }> = [];
  if (todo.state === "new") {
    transitions.push({ label: "Mark Ready", state: "ready" });
  } else if (todo.state === "ready") {
    transitions.push({ label: "Start Work", state: "in_progress" });
    transitions.push({ label: "Complete", state: "done" });
  } else if (todo.state === "in_progress") {
    transitions.push({ label: "Complete", state: "done" });
  } else if (todo.state === "done") {
    transitions.push({ label: "Reopen", state: "ready" });
  }

  const transitionForms = transitions.map((transition) =>
    renderStateActionForm(todo.id, transition.state, transition.label)
  );

  return `
    <div class="todo-actions">
      ${transitionForms.join("")}
      ${renderDeleteForm(todo.id)}
    </div>`;
}

function renderStateActionForm(id: number, nextState: TodoState, label: string) {
  return `
    <form method="post" action="/todos/${id}/state">
      <input type="hidden" name="state" value="${nextState}" />
      <button type="submit">${label}</button>
    </form>`;
}

function renderDeleteForm(id: number) {
  return `
    <form method="post" action="/todos/${id}/delete">
      <button type="submit">Delete</button>
    </form>`;
}

function renderPriorityOption(value: TodoPriority, current: string) {
  const isSelected = value === current ? "selected" : "";
  return `<option value="${value}" ${isSelected}>${formatPriorityLabel(value)}</option>`;
}

function renderStateOption(value: TodoState, current: string) {
  const isSelected = value === current ? "selected" : "";
  return `<option value="${value}" ${isSelected}>${formatStateLabel(value)}</option>`;
}

function formatStateLabel(state: TodoState) {
  if (state === "in_progress") return "In Progress";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function formatPriorityLabel(priority: TodoPriority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

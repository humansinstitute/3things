import { extname, join } from "path";

import { nip19 } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";

import {
  addTodo,
  addTodoFull,
  deleteTodo,
  getLatestSummaries,
  listScheduledTodos,
  listTodos,
  listUnscheduledTodos,
  transitionTodo,
  updateTodo,
  upsertSummary,
} from "./db";

import type { Todo, TodoPriority, TodoState } from "./db";

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

type LoginMethod = "ephemeral" | "extension" | "bunker" | "secret";

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

    const aiTasksMatch = req.method === "GET" ? pathname.match(/^\/ai\/tasks\/(\d+)(?:\/(yes|no))?$/) : null;
    if (aiTasksMatch) {
      return handleAiTasks(req, url, aiTasksMatch);
    }

    if (req.method === "GET" && pathname === "/ai/summary/latest") {
      return handleLatestSummary(url);
    }

    if (req.method === "GET" && pathname === "/") {
      const tagsParam = url.searchParams.get("tags");
      const filterTags = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : [];
      return new Response(renderPage({ showArchive: url.searchParams.get("archive") === "1", session, filterTags }), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (req.method === "POST" && pathname === "/auth/login") {
      return handleLogin(req);
    }

    if (req.method === "POST" && pathname === "/auth/logout") {
      return handleLogout(req);
    }

    if (req.method === "POST" && pathname === "/ai/summary") {
      return handleSummaryPost(req);
    }

    if (req.method === "POST" && pathname === "/ai/tasks") {
      return handleAiTasksPost(req);
    }

    if (req.method === "POST") {
      const form = await req.formData();

      if (pathname === "/todos") {
        if (!session) return unauthorized();
        const tags = String(form.get("tags") ?? "");
        addTodo(String(form.get("title") ?? ""), session.npub, tags);
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

function renderPage({ showArchive, session, filterTags = [] }: { showArchive: boolean; session: Session | null; filterTags?: string[] }) {
  // Get all todos (unfiltered) to collect all available tags
  const allTodos = session ? listTodos(session.npub) : [];
  // Get filtered todos for display
  const todos = filterTags.length > 0 ? allTodos.filter((todo) => {
    const todoTags = todo.tags ? todo.tags.split(",").map((t) => t.trim().toLowerCase()) : [];
    return filterTags.some((ft) => todoTags.includes(ft.toLowerCase()));
  }) : allTodos;
  const activeTodos = todos.filter((t) => t.state !== "done");
  const doneTodos = todos.filter((t) => t.state === "done");
  const remaining = session ? activeTodos.length : 0;
  const archiveHref = showArchive ? "/" : "/?archive=1";
  const archiveLabel = showArchive ? "Hide archive" : `Archive (${doneTodos.length})`;
  // Collect all unique tags from all todos
  const allTags = new Set<string>();
  for (const todo of allTodos) {
    if (todo.tags) {
      todo.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).forEach((t) => allTags.add(t));
    }
  }
  const tagFilterBar = session && allTags.size > 0 ? renderTagFilterBar(Array.from(allTags), filterTags, showArchive) : "";
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
      color: #111;
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
    .tag-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      background: #f3f0ff;
      border: 1px solid #d4c9ff;
      border-radius: 999px;
      padding: 0.1rem 0.5rem;
      font-size: 0.75rem;
      color: #5b4b8a;
    }
    .tag-chip .remove-tag {
      cursor: pointer;
      font-size: 0.9rem;
      line-height: 1;
      opacity: 0.6;
    }
    .tag-chip .remove-tag:hover {
      opacity: 1;
    }
    .tags-display {
      display: flex;
      gap: 0.3rem;
      flex-wrap: wrap;
    }
    .tag-input-wrapper {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      padding: 0.4rem;
      border: 1px solid #ccc;
      border-radius: 6px;
      background: #fff;
      min-height: 2.2rem;
      align-items: center;
      cursor: text;
    }
    .tag-input-wrapper:focus-within {
      border-color: #666;
      outline: none;
    }
    .tag-input-wrapper input {
      border: none;
      outline: none;
      flex: 1;
      min-width: 60px;
      font-size: 0.9rem;
      padding: 0.2rem;
    }
    .tag-filter-bar {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
      padding: 0.5rem;
      background: #fafafa;
      border-radius: 6px;
    }
    .tag-filter-bar .label {
      font-size: 0.85rem;
      color: #666;
    }
    .tag-filter-bar .tag-chip {
      cursor: pointer;
    }
    .tag-filter-bar .tag-chip.active {
      background: #5b4b8a;
      color: #fff;
      border-color: #5b4b8a;
    }
    .tag-filter-bar .clear-filters {
      font-size: 0.8rem;
      color: #666;
      text-decoration: underline;
      cursor: pointer;
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
    .qr-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      backdrop-filter: blur(4px);
    }
    .qr-modal-overlay[hidden] {
      display: none;
    }
    .qr-modal {
      background: #fff;
      border-radius: 16px;
      padding: 2rem;
      max-width: 340px;
      width: 90%;
      text-align: center;
      position: relative;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
    }
    .qr-modal-close {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      background: transparent;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: #666;
      padding: 0.25rem;
      line-height: 1;
    }
    .qr-modal-close:hover {
      color: #111;
    }
    .qr-modal h2 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
    }
    .qr-modal p {
      margin: 0 0 1.25rem;
      color: #555;
      font-size: 0.9rem;
    }
    .qr-canvas-container {
      display: flex;
      justify-content: center;
    }
    .qr-canvas-container canvas {
      border-radius: 8px;
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
    .summary-panel {
      margin-top: 1.5rem;
      padding: 1rem;
      border-radius: 12px;
      border: 1px solid #e5e5e5;
      background: #fff;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
    }
    .summary-panel h2 {
      margin: 0;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
    .summary-card {
      border: 1px solid #f0f0f0;
      border-radius: 10px;
      padding: 0.75rem 0.9rem;
      background: #fafafa;
    }
    .summary-card h3 {
      margin: 0 0 0.35rem;
      font-size: 1rem;
    }
    .summary-text {
      margin: 0;
      white-space: pre-wrap;
      color: #333;
      line-height: 1.45;
    }
    .summary-meta {
      margin-top: 0.4rem;
      font-size: 0.85rem;
      color: #666;
    }
    .summary-suggestions {
      border-top: 1px dashed #e0e0e0;
      padding-top: 0.6rem;
      margin-top: 0.6rem;
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
          <button type="button" data-export-secret ${session?.method === "ephemeral" ? "" : "hidden"}>Export Secret</button>
          <button type="button" data-show-login-qr ${session?.method === "ephemeral" ? "" : "hidden"}>Show Login QR</button>
          <button type="button" data-copy-id ${session ? "" : "hidden"}>Copy ID</button>
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
        <form data-secret-form>
          <input name="secret" placeholder="nsec1…" autocomplete="off" />
          <button class="bunker-submit" type="submit">Sign in with secret</button>
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
    ${tagFilterBar}
    ${renderTodoList(activeTodos, emptyActiveMessage)}
    ${showArchive ? renderArchiveSection(doneTodos, emptyArchiveMessage) : ""}
    <section class="summary-panel" data-summary-panel hidden>
      <div class="section-heading">
        <h2>Summaries</h2>
        <span class="summary-meta" data-summary-updated></span>
      </div>
      <div class="summary-grid">
        <article class="summary-card" data-summary-day hidden>
          <h3>Today</h3>
          <p class="summary-text" data-summary-day-text></p>
        </article>
        <article class="summary-card" data-summary-week hidden>
          <h3>This Week</h3>
          <p class="summary-text" data-summary-week-text></p>
        </article>
        <article class="summary-card summary-suggestions" data-summary-suggestions hidden>
          <h3>Suggestions</h3>
          <p class="summary-text" data-summary-suggestions-text></p>
        </article>
      </div>
    </section>
    <div class="qr-modal-overlay" data-qr-modal hidden>
      <div class="qr-modal">
        <button class="qr-modal-close" type="button" data-qr-close aria-label="Close">&times;</button>
        <h2>Login QR Code</h2>
        <p>Scan this code with your mobile device to log in</p>
        <div class="qr-canvas-container" data-qr-container></div>
      </div>
    </div>
  </main>
  <script>
    window.__NOSTR_SESSION__ = ${JSON.stringify(session ?? null)};
  </script>
  <script type="module">
    const LOGIN_KIND = ${LOGIN_EVENT_KIND};
    const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.devvul.com", "wss://purplepag.es"];
    const AUTO_LOGIN_METHOD_KEY = "nostr_auto_login_method";
    const AUTO_LOGIN_PUBKEY_KEY = "nostr_auto_login_pubkey";
    const state = { session: window.__NOSTR_SESSION__, summaries: { day: null, week: null } };

    const focusInput = () => {
      const input = document.getElementById("title");
      if (input) input.focus();
    };

    window.addEventListener("load", focusInput);

    const loginPanel = document.querySelector("[data-login-panel]");
    const sessionControls = document.querySelector("[data-session-controls]");
    const errorTarget = document.querySelector("[data-login-error]");
    const logoutBtn = document.querySelector("[data-logout]");
    const copyIdBtn = document.querySelector("[data-copy-id]");
    const heroInput = document.querySelector("[data-hero-input]");
    const heroHint = document.querySelector("[data-hero-hint]");
    const avatarButton = document.querySelector("[data-avatar]");
    const avatarImg = document.querySelector("[data-avatar-img]");
    const avatarFallback = document.querySelector("[data-avatar-fallback]");
    const avatarMenu = document.querySelector("[data-avatar-menu]");
    const summaryPanel = document.querySelector("[data-summary-panel]");
    const summaryUpdated = document.querySelector("[data-summary-updated]");
    const summaryDay = document.querySelector("[data-summary-day]");
    const summaryDayText = document.querySelector("[data-summary-day-text]");
    const summaryWeek = document.querySelector("[data-summary-week]");
    const summaryWeekText = document.querySelector("[data-summary-week-text]");
    const summarySuggestions = document.querySelector("[data-summary-suggestions]");
    const summarySuggestionsText = document.querySelector("[data-summary-suggestions-text]");
    const qrModal = document.querySelector("[data-qr-modal]");
    const qrCloseBtn = document.querySelector("[data-qr-close]");
    const qrContainer = document.querySelector("[data-qr-container]");
    const showLoginQrBtn = document.querySelector("[data-show-login-qr]");

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
      updateSummaryUI();
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

    const updateSummaryUI = () => {
      if (!summaryPanel) return;
      const { day, week } = state.summaries || {};
      const hasDay = !!day?.day_ahead;
      const hasWeek = !!week?.week_ahead;
      const suggestionsText = day?.suggestions || week?.suggestions;
      const latestUpdated = day?.updated_at || week?.updated_at || "";

      if (!state.session || (!hasDay && !hasWeek && !suggestionsText)) {
        summaryPanel.setAttribute("hidden", "hidden");
        return;
      }

      summaryPanel.removeAttribute("hidden");

      if (summaryDay && summaryDayText) {
        if (hasDay && day?.day_ahead) {
          summaryDayText.textContent = day.day_ahead;
          summaryDay.removeAttribute("hidden");
        } else {
          summaryDay.setAttribute("hidden", "hidden");
          summaryDayText.textContent = "";
        }
      }

      if (summaryWeek && summaryWeekText) {
        if (hasWeek && week?.week_ahead) {
          summaryWeekText.textContent = week.week_ahead;
          summaryWeek.removeAttribute("hidden");
        } else {
          summaryWeek.setAttribute("hidden", "hidden");
          summaryWeekText.textContent = "";
        }
      }

      if (summarySuggestions && summarySuggestionsText) {
        if (suggestionsText) {
          summarySuggestionsText.textContent = suggestionsText;
          summarySuggestions.removeAttribute("hidden");
        } else {
          summarySuggestionsText.textContent = "";
          summarySuggestions.setAttribute("hidden", "hidden");
        }
      }

      if (summaryUpdated) {
        summaryUpdated.textContent = latestUpdated ? \`Updated \${new Date(latestUpdated).toLocaleString()}\` : "";
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

    const fetchSummaries = async () => {
      if (!state.session) return;
      try {
        const response = await fetch(\`/ai/summary/latest?owner=\${encodeURIComponent(state.session.npub)}\`);
        if (!response.ok) throw new Error("Unable to fetch summaries.");
        const data = await response.json();
        state.summaries = { day: data?.day ?? null, week: data?.week ?? null };
      } catch (error) {
        console.error(error);
        state.summaries = { day: null, week: null };
      } finally {
        updateSummaryUI();
      }
    };

    const loadNostrLibs = async () => {
      if (!window.__NOSTR_LIBS__) {
        const base = "https://esm.sh/nostr-tools@2.7.2";
        window.__NOSTR_LIBS__ = {
          pure: await import(\`\${base}/pure\`),
          nip19: await import(\`\${base}/nip19\`),
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

    const loadQRCodeLib = async () => {
      if (!window.__QRCODE_LIB__) {
        const mod = await import("https://esm.sh/qrcode@1.5.3");
        window.__QRCODE_LIB__ = mod.default || mod;
      }
      return window.__QRCODE_LIB__;
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

    // QR Modal functions
    const openQrModal = async () => {
      if (!qrModal || !qrContainer) return;
      if (state.session?.method !== "ephemeral") {
        alert("Login QR is only available for ephemeral accounts.");
        return;
      }
      const stored = localStorage.getItem("nostr_ephemeral_secret");
      if (!stored) {
        alert("No secret key found.");
        return;
      }
      try {
        const { nip19 } = await loadNostrLibs();
        const QRCode = await loadQRCodeLib();
        const secret = hexToBytes(stored);
        const nsec = nip19.nsecEncode(secret);
        const loginUrl = \`\${window.location.origin}/#code=\${nsec}\`;
        qrContainer.innerHTML = "";
        const canvas = document.createElement("canvas");
        await QRCode.toCanvas(canvas, loginUrl, { width: 256, margin: 2 });
        qrContainer.appendChild(canvas);
        qrModal.removeAttribute("hidden");
        document.addEventListener("keydown", handleQrEscape);
      } catch (err) {
        console.error("Failed to generate QR code", err);
        alert("Failed to generate QR code.");
      }
    };

    const closeQrModal = () => {
      qrModal?.setAttribute("hidden", "hidden");
      document.removeEventListener("keydown", handleQrEscape);
    };

    const handleQrEscape = (event) => {
      if (event.key === "Escape") closeQrModal();
    };

    const handleQrOverlayClick = (event) => {
      if (event.target === qrModal) closeQrModal();
    };

    qrCloseBtn?.addEventListener("click", closeQrModal);
    qrModal?.addEventListener("click", handleQrOverlayClick);

    showLoginQrBtn?.addEventListener("click", () => {
      closeAvatarMenu();
      openQrModal();
    });

    // URL fragment login detection
    const checkFragmentLogin = async () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#code=")) return;
      const nsec = hash.slice(6);
      if (!nsec || !nsec.startsWith("nsec1")) {
        console.error("Invalid nsec in URL fragment");
        history.replaceState(null, "", window.location.pathname + window.location.search);
        return;
      }
      // Clear URL immediately for security
      history.replaceState(null, "", window.location.pathname + window.location.search);
      try {
        // Decode nsec and store in localStorage for auto-login persistence
        const { nip19 } = await loadNostrLibs();
        const secretBytes = decodeNsec(nip19, nsec);
        const secretHex = bytesToHex(secretBytes);
        localStorage.setItem("nostr_ephemeral_secret", secretHex);
        // Now login as ephemeral (so auto-login works on refresh)
        const signedEvent = await signLoginEvent("ephemeral");
        await completeLogin("ephemeral", signedEvent);
      } catch (err) {
        console.error("Fragment login failed", err);
        showError(err?.message || "Login failed.");
      }
    };

    const hexToBytes = (hex) => {
      if (!hex) return new Uint8Array();
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
      return bytes;
    };

    const bytesToHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const decodeNsec = (nip19, input) => {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type !== "nsec" || !decoded.data) throw new Error("Not a valid nsec key.");
        if (decoded.data instanceof Uint8Array) return decoded.data;
        if (Array.isArray(decoded.data)) return new Uint8Array(decoded.data);
        throw new Error("Unable to read nsec payload.");
      } catch (err) {
        throw new Error("Invalid nsec key.");
      }
    };

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
      if (method !== "ephemeral" || !hasSecret) {
        autoLoginAttempted = false;
        return;
      }
      try {
        const signedEvent = await signLoginEvent("ephemeral");
        await completeLogin("ephemeral", signedEvent);
      } catch (err) {
        console.error("Auto login failed", err);
        clearAutoLogin();
        autoLoginAttempted = false;
      }
    };

    const bunkerForm = document.querySelector("[data-bunker-form]");
    const secretForm = document.querySelector("[data-secret-form]");
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

    secretForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = secretForm.querySelector("input[name='secret']");
      if (!input?.value.trim()) {
        showError("Paste an nsec secret key to continue.");
        return;
      }
      secretForm.classList.add("is-busy");
      clearError();
      try {
        const signedEvent = await signLoginEvent("secret", input.value.trim());
        await completeLogin("secret", signedEvent);
        input.value = "";
      } catch (err) {
        console.error(err);
        showError(err?.message || "Unable to sign in with secret.");
      } finally {
        secretForm.classList.remove("is-busy");
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
      if (method === "secret") {
        const { pure, nip19 } = await loadNostrLibs();
        const secret = decodeNsec(nip19, supplemental || "");
        return pure.finalizeEvent(buildUnsignedEvent(method), secret);
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
      await fetchSummaries();
      refreshUI();
      window.location.reload();
    }

    const exportSecretBtn = document.querySelector("[data-export-secret]");
    exportSecretBtn?.addEventListener("click", async () => {
      closeAvatarMenu();
      if (state.session?.method !== "ephemeral") {
        alert("Export is only available for ephemeral accounts.");
        return;
      }
      const stored = localStorage.getItem("nostr_ephemeral_secret");
      if (!stored) {
        alert("No secret key found.");
        return;
      }
      try {
        const { nip19 } = await loadNostrLibs();
        const secret = hexToBytes(stored);
        const nsec = nip19.nsecEncode(secret);
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(nsec);
          alert("Secret key copied to clipboard!\\n\\nKeep this safe - anyone with this key can access your account.");
        } else {
          prompt("Copy your secret key (keep it safe):", nsec);
        }
      } catch (err) {
        console.error(err);
        alert("Failed to export secret key.");
      }
    });

    copyIdBtn?.addEventListener("click", async () => {
      closeAvatarMenu();
      const npub = state.session?.npub;
      if (!npub) {
        alert("No ID available.");
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(npub);
          alert("ID copied to clipboard.");
        } else {
          prompt("Copy your ID:", npub);
        }
      } catch (err) {
        console.error(err);
        prompt("Copy your ID:", npub);
      }
    });

    logoutBtn?.addEventListener("click", async () => {
      closeAvatarMenu();
      await fetch("/auth/logout", { method: "POST" });
      state.session = null;
      state.summaries = { day: null, week: null };
      clearAutoLogin();
      refreshUI();
    });

    refreshUI();
    if (state.session) {
      void fetchSummaries();
    }
    // Check for fragment login first (takes precedence over auto-login)
    void checkFragmentLogin().then(() => {
      if (!state.session) {
        void maybeAutoLogin();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !state.session) {
        void maybeAutoLogin();
      }
    });

    // Tag input functionality
    function initTagInputs() {
      document.querySelectorAll(".tag-input-wrapper").forEach((wrapper) => {
        const input = wrapper.querySelector("input[type='text']");
        const hiddenInput = wrapper.querySelector("input[type='hidden']");
        if (!input || !hiddenInput) return;

        function syncTags() {
          const chips = wrapper.querySelectorAll(".tag-chip");
          const tags = Array.from(chips).map((c) => c.dataset.tag).filter(Boolean);
          hiddenInput.value = tags.join(",");
        }

        function addTag(text) {
          const tag = text.trim().toLowerCase().replace(/,/g, "");
          if (!tag) return;
          // Check for duplicates
          const existing = wrapper.querySelectorAll(".tag-chip");
          for (const chip of existing) {
            if (chip.dataset.tag === tag) return;
          }
          const chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.dataset.tag = tag;
          chip.innerHTML = tag + '<span class="remove-tag">&times;</span>';
          chip.querySelector(".remove-tag").addEventListener("click", () => {
            chip.remove();
            syncTags();
          });
          wrapper.insertBefore(chip, input);
          syncTags();
        }

        function removeLastTag() {
          const chips = wrapper.querySelectorAll(".tag-chip");
          if (chips.length > 0) {
            chips[chips.length - 1].remove();
            syncTags();
          }
        }

        input.addEventListener("keydown", (e) => {
          if (e.key === "," || e.key === "Enter") {
            e.preventDefault();
            addTag(input.value);
            input.value = "";
          } else if (e.key === "Backspace" && input.value === "") {
            removeLastTag();
          }
        });

        input.addEventListener("blur", () => {
          if (input.value.trim()) {
            addTag(input.value);
            input.value = "";
          }
        });

        wrapper.addEventListener("click", () => input.focus());

        // Initialize existing chips' remove buttons
        wrapper.querySelectorAll(".tag-chip .remove-tag").forEach((btn) => {
          btn.addEventListener("click", () => {
            btn.parentElement.remove();
            syncTags();
          });
        });
      });
    }

    initTagInputs();
  </script>
</body>
</html>`;
}

function renderTagFilterBar(allTags: string[], activeTags: string[], showArchive: boolean) {
  const baseUrl = showArchive ? "/?archive=1" : "/";
  const chips = allTags.sort().map((tag) => {
    const isActive = activeTags.some((t) => t.toLowerCase() === tag.toLowerCase());
    // Toggle: if active, remove from filter; if not, add to filter
    let newTags: string[];
    if (isActive) {
      newTags = activeTags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
    } else {
      newTags = [...activeTags, tag];
    }
    const href = newTags.length > 0 ? `${baseUrl}${showArchive ? "&" : "?"}tags=${newTags.join(",")}` : baseUrl;
    return `<a href="${href}" class="tag-chip${isActive ? " active" : ""}">${escapeHtml(tag)}</a>`;
  }).join("");
  const clearHref = baseUrl;
  const clearLink = activeTags.length > 0 ? `<a href="${clearHref}" class="clear-filters">Clear filters</a>` : "";
  return `<div class="tag-filter-bar"><span class="label">Filter by tag:</span>${chips}${clearLink}</div>`;
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

function handleLogout(req: Request) {
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

function handleAiTasks(_req: Request, url: URL, match: RegExpMatchArray) {
  const owner = url.searchParams.get("owner");
  if (!owner) return jsonResponse({ message: "Missing owner." }, 400);

  const days = Number(match[1]);
  if (!Number.isFinite(days) || days <= 0) return jsonResponse({ message: "Invalid day range." }, 400);

  const includeUnscheduled = (match[2] || "yes").toLowerCase() !== "no";
  const endDate = formatLocalDate(addDays(new Date(), Math.max(days - 1, 0)));

  const scheduled = listScheduledTodos(owner, endDate);
  const unscheduled = includeUnscheduled ? listUnscheduledTodos(owner) : [];

  return jsonResponse({
    owner,
    range_days: days,
    generated_at: new Date().toISOString(),
    scheduled,
    unscheduled: includeUnscheduled ? unscheduled : [],
  });
}

async function handleSummaryPost(req: Request) {
  const body = (await safeJson(req)) as Partial<{
    owner: string;
    summary_date: string;
    day_ahead: string | null;
    week_ahead: string | null;
    suggestions: string | null;
  }> | null;
  if (!body?.owner || !body.summary_date) {
    return jsonResponse({ message: "Missing owner or summary_date." }, 400);
  }

  if (!isValidDateString(body.summary_date)) {
    return jsonResponse({ message: "Invalid summary_date format. Use YYYY-MM-DD." }, 422);
  }

  const dayAhead = normalizeSummaryText(body.day_ahead);
  const weekAhead = normalizeSummaryText(body.week_ahead);
  const suggestions = normalizeSummaryText(body.suggestions);

  if (!dayAhead && !weekAhead && !suggestions) {
    return jsonResponse({ message: "Provide at least one of day_ahead, week_ahead, or suggestions." }, 422);
  }

  const summary = upsertSummary({
    owner: body.owner,
    summaryDate: body.summary_date,
    dayAhead,
    weekAhead,
    suggestions,
  });

  if (!summary) return jsonResponse({ message: "Unable to save summary." }, 500);

  return jsonResponse({
    owner: summary.owner,
    summary_date: summary.summary_date,
    updated_at: summary.updated_at,
  });
}

function handleLatestSummary(url: URL) {
  const owner = url.searchParams.get("owner");
  if (!owner) return jsonResponse({ message: "Missing owner." }, 400);
  const today = new Date();
  const todayString = formatLocalDate(today);
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const { day, week } = getLatestSummaries(owner, todayString, formatLocalDate(weekStart), formatLocalDate(weekEnd));
  return jsonResponse({
    owner,
    day,
    week,
  });
}

type TaskInput = {
  title?: string;
  description?: string;
  priority?: string;
  state?: string;
  scheduled_for?: string | null;
  tags?: string;
};

type AiTasksPostBody = {
  owner?: string;
  tasks?: TaskInput[];
};

const MAX_TASKS_PER_REQUEST = 50;
const MAX_TITLE_LENGTH = 500;

async function handleAiTasksPost(req: Request) {
  const body = (await safeJson(req)) as AiTasksPostBody | null;

  if (!body?.owner) {
    return jsonResponse({ message: "Missing owner." }, 400);
  }

  if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
    return jsonResponse({ message: "Missing or empty tasks array." }, 400);
  }

  if (body.tasks.length > MAX_TASKS_PER_REQUEST) {
    return jsonResponse({ message: `Maximum ${MAX_TASKS_PER_REQUEST} tasks per request.` }, 400);
  }

  const created: Todo[] = [];
  const failed: Array<{ index: number; title?: string; reason: string }> = [];

  for (let i = 0; i < body.tasks.length; i++) {
    const task = body.tasks[i];
    const title = task.title?.trim().slice(0, MAX_TITLE_LENGTH);

    if (!title) {
      failed.push({ index: i, title: task.title, reason: "Missing or empty title." });
      continue;
    }

    const priority = normalizePriority(task.priority ?? "sand");
    const state = normalizeState(task.state ?? "new");
    const scheduled_for = task.scheduled_for && isValidDateString(task.scheduled_for) ? task.scheduled_for : null;
    const tags = task.tags?.trim() ?? "";
    const description = task.description?.trim() ?? "";

    const todo = addTodoFull(body.owner, {
      title,
      description,
      priority,
      state,
      scheduled_for,
      tags,
    });

    if (todo) {
      created.push(todo);
    } else {
      failed.push({ index: i, title, reason: "Failed to create task." });
    }
  }

  return jsonResponse({
    owner: body.owner,
    created_at: new Date().toISOString(),
    created,
    failed,
  });
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function isValidDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00");
  return !Number.isNaN(parsed.valueOf());
}

function normalizeSummaryText(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10000);
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseUpdateForm(form: FormData):
  | { title: string; description: string; priority: TodoPriority; state: TodoState; scheduled_for: string | null; tags: string }
  | null {
  const title = String(form.get("title") ?? "").trim();
  if (!title) return null;
  const description = String(form.get("description") ?? "").trim();
  const priority = normalizePriority(String(form.get("priority") ?? "sand"));
  const state = normalizeState(String(form.get("state") ?? "ready"));
  const scheduledRaw = String(form.get("scheduled_for") ?? "").trim();
  const scheduled_for = scheduledRaw && isValidDateString(scheduledRaw) ? scheduledRaw : null;
  const tags = String(form.get("tags") ?? "").trim();
  return { title, description, priority, state, scheduled_for, tags };
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

function renderTagsDisplay(tags: string) {
  if (!tags) return "";
  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  if (tagList.length === 0) return "";
  return `<span class="tags-display">${tagList.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}</span>`;
}

function renderTagsInput(tags: string) {
  const tagList = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const chips = tagList.map((t) => `<span class="tag-chip" data-tag="${escapeHtml(t)}">${escapeHtml(t)}<span class="remove-tag">&times;</span></span>`).join("");
  return `
    <label>Tags
      <div class="tag-input-wrapper">
        ${chips}
        <input type="text" placeholder="Type and press comma..." />
        <input type="hidden" name="tags" value="${escapeHtml(tags)}" />
      </div>
    </label>`;
}

function renderTodoItem(todo: Todo) {
  const description = todo.description ? `<p class="todo-description">${escapeHtml(todo.description)}</p>` : "";
  const scheduled = todo.scheduled_for
    ? `<p class="todo-description"><strong>Scheduled for:</strong> ${escapeHtml(todo.scheduled_for)}</p>`
    : "";
  const tagsDisplay = renderTagsDisplay(todo.tags);
  return `
    <li>
      <details>
        <summary>
          <span class="todo-title">${escapeHtml(todo.title)}</span>
          <span class="badges">
            <span class="badge priority-${todo.priority}">${formatPriorityLabel(todo.priority)}</span>
            <span class="badge state-${todo.state}">${formatStateLabel(todo.state)}</span>
            ${tagsDisplay}
          </span>
        </summary>
        <div class="todo-body">
          ${description}
          ${scheduled}
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
            <label>Scheduled For
              <input type="date" name="scheduled_for" value="${todo.scheduled_for ? escapeHtml(todo.scheduled_for) : ""}" />
            </label>
            ${renderTagsInput(todo.tags)}
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

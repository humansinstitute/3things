import { getEntriesForDate, getRecentEntries, upsertEntry } from "../db";
import { jsonResponse, safeJson, unauthorized } from "../http";

import type { Session } from "../types";

export function handleGetEntries(url: URL, session: Session | null) {
  if (!session) return unauthorized();

  const date = url.searchParams.get("date");
  if (!date) {
    return jsonResponse({ error: "date parameter required" }, 400);
  }

  const entries = getEntriesForDate(session.npub, date);
  return jsonResponse({ entries });
}

export function handleGetRecentEntries(url: URL, session: Session | null) {
  if (!session) return unauthorized();

  const beforeDate = url.searchParams.get("before") || new Date().toISOString().slice(0, 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "30", 10), 100);

  const entries = getRecentEntries(session.npub, beforeDate, limit);
  return jsonResponse({ entries });
}

export async function handleSaveEntry(req: Request, session: Session | null) {
  if (!session) return unauthorized();

  const body = await safeJson(req);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { entry_date, slot, encrypted_content } = body;

  if (!entry_date || typeof entry_date !== "string") {
    return jsonResponse({ error: "entry_date required (YYYY-MM-DD format)" }, 400);
  }

  if (typeof slot !== "number" || slot < 1 || slot > 3) {
    return jsonResponse({ error: "slot must be 1, 2, or 3" }, 400);
  }

  if (!encrypted_content || typeof encrypted_content !== "string") {
    return jsonResponse({ error: "encrypted_content required" }, 400);
  }

  const entry = upsertEntry(session.npub, entry_date, slot, encrypted_content);
  if (!entry) {
    return jsonResponse({ error: "Failed to save entry" }, 500);
  }

  return jsonResponse({ entry });
}

// Entry management for Three Things journal

import { elements as el, hide, show, setText } from "./dom.js";
import { encryptEntry, decryptEntries } from "./entryCrypto.js";
import { state } from "./state.js";

// Ordinal prompt labels
const PROMPTS = [
  "What's your first thing?",
  "What's your second thing?",
  "What's your third thing?",
];

// State
let todayEntries = []; // Decrypted entries for today (slots 1-3)
let historyEntries = []; // Decrypted entries for past days
let lastHistoryDate = null; // For pagination
let isLoading = false;

export async function initEntries() {
  if (!state.session) return;

  // Set today's date
  updateTodayDate();

  // Wire up form submission
  el.entryForm?.addEventListener("submit", handleEntrySubmit);

  // Wire up Shift+Enter to save
  el.entryInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      el.entryForm?.requestSubmit();
    }
  });

  // Wire up load more button
  el.loadMoreBtn?.addEventListener("click", loadMoreHistory);

  // Load today's entries
  await loadTodayEntries();

  // Load initial history
  await loadHistory();
}

function updateTodayDate() {
  const today = new Date();
  const options = { weekday: "long", month: "long", day: "numeric" };
  const formatted = today.toLocaleDateString("en-US", options);
  setText(el.todayDate, `Today - ${formatted}`);
}

function getTodayDateString() {
  const today = new Date();
  return today.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function loadTodayEntries() {
  if (!state.session) return;

  const date = getTodayDateString();
  try {
    const response = await fetch(`/entries?date=${date}`);
    if (!response.ok) throw new Error("Failed to fetch entries");

    const data = await response.json();
    if (data.entries && data.entries.length > 0) {
      todayEntries = await decryptEntries(data.entries);
    } else {
      todayEntries = [];
    }

    renderTodayState();
  } catch (err) {
    console.error("Failed to load today's entries:", err);
    todayEntries = [];
    renderTodayState();
  }
}

function renderTodayState() {
  const completedCount = todayEntries.length;

  // Render completed entries
  if (el.completedEntries) {
    if (completedCount === 0) {
      el.completedEntries.innerHTML = "";
    } else {
      const html = todayEntries
        .map(
          (entry, index) => `
        <div class="completed-entry">
          <span class="entry-number">${index + 1}.</span>
          <span class="entry-content">${escapeHtml(entry.content)}</span>
        </div>
      `
        )
        .join("");
      el.completedEntries.innerHTML = html;
    }
  }

  // Update form state
  if (completedCount >= 3) {
    // All done!
    hide(el.entryFormContainer);
    show(el.todayStatus);
    setText(el.todayStatus, "Done");
  } else {
    show(el.entryFormContainer);
    hide(el.todayStatus);

    // Update prompt and progress
    const nextSlot = completedCount + 1;
    setText(el.entryPrompt, PROMPTS[completedCount] || "Add another thing");
    setText(el.entryProgress, `Thing ${nextSlot} of 3`);

    // Update button text
    if (el.entrySubmit) {
      el.entrySubmit.textContent = nextSlot === 3 ? "Save" : "Save & Continue";
    }

    // Clear and focus input
    if (el.entryInput) {
      el.entryInput.value = "";
      el.entryInput.focus();
    }
  }
}

async function handleEntrySubmit(event) {
  event.preventDefault();
  if (!state.session || isLoading) return;

  const content = el.entryInput?.value?.trim();
  if (!content) return;

  const nextSlot = todayEntries.length + 1;
  if (nextSlot > 3) return;

  isLoading = true;
  if (el.entrySubmit) el.entrySubmit.disabled = true;

  try {
    // Encrypt the content
    const encryptedContent = await encryptEntry(content);

    // Save to server
    const response = await fetch("/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entry_date: getTodayDateString(),
        slot: nextSlot,
        encrypted_content: encryptedContent,
      }),
    });

    if (!response.ok) throw new Error("Failed to save entry");

    // Add to local state and re-render
    todayEntries.push({
      slot: nextSlot,
      content,
      decrypted: true,
    });

    renderTodayState();
  } catch (err) {
    console.error("Failed to save entry:", err);
    alert("Failed to save entry. Please try again.");
  } finally {
    isLoading = false;
    if (el.entrySubmit) el.entrySubmit.disabled = false;
  }
}

async function loadHistory() {
  if (!state.session || isLoading) return;

  const today = getTodayDateString();
  const beforeDate = lastHistoryDate || today;

  isLoading = true;
  hide(el.historyLoading);

  try {
    const response = await fetch(`/entries/recent?before=${beforeDate}&limit=30`);
    if (!response.ok) throw new Error("Failed to fetch history");

    const data = await response.json();
    if (data.entries && data.entries.length > 0) {
      const decrypted = await decryptEntries(data.entries);
      historyEntries.push(...decrypted);

      // Update pagination cursor
      const lastEntry = data.entries[data.entries.length - 1];
      lastHistoryDate = lastEntry.entry_date;

      renderHistory();

      // Show load more if we got a full page
      if (data.entries.length >= 30) {
        show(el.historyLoadMore);
      } else {
        hide(el.historyLoadMore);
      }
    } else {
      hide(el.historyLoadMore);
      if (historyEntries.length === 0) {
        if (el.historyList) {
          el.historyList.innerHTML = '<p class="history-empty">No past entries yet.</p>';
        }
      }
    }
  } catch (err) {
    console.error("Failed to load history:", err);
    if (el.historyList && historyEntries.length === 0) {
      el.historyList.innerHTML = '<p class="history-error">Failed to load history.</p>';
    }
  } finally {
    isLoading = false;
  }
}

async function loadMoreHistory() {
  await loadHistory();
}

function renderHistory() {
  if (!el.historyList) return;

  // Group entries by date
  const byDate = new Map();
  for (const entry of historyEntries) {
    const date = entry.entry_date;
    if (!byDate.has(date)) {
      byDate.set(date, []);
    }
    byDate.get(date).push(entry);
  }

  // Sort dates descending
  const sortedDates = Array.from(byDate.keys()).sort((a, b) => b.localeCompare(a));

  // Render each date group
  const html = sortedDates
    .map((date) => {
      const entries = byDate.get(date).sort((a, b) => a.slot - b.slot);
      const dateLabel = formatHistoryDate(date);
      const entriesHtml = entries
        .map(
          (entry) => `
        <div class="history-entry">
          <span class="entry-number">${entry.slot}.</span>
          <span class="entry-content">${entry.decrypted ? escapeHtml(entry.content) : entry.content}</span>
        </div>
      `
        )
        .join("");

      return `
        <div class="history-day">
          <h3 class="history-date">${dateLabel}</h3>
          ${entriesHtml}
        </div>
      `;
    })
    .join("");

  el.historyList.innerHTML = html || '<p class="history-empty">No past entries yet.</p>';
}

function formatHistoryDate(dateStr) {
  const date = new Date(dateStr + "T12:00:00"); // Use noon to avoid timezone issues
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = (d) => d.toISOString().slice(0, 10);

  if (dateOnly(date) === dateOnly(today)) {
    return "Today";
  }
  if (dateOnly(date) === dateOnly(yesterday)) {
    return "Yesterday";
  }

  const options = { weekday: "long", month: "long", day: "numeric" };
  return date.toLocaleDateString("en-US", options);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

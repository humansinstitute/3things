import { DEFAULT_RELAYS, PROFILE_CACHE_KEY, EPHEMERAL_SECRET_KEY } from "./constants.js";
import { elements as el, hide, show } from "./dom.js";
import { loadApplesauceLibs, loadNostrLibs, hexToBytes } from "./nostr.js";
import { state } from "./state.js";
import {
  getMemorySecret,
  promptPinForDecrypt,
  hasEncryptedSecret,
  getMemoryBunkerSigner,
  promptPinForBunkerDecrypt,
  hasEncryptedBunker,
  setMemoryBunkerSigner,
  setMemoryBunkerUri,
} from "./pin.js";

let profilePool;
let avatarMenuWatcherActive = false;
let avatarRequestId = 0;

// In-memory profile cache (also persisted to localStorage)
const profileCache = new Map();

// Load cached profiles from localStorage on init
function loadProfileCache() {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    if (cached) {
      const profiles = JSON.parse(cached);
      for (const [pubkey, profile] of Object.entries(profiles)) {
        profileCache.set(pubkey, profile);
      }
    }
  } catch (_err) {
    // Ignore parse errors
  }
}

// Save profile cache to localStorage
function saveProfileCache() {
  try {
    const obj = Object.fromEntries(profileCache);
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(obj));
  } catch (_err) {
    // Ignore storage errors
  }
}

// Get a cached profile by pubkey
export function getCachedProfile(pubkey) {
  if (!pubkey) return null;
  return profileCache.get(pubkey) || null;
}

// Initialize profile cache from localStorage
loadProfileCache();

export const initAvatarMenu = () => {
  el.avatarButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!state.session) return;
    if (el.avatarMenu?.hasAttribute("hidden")) openAvatarMenu();
    else closeAvatarMenu();
  });

  el.avatarMenu?.addEventListener("click", (event) => event.stopPropagation());

  // Wire up profile view button
  el.viewProfileBtn?.addEventListener("click", () => {
    closeAvatarMenu();
    openProfileModal();
  });

  // Wire up profile modal close
  el.profileCloseBtn?.addEventListener("click", closeProfileModal);
  el.profileModal?.addEventListener("click", (event) => {
    if (event.target === el.profileModal) closeProfileModal();
  });

  // Wire up profile edit
  el.profileEditBtn?.addEventListener("click", openProfileEditForm);
  el.profileEditCancel?.addEventListener("click", closeProfileEditForm);
  el.profileEditForm?.addEventListener("submit", handleProfileSubmit);
};

export const updateAvatar = async () => {
  if (!el.avatarButton || !el.avatarFallback) return;
  if (!state.session) {
    hide(el.avatarButton);
    if (el.avatarImg) {
      el.avatarImg.src = "";
      hide(el.avatarImg);
    }
    el.avatarFallback.textContent = "•••";
    return;
  }
  show(el.avatarButton);
  el.avatarFallback.textContent = formatAvatarLabel(state.session.npub);
  show(el.avatarFallback);
  el.avatarImg?.setAttribute("hidden", "hidden");
  const currentRequest = ++avatarRequestId;
  const profile = await fetchProfile(state.session.pubkey);
  if (currentRequest !== avatarRequestId) return;
  if (profile?.picture && el.avatarImg) {
    el.avatarImg.src = profile.picture;
    show(el.avatarImg);
    hide(el.avatarFallback);
  } else {
    hide(el.avatarImg);
    show(el.avatarFallback);
  }
};

export const closeAvatarMenu = () => {
  hide(el.avatarMenu);
  avatarMenuWatcherActive = false;
};

function openAvatarMenu() {
  show(el.avatarMenu);
  if (!avatarMenuWatcherActive) {
    avatarMenuWatcherActive = true;
    document.addEventListener("click", handleAvatarOutside, { once: true });
  }
}

function handleAvatarOutside(event) {
  avatarMenuWatcherActive = false;
  if ((el.avatarMenu && el.avatarMenu.contains(event.target)) || (el.avatarButton && el.avatarButton.contains(event.target))) {
    document.addEventListener("click", handleAvatarOutside, { once: true });
    avatarMenuWatcherActive = true;
    return;
  }
  closeAvatarMenu();
}

// Clear cached profile for a pubkey (forces refresh on next fetch)
export function clearCachedProfile(pubkey) {
  if (pubkey) {
    profileCache.delete(pubkey);
    saveProfileCache();
  }
}

// Fetch and cache a profile, returns the profile object
export async function fetchProfile(pubkey, forceRefresh = false) {
  if (!pubkey) return null;

  // Check cache first (with 1 hour expiry) - skip if forcing refresh
  const cached = profileCache.get(pubkey);
  if (!forceRefresh && cached && cached.fetchedAt && Date.now() - cached.fetchedAt < 3600000) {
    // Only use cache if it has real profile data (not just fallback)
    if (cached.name || cached.displayName || cached.nip05) {
      return cached;
    }
  }

  const fallbackPicture = fallbackAvatarUrl(pubkey);

  try {
    const libs = await loadApplesauceLibs();
    const { RelayPool, onlyEvents } = libs.relay;
    const { firstValueFrom, take, takeUntil, timer } = libs.rxjs;
    profilePool = profilePool || new RelayPool();

    const observable = profilePool
      .subscription(DEFAULT_RELAYS, [{ authors: [pubkey], kinds: [0], limit: 1 }])
      .pipe(onlyEvents(), take(1), takeUntil(timer(8000)));

    const event = await firstValueFrom(observable, { defaultValue: null });

    if (!event) {
      // Don't cache fallback-only profiles for long - retry sooner
      const profile = { pubkey, picture: fallbackPicture, fetchedAt: Date.now() - 3300000 }; // 5 min cache
      profileCache.set(pubkey, profile);
      saveProfileCache();
      return profile;
    }

    // Parse the Kind 0 content (JSON metadata)
    const metadata = JSON.parse(event.content);

    // Helper to safely extract string fields
    const getString = (val) => (typeof val === "string" && val.trim() ? val.trim() : null);

    const profile = {
      pubkey,
      name: getString(metadata.name) || getString(metadata.display_name),
      displayName: getString(metadata.display_name) || getString(metadata.name),
      about: getString(metadata.about),
      picture: getString(metadata.picture) || fallbackPicture,
      banner: getString(metadata.banner),
      nip05: getString(metadata.nip05),
      lud16: getString(metadata.lud16),
      website: getString(metadata.website),
      fetchedAt: Date.now(),
    };

    profileCache.set(pubkey, profile);
    saveProfileCache();
    return profile;
  } catch (error) {
    console.warn("Profile fetch error:", error);
    // Don't cache errors for long
    const profile = { pubkey, picture: fallbackPicture, fetchedAt: Date.now() - 3300000 };
    profileCache.set(pubkey, profile);
    saveProfileCache();
    return profile;
  }
}

// Profile modal functions
async function openProfileModal() {
  if (!state.session) return;
  show(el.profileModal);

  // Ensure we're in view mode (not edit mode)
  show(el.profileView);
  hide(el.profileEditForm);
  hideProfileStatus();

  // Show loading state
  if (el.profileName) el.profileName.textContent = "Loading...";
  if (el.profileNip05) el.profileNip05.textContent = "";
  if (el.profileAbout) el.profileAbout.textContent = "";
  if (el.profileNpub) el.profileNpub.textContent = state.session.npub;
  if (el.profileAvatar) el.profileAvatar.innerHTML = "";

  // Fetch and display profile (force refresh to get latest)
  const profile = await fetchProfile(state.session.pubkey, true);

  if (el.profileName) {
    el.profileName.textContent = profile?.displayName || profile?.name || formatNpubShort(state.session.npub);
  }
  if (el.profileNip05 && profile?.nip05) {
    el.profileNip05.textContent = profile.nip05;
  }
  if (el.profileAbout) {
    el.profileAbout.textContent = profile?.about || "";
  }
  if (el.profileAvatar && profile?.picture) {
    el.profileAvatar.innerHTML = `<img src="${profile.picture}" alt="Profile photo" />`;
  }
}

function closeProfileModal() {
  hide(el.profileModal);
  closeProfileEditForm();
}

function openProfileEditForm() {
  // Get current profile data
  const profile = getCachedProfile(state.session?.pubkey);

  // Populate form with current values
  if (el.profileEditName) {
    el.profileEditName.value = profile?.displayName || profile?.name || "";
  }
  if (el.profileEditAbout) {
    el.profileEditAbout.value = profile?.about || "";
  }
  if (el.profileEditPicture) {
    el.profileEditPicture.value = profile?.picture || "";
  }

  // Hide view, show form
  hide(el.profileView);
  show(el.profileEditForm);
  hideProfileStatus();
}

function closeProfileEditForm() {
  hide(el.profileEditForm);
  show(el.profileView);
  hideProfileStatus();
}

function showProfileStatus(message, isError = false) {
  if (!el.profileEditStatus) return;
  el.profileEditStatus.textContent = message;
  el.profileEditStatus.className = `profile-edit-status ${isError ? "error" : "success"}`;
  show(el.profileEditStatus);
}

function hideProfileStatus() {
  hide(el.profileEditStatus);
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  if (!state.session) return;

  const displayName = el.profileEditName?.value.trim() || "";
  const about = el.profileEditAbout?.value.trim() || "";
  const picture = el.profileEditPicture?.value.trim() || "";

  // Build profile metadata
  const metadata = {};
  if (displayName) {
    metadata.name = displayName;
    metadata.display_name = displayName;
  }
  if (about) metadata.about = about;
  if (picture) metadata.picture = picture;

  try {
    showProfileStatus("Publishing profile...");
    await publishProfile(metadata);
    showProfileStatus("Profile published successfully!");

    // Refresh the profile view
    setTimeout(async () => {
      closeProfileEditForm();
      // Force refresh by clearing cache for this pubkey
      profileCache.delete(state.session.pubkey);
      await fetchProfile(state.session.pubkey);
      await updateAvatar();
      await openProfileModal();
    }, 1500);
  } catch (err) {
    console.error("Failed to publish profile:", err);
    showProfileStatus(err.message || "Failed to publish profile", true);
  }
}

async function publishProfile(metadata) {
  const nostrLibs = await loadNostrLibs();
  const applesauceLibs = await loadApplesauceLibs();

  // Build the Kind 0 event
  const event = {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(metadata),
  };

  let signedEvent;

  // Sign the event based on login method
  if (state.session.method === "ephemeral") {
    const stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
    if (!stored) throw new Error("No secret key found.");
    const secret = hexToBytes(stored);
    signedEvent = nostrLibs.pure.finalizeEvent(event, secret);
  } else if (state.session.method === "extension") {
    if (!window.nostr?.signEvent) {
      throw new Error("No NIP-07 browser extension found.");
    }
    event.pubkey = state.session.pubkey;
    signedEvent = await window.nostr.signEvent(event);
  } else if (state.session.method === "secret") {
    // For secret-based login, get the secret from memory or prompt for PIN
    let secret = getMemorySecret();
    if (!secret && hasEncryptedSecret()) {
      secret = await promptPinForDecrypt();
    }
    if (!secret) throw new Error("No secret key available. Please log in again.");
    signedEvent = nostrLibs.pure.finalizeEvent(event, secret);
  } else if (state.session.method === "bunker") {
    // For bunker-based login, get the signer from memory or reconnect
    let signer = getMemoryBunkerSigner();

    if (!signer && hasEncryptedBunker()) {
      // Prompt for PIN to decrypt bunker URI and reconnect
      const bunkerUri = await promptPinForBunkerDecrypt();
      if (!bunkerUri) throw new Error("No bunker connection available. Please log in again.");

      // Reconnect to bunker
      const { nip46 } = nostrLibs;
      const pointer = await nip46.parseBunkerInput(bunkerUri);
      if (!pointer) throw new Error("Unable to parse bunker details.");

      const clientSecret = nostrLibs.pure.generateSecretKey();
      signer = new nip46.BunkerSigner(clientSecret, pointer);
      await signer.connect();

      // Store signer in memory for future use
      setMemoryBunkerSigner(signer);
      setMemoryBunkerUri(bunkerUri);
    }

    if (!signer) throw new Error("No bunker connection available. Please log in again.");

    event.pubkey = state.session.pubkey;
    signedEvent = await signer.signEvent(event);
  } else {
    throw new Error("Profile editing not supported for this login method.");
  }

  // Publish to relays
  const { RelayPool } = applesauceLibs.relay;
  const publishPool = new RelayPool();

  await Promise.all(
    DEFAULT_RELAYS.map(async (relay) => {
      try {
        await publishPool.publish(relay, signedEvent);
      } catch (_err) {
        // Ignore individual relay errors
      }
    })
  );

  // Update local cache
  const updatedProfile = {
    ...getCachedProfile(state.session.pubkey),
    ...metadata,
    pubkey: state.session.pubkey,
    fetchedAt: Date.now(),
  };
  profileCache.set(state.session.pubkey, updatedProfile);
  saveProfileCache();

  return signedEvent;
}

function formatNpubShort(npub) {
  if (!npub) return "Anonymous";
  const trimmed = npub.replace(/^npub1/, "");
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-8)}`;
}

function fallbackAvatarUrl(pubkey) {
  return `https://robohash.org/${pubkey || "nostr"}.png?set=set3`;
}

function formatAvatarLabel(npub) {
  if (!npub) return "•••";
  const trimmed = npub.replace(/^npub1/, "");
  return trimmed.slice(0, 2).toUpperCase();
}

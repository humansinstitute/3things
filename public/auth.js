import {
  AUTO_LOGIN_METHOD_KEY,
  AUTO_LOGIN_PUBKEY_KEY,
  DEFAULT_RELAYS,
  EPHEMERAL_SECRET_KEY,
} from "./constants.js";
import { closeAvatarMenu, clearCachedProfile } from "./avatar.js";
import { elements as el, hide, show } from "./dom.js";
import {
  buildUnsignedEvent,
  bytesToHex,
  decodeNsec,
  hexToBytes,
  loadNostrLibs,
  loadQRCodeLib,
} from "./nostr.js";
import { clearError, showError } from "./ui.js";
import { setSession, state } from "./state.js";
import {
  initPinModal,
  promptPinForNewSecret,
  promptPinForDecrypt,
  promptPinForNewBunker,
  promptPinForBunkerDecrypt,
  getMemorySecret,
  setMemorySecret,
  getMemoryBunkerSigner,
  setMemoryBunkerSigner,
  getMemoryBunkerUri,
  setMemoryBunkerUri,
  clearAllStoredCredentials,
  hasEncryptedSecret,
  hasEncryptedBunker,
} from "./pin.js";

let autoLoginAttempted = false;

export const initAuth = () => {
  initPinModal();
  wireLoginButtons();
  wireForms();
  wireMenuButtons();
  wireQrModal();

  void checkFragmentLogin().then(() => {
    if (!state.session) void maybeAutoLogin();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !state.session) {
      void maybeAutoLogin();
    }
  });
};

const wireLoginButtons = () => {
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
};

const wireForms = () => {
  const bunkerForm = document.querySelector("[data-bunker-form]");
  const secretForm = document.querySelector("[data-secret-form]");

  bunkerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = bunkerForm.querySelector("input[name='bunker']");
    if (!input?.value.trim()) {
      showError("Enter a bunker nostrconnect URI or NIP-05 handle.");
      return;
    }
    const bunkerUri = input.value.trim();
    bunkerForm.classList.add("is-busy");
    clearError();
    try {
      const signedEvent = await signLoginEvent("bunker", bunkerUri);
      await completeLogin("bunker", signedEvent, bunkerUri);
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
};

const wireMenuButtons = () => {
  el.exportSecretBtn?.addEventListener("click", handleExportSecret);

  el.copyIdBtn?.addEventListener("click", async () => {
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
    } catch (_err) {
      prompt("Copy your ID:", npub);
    }
  });

  el.logoutBtn?.addEventListener("click", async () => {
    closeAvatarMenu();
    await fetch("/auth/logout", { method: "POST" });
    setSession(null);
    clearAutoLogin();
    clearAllStoredCredentials();
    window.location.reload();
  });
};

const wireQrModal = () => {
  el.showLoginQrBtn?.addEventListener("click", () => {
    closeAvatarMenu();
    void openQrModal();
  });
  el.qrCloseBtn?.addEventListener("click", closeQrModal);
  el.qrModal?.addEventListener("click", (event) => {
    if (event.target === el.qrModal) closeQrModal();
  });
};

const openQrModal = async () => {
  if (!el.qrModal || !el.qrContainer) return;
  if (state.session?.method !== "ephemeral") {
    alert("Login QR is only available for ephemeral accounts.");
    return;
  }
  const stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
  if (!stored) {
    alert("No secret key found.");
    return;
  }
  try {
    const { nip19 } = await loadNostrLibs();
    const QRCode = await loadQRCodeLib();
    const secret = hexToBytes(stored);
    const nsec = nip19.nsecEncode(secret);
    const loginUrl = `${window.location.origin}/#code=${nsec}`;
    el.qrContainer.innerHTML = "";
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, loginUrl, { width: 256, margin: 2 });
    el.qrContainer.appendChild(canvas);
    show(el.qrModal);
    document.addEventListener("keydown", handleQrEscape);
  } catch (err) {
    console.error("Failed to generate QR code", err);
    alert("Failed to generate QR code.");
  }
};

const closeQrModal = () => {
  hide(el.qrModal);
  document.removeEventListener("keydown", handleQrEscape);
};

const handleQrEscape = (event) => {
  if (event.key === "Escape") closeQrModal();
};

const checkFragmentLogin = async () => {
  const hash = window.location.hash;
  if (!hash.startsWith("#code=")) return;
  const nsec = hash.slice(6);
  if (!nsec || !nsec.startsWith("nsec1")) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return;
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  try {
    const { nip19 } = await loadNostrLibs();
    const secretBytes = decodeNsec(nip19, nsec);
    const secretHex = bytesToHex(secretBytes);
    localStorage.setItem(EPHEMERAL_SECRET_KEY, secretHex);
    const signedEvent = await signLoginEvent("ephemeral");
    await completeLogin("ephemeral", signedEvent);
  } catch (err) {
    console.error("Fragment login failed", err);
    showError(err?.message || "Login failed.");
  }
};

const maybeAutoLogin = async () => {
  if (autoLoginAttempted || state.session) return;
  autoLoginAttempted = true;

  const method = localStorage.getItem(AUTO_LOGIN_METHOD_KEY);

  // Check for ephemeral login
  if (method === "ephemeral") {
    const hasSecret = !!localStorage.getItem(EPHEMERAL_SECRET_KEY);
    if (!hasSecret) {
      autoLoginAttempted = false;
      return;
    }
    try {
      const signedEvent = await signLoginEvent("ephemeral");
      await completeLogin("ephemeral", signedEvent);
      return;
    } catch (err) {
      console.error("Auto login failed", err);
      clearAutoLogin();
      autoLoginAttempted = false;
    }
  }

  // Check for encrypted secret login
  if (method === "secret" && hasEncryptedSecret()) {
    try {
      const signedEvent = await signLoginEvent("secret");
      await completeLogin("secret", signedEvent);
      return;
    } catch (err) {
      console.error("Auto login with encrypted secret failed", err);
      // Don't clear auto-login on PIN cancellation - user can try again
      autoLoginAttempted = false;
    }
  }

  // Check for encrypted bunker login
  if (method === "bunker" && hasEncryptedBunker()) {
    try {
      const signedEvent = await signLoginEvent("bunker");
      await completeLogin("bunker", signedEvent);
      return;
    } catch (err) {
      console.error("Auto login with encrypted bunker failed", err);
      // Don't clear auto-login on PIN cancellation - user can try again
      autoLoginAttempted = false;
    }
  }

  autoLoginAttempted = false;
};

const signLoginEvent = async (method, supplemental) => {
  if (method === "ephemeral") {
    const { pure } = await loadNostrLibs();
    let stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
    if (!stored) {
      stored = bytesToHex(pure.generateSecretKey());
      localStorage.setItem(EPHEMERAL_SECRET_KEY, stored);
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

    // Check if we have an active bunker signer in memory
    let signer = getMemoryBunkerSigner();

    if (signer) {
      // Use existing signer
      return await signer.signEvent(buildUnsignedEvent(method));
    }

    // Determine bunker URI to use
    let bunkerUri = supplemental;

    if (!bunkerUri) {
      // Check if we have a stored bunker URI in memory
      bunkerUri = getMemoryBunkerUri();
    }

    if (!bunkerUri && hasEncryptedBunker()) {
      // Prompt for PIN to decrypt stored bunker URI
      bunkerUri = await promptPinForBunkerDecrypt();
    }

    if (!bunkerUri) {
      throw new Error("No bunker connection available.");
    }

    // Parse and connect to bunker
    const pointer = await nip46.parseBunkerInput(bunkerUri);
    if (!pointer) throw new Error("Unable to parse bunker details.");

    const clientSecret = pure.generateSecretKey();
    signer = new nip46.BunkerSigner(clientSecret, pointer);
    await signer.connect();

    // Store the signer in memory for future use
    setMemoryBunkerSigner(signer);
    setMemoryBunkerUri(bunkerUri);

    // If this is a new bunker connection (supplemental was provided), prompt for PIN to store
    if (supplemental) {
      // Don't await this - we'll store after successful login
      // The PIN prompt will happen after the login event is signed
    }

    return await signer.signEvent(buildUnsignedEvent(method));
  }

  if (method === "secret") {
    const { pure, nip19 } = await loadNostrLibs();

    // Check if we have a memory secret (already decrypted)
    let secret = getMemorySecret();

    if (!secret && supplemental) {
      // New secret being entered - decode and prompt for PIN
      const decodedSecret = decodeNsec(nip19, supplemental);
      const secretHex = bytesToHex(decodedSecret);

      // Prompt user to create a PIN and encrypt the secret
      secret = await promptPinForNewSecret(secretHex);
    } else if (!secret && hasEncryptedSecret()) {
      // We have an encrypted secret - prompt for PIN to decrypt
      secret = await promptPinForDecrypt();
    }

    if (!secret) {
      throw new Error("No secret key available.");
    }

    return pure.finalizeEvent(buildUnsignedEvent(method), secret);
  }

  throw new Error("Unsupported login method.");
};

// Track if we need to prompt for bunker PIN after login
let pendingBunkerPinPrompt = null;

const completeLogin = async (method, event, bunkerUriForStorage = null) => {
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
  const session = await response.json();
  setSession(session);

  // Clear any stale profile cache so we fetch fresh on reload
  clearCachedProfile(session.pubkey);

  if (method === "ephemeral") {
    localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "ephemeral");
    localStorage.setItem(AUTO_LOGIN_PUBKEY_KEY, session.pubkey);
    // Store ephemeral secret in memory for signing
    const stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
    if (stored) setMemorySecret(hexToBytes(stored));
  } else if (method === "secret") {
    // Secret login with encrypted storage
    localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "secret");
    localStorage.setItem(AUTO_LOGIN_PUBKEY_KEY, session.pubkey);
  } else if (method === "bunker") {
    // Bunker login with encrypted storage
    localStorage.setItem(AUTO_LOGIN_METHOD_KEY, "bunker");
    localStorage.setItem(AUTO_LOGIN_PUBKEY_KEY, session.pubkey);

    // If this is a new bunker connection, prompt for PIN to store it
    const bunkerUri = bunkerUriForStorage || getMemoryBunkerUri();
    if (bunkerUri && !hasEncryptedBunker()) {
      try {
        await promptPinForNewBunker(bunkerUri);
      } catch (err) {
        // User cancelled PIN - that's okay, they just won't have auto-login
        console.log("Bunker PIN storage cancelled:", err.message);
      }
    }
  } else {
    clearAutoLogin();
  }

  // Force a full page reload (bypass service worker cache)
  window.location.href = window.location.pathname + "?t=" + Date.now();
};

const handleExportSecret = async () => {
  closeAvatarMenu();
  if (state.session?.method !== "ephemeral") {
    alert("Export is only available for ephemeral accounts.");
    return;
  }
  const stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
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
      alert("Secret key copied to clipboard!\n\nKeep this safe - anyone with this key can access your account.");
    } else {
      prompt("Copy your secret key (keep it safe):", nsec);
    }
  } catch (err) {
    console.error(err);
    alert("Failed to export secret key.");
  }
};

const clearAutoLogin = () => {
  localStorage.removeItem(AUTO_LOGIN_METHOD_KEY);
  localStorage.removeItem(AUTO_LOGIN_PUBKEY_KEY);
};

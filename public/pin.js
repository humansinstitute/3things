// PIN entry modal handling
import { elements as el, hide, show } from "./dom.js";
import {
  encryptWithPin,
  decryptWithPin,
  storeEncryptedSecret,
  getEncryptedSecret,
  clearEncryptedSecret,
  hasEncryptedSecret,
  storeEncryptedBunker,
  getEncryptedBunker,
  clearEncryptedBunker,
  hasEncryptedBunker,
} from "./crypto.js";
import { bytesToHex, hexToBytes } from "./nostr.js";

const PIN_LENGTH = 6;
const SESSION_SECRET_KEY = "nostr_session_secret";
const SESSION_BUNKER_URI_KEY = "nostr_session_bunker_uri";

let currentPin = "";
let pinResolve = null;
let pinReject = null;
let isConfirmMode = false;
let firstPin = "";
let pendingSecretHex = null;
let pendingBunkerUri = null;
let decryptMode = null; // "secret" or "bunker"

// In-memory secret storage (survives page refresh via sessionStorage)
let memorySecret = null;

// In-memory bunker signer (kept alive for signing)
let memoryBunkerSigner = null;
let memoryBunkerUri = null;

// Restore from sessionStorage on module load
function restoreFromSession() {
  try {
    const storedSecret = sessionStorage.getItem(SESSION_SECRET_KEY);
    if (storedSecret) {
      // Convert hex back to Uint8Array
      const bytes = new Uint8Array(storedSecret.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(storedSecret.substr(i * 2, 2), 16);
      }
      memorySecret = bytes;
    }
    const storedBunkerUri = sessionStorage.getItem(SESSION_BUNKER_URI_KEY);
    if (storedBunkerUri) {
      memoryBunkerUri = storedBunkerUri;
    }
  } catch (err) {
    console.warn("Failed to restore from sessionStorage:", err);
  }
}

// Save to sessionStorage for persistence across refreshes
function saveSecretToSession(secretBytes) {
  try {
    const hex = Array.from(secretBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(SESSION_SECRET_KEY, hex);
  } catch (err) {
    console.warn("Failed to save to sessionStorage:", err);
  }
}

function saveBunkerUriToSession(uri) {
  try {
    sessionStorage.setItem(SESSION_BUNKER_URI_KEY, uri);
  } catch (err) {
    console.warn("Failed to save bunker URI to sessionStorage:", err);
  }
}

function clearSessionStorage() {
  try {
    sessionStorage.removeItem(SESSION_SECRET_KEY);
    sessionStorage.removeItem(SESSION_BUNKER_URI_KEY);
  } catch (err) {
    // Ignore
  }
}

// Restore on module initialization
restoreFromSession();

export const initPinModal = () => {
  // Wire up keypad buttons
  el.pinKeypad?.addEventListener("click", (event) => {
    const target = event.target;
    if (!target.hasAttribute("data-pin-key")) return;
    const key = target.getAttribute("data-pin-key");
    handleKeyPress(key);
  });

  // Wire up close button
  el.pinCloseBtn?.addEventListener("click", () => {
    closePinModal();
    if (pinReject) {
      pinReject(new Error("PIN entry cancelled"));
      pinReject = null;
      pinResolve = null;
    }
  });

  // Close on overlay click
  el.pinModal?.addEventListener("click", (event) => {
    if (event.target === el.pinModal) {
      closePinModal();
      if (pinReject) {
        pinReject(new Error("PIN entry cancelled"));
        pinReject = null;
        pinResolve = null;
      }
    }
  });

  // Handle keyboard input for PIN
  document.addEventListener("keydown", (event) => {
    // Only handle when PIN modal is visible
    if (el.pinModal?.hasAttribute("hidden")) return;

    // Handle escape to close
    if (event.key === "Escape") {
      closePinModal();
      if (pinReject) {
        pinReject(new Error("PIN entry cancelled"));
        pinReject = null;
        pinResolve = null;
      }
      return;
    }

    // Handle number keys (0-9)
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      handleKeyPress(event.key);
      return;
    }

    // Handle backspace
    if (event.key === "Backspace") {
      event.preventDefault();
      handleKeyPress("back");
      return;
    }

    // Handle delete/clear
    if (event.key === "Delete") {
      event.preventDefault();
      handleKeyPress("clear");
      return;
    }
  });
};

function handleKeyPress(key) {
  hidePinError();

  if (key === "clear") {
    currentPin = "";
    updatePinDisplay();
    return;
  }

  if (key === "back") {
    currentPin = currentPin.slice(0, -1);
    updatePinDisplay();
    return;
  }

  if (currentPin.length >= PIN_LENGTH) return;

  currentPin += key;
  updatePinDisplay();

  if (currentPin.length === PIN_LENGTH) {
    handlePinComplete();
  }
}

function updatePinDisplay() {
  if (!el.pinDots) return;
  el.pinDots.forEach((dot, index) => {
    if (index < currentPin.length) {
      dot.classList.add("filled");
    } else {
      dot.classList.remove("filled");
    }
  });
}

async function handlePinComplete() {
  if (isConfirmMode) {
    // We're confirming the PIN
    if (currentPin === firstPin) {
      // PINs match - encrypt and store
      try {
        if (pendingSecretHex) {
          // Encrypting a secret key
          const encrypted = await encryptWithPin(pendingSecretHex, currentPin);
          storeEncryptedSecret(encrypted);
          memorySecret = hexToBytes(pendingSecretHex);
          saveSecretToSession(memorySecret);
          closePinModal();
          if (pinResolve) {
            pinResolve(memorySecret);
            pinResolve = null;
            pinReject = null;
          }
        } else if (pendingBunkerUri) {
          // Encrypting a bunker URI
          const encrypted = await encryptWithPin(pendingBunkerUri, currentPin);
          storeEncryptedBunker(encrypted);
          memoryBunkerUri = pendingBunkerUri;
          saveBunkerUriToSession(memoryBunkerUri);
          closePinModal();
          if (pinResolve) {
            pinResolve(pendingBunkerUri);
            pinResolve = null;
            pinReject = null;
          }
        }
      } catch (err) {
        showPinError("Failed to encrypt. Try again.");
        resetPinEntry();
      }
    } else {
      // PINs don't match
      showPinError("PINs don't match. Try again.");
      isConfirmMode = false;
      firstPin = "";
      resetPinEntry();
      updatePinTitle("Create a PIN", "Enter a 6-digit PIN to secure your key");
    }
  } else if (pendingSecretHex) {
    // First PIN entry for new secret - need confirmation
    firstPin = currentPin;
    isConfirmMode = true;
    resetPinEntry();
    updatePinTitle("Confirm PIN", "Enter the same PIN again to confirm");
  } else if (pendingBunkerUri) {
    // First PIN entry for new bunker - need confirmation
    firstPin = currentPin;
    isConfirmMode = true;
    resetPinEntry();
    updatePinTitle("Confirm PIN", "Enter the same PIN again to confirm");
  } else if (decryptMode === "bunker") {
    // Decrypting existing bunker
    try {
      const encrypted = getEncryptedBunker();
      if (!encrypted) {
        showPinError("No encrypted bunker found.");
        return;
      }
      const decrypted = await decryptWithPin(encrypted, currentPin);
      memoryBunkerUri = decrypted;
      saveBunkerUriToSession(decrypted);
      closePinModal();
      if (pinResolve) {
        pinResolve(decrypted);
        pinResolve = null;
        pinReject = null;
      }
    } catch (err) {
      showPinError("Wrong PIN. Try again.");
      resetPinEntry();
    }
  } else {
    // Decrypting existing secret (default)
    try {
      const encrypted = getEncryptedSecret();
      if (!encrypted) {
        showPinError("No encrypted key found.");
        return;
      }
      const decrypted = await decryptWithPin(encrypted, currentPin);
      memorySecret = hexToBytes(decrypted);
      saveSecretToSession(memorySecret);
      closePinModal();
      if (pinResolve) {
        pinResolve(memorySecret);
        pinResolve = null;
        pinReject = null;
      }
    } catch (err) {
      showPinError("Wrong PIN. Try again.");
      resetPinEntry();
    }
  }
}

function resetPinEntry() {
  currentPin = "";
  updatePinDisplay();
}

function updatePinTitle(title, description) {
  if (el.pinTitle) el.pinTitle.textContent = title;
  if (el.pinDescription) el.pinDescription.textContent = description;
}

function showPinError(message) {
  if (el.pinError) {
    el.pinError.textContent = message;
    show(el.pinError);
  }
}

function hidePinError() {
  hide(el.pinError);
}

function openPinModal() {
  resetPinEntry();
  hidePinError();
  show(el.pinModal);
}

function closePinModal() {
  hide(el.pinModal);
  resetPinEntry();
  hidePinError();
  isConfirmMode = false;
  firstPin = "";
  pendingSecretHex = null;
  pendingBunkerUri = null;
  decryptMode = null;
}

// Prompt user for PIN to encrypt a new secret
// Returns the secret bytes after encryption is complete
export function promptPinForNewSecret(secretHex) {
  return new Promise((resolve, reject) => {
    pinResolve = resolve;
    pinReject = reject;
    pendingSecretHex = secretHex;
    isConfirmMode = false;
    firstPin = "";
    updatePinTitle("Create a PIN", "Enter a 6-digit PIN to secure your key");
    openPinModal();
  });
}

// Prompt user for PIN to decrypt existing secret
// Returns the decrypted secret bytes
export function promptPinForDecrypt() {
  return new Promise((resolve, reject) => {
    pinResolve = resolve;
    pinReject = reject;
    pendingSecretHex = null;
    pendingBunkerUri = null;
    decryptMode = "secret";
    isConfirmMode = false;
    firstPin = "";
    updatePinTitle("Enter PIN", "Enter your PIN to unlock your key");
    openPinModal();
  });
}

// Prompt user for PIN to encrypt a new bunker URI
// Returns the bunker URI after encryption is complete
export function promptPinForNewBunker(bunkerUri) {
  return new Promise((resolve, reject) => {
    pinResolve = resolve;
    pinReject = reject;
    pendingBunkerUri = bunkerUri;
    pendingSecretHex = null;
    decryptMode = null;
    isConfirmMode = false;
    firstPin = "";
    updatePinTitle("Create a PIN", "Enter a 6-digit PIN to secure your bunker connection");
    openPinModal();
  });
}

// Prompt user for PIN to decrypt existing bunker URI
// Returns the decrypted bunker URI
export function promptPinForBunkerDecrypt() {
  return new Promise((resolve, reject) => {
    pinResolve = resolve;
    pinReject = reject;
    pendingSecretHex = null;
    pendingBunkerUri = null;
    decryptMode = "bunker";
    isConfirmMode = false;
    firstPin = "";
    updatePinTitle("Enter PIN", "Enter your PIN to reconnect to bunker");
    openPinModal();
  });
}

// Get the in-memory secret (if available)
export function getMemorySecret() {
  return memorySecret;
}

// Set the in-memory secret directly (for ephemeral login)
export function setMemorySecret(secret) {
  memorySecret = secret;
  if (secret) {
    saveSecretToSession(secret);
  }
}

// Clear the in-memory secret
export function clearMemorySecret() {
  memorySecret = null;
  try {
    sessionStorage.removeItem(SESSION_SECRET_KEY);
  } catch (_err) {
    // Ignore
  }
}

// Get the in-memory bunker signer (if available)
export function getMemoryBunkerSigner() {
  return memoryBunkerSigner;
}

// Set the in-memory bunker signer
export function setMemoryBunkerSigner(signer) {
  memoryBunkerSigner = signer;
}

// Get the in-memory bunker URI
export function getMemoryBunkerUri() {
  return memoryBunkerUri;
}

// Set the in-memory bunker URI
export function setMemoryBunkerUri(uri) {
  memoryBunkerUri = uri;
  if (uri) {
    saveBunkerUriToSession(uri);
  }
}

// Clear the in-memory bunker signer
export function clearMemoryBunker() {
  if (memoryBunkerSigner) {
    try {
      memoryBunkerSigner.close();
    } catch (_err) {
      // Ignore close errors
    }
  }
  memoryBunkerSigner = null;
  memoryBunkerUri = null;
  try {
    sessionStorage.removeItem(SESSION_BUNKER_URI_KEY);
  } catch (_err) {
    // Ignore
  }
}

// Check if there's an encrypted secret stored
export { hasEncryptedSecret };

// Check if there's an encrypted bunker stored
export { hasEncryptedBunker };

// Clear encrypted secret (for logout)
export function clearStoredSecret() {
  clearEncryptedSecret();
  clearMemorySecret();
}

// Clear encrypted bunker (for logout)
export function clearStoredBunker() {
  clearEncryptedBunker();
  clearMemoryBunker();
}

// Clear all stored credentials (for logout)
export function clearAllStoredCredentials() {
  clearStoredSecret();
  clearStoredBunker();
  clearSessionStorage();
}

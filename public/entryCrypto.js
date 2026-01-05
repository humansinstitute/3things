// Entry encryption utilities using NIP-44
// Encrypts entry content to user's own pubkey (self-encryption)

import { EPHEMERAL_SECRET_KEY } from "./constants.js";
import { loadNostrLibs, hexToBytes } from "./nostr.js";
import { state } from "./state.js";
import {
  getMemorySecret,
  getMemoryBunkerSigner,
  promptPinForDecrypt,
  promptPinForBunkerDecrypt,
  hasEncryptedSecret,
  hasEncryptedBunker,
  setMemoryBunkerSigner,
  setMemoryBunkerUri,
} from "./pin.js";

// Encrypt entry content to the user's own pubkey using NIP-44
export async function encryptEntry(content) {
  if (!state.session) {
    throw new Error("Not logged in");
  }

  const { method, pubkey } = state.session;
  const { nip44, pure, nip46 } = await loadNostrLibs();

  if (method === "ephemeral") {
    // Use stored ephemeral secret
    const stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
    if (!stored) throw new Error("No secret key found");
    const secret = hexToBytes(stored);
    const conversationKey = nip44.v2.utils.getConversationKey(secret, pubkey);
    return nip44.v2.encrypt(content, conversationKey);
  }

  if (method === "extension") {
    // Use NIP-07 extension's nip44 methods
    if (!window.nostr?.nip44?.encrypt) {
      throw new Error("Browser extension does not support NIP-44 encryption");
    }
    return await window.nostr.nip44.encrypt(pubkey, content);
  }

  if (method === "secret") {
    // Use PIN-decrypted secret from memory
    let secret = getMemorySecret();
    if (!secret && hasEncryptedSecret()) {
      secret = await promptPinForDecrypt();
    }
    if (!secret) throw new Error("No secret key available");
    const conversationKey = nip44.v2.utils.getConversationKey(secret, pubkey);
    return nip44.v2.encrypt(content, conversationKey);
  }

  if (method === "bunker") {
    // Use bunker signer for NIP-44
    let signer = getMemoryBunkerSigner();

    if (!signer && hasEncryptedBunker()) {
      // Reconnect to bunker
      const bunkerUri = await promptPinForBunkerDecrypt();
      if (!bunkerUri) throw new Error("No bunker connection available");

      const pointer = await nip46.parseBunkerInput(bunkerUri);
      if (!pointer) throw new Error("Unable to parse bunker details");

      const clientSecret = pure.generateSecretKey();
      signer = new nip46.BunkerSigner(clientSecret, pointer);
      await signer.connect();

      setMemoryBunkerSigner(signer);
      setMemoryBunkerUri(bunkerUri);
    }

    if (!signer) throw new Error("No bunker connection available");

    // BunkerSigner should have nip44 encrypt method
    if (typeof signer.encrypt === "function") {
      return await signer.encrypt(pubkey, content);
    }

    throw new Error("Bunker does not support NIP-44 encryption");
  }

  throw new Error("Unsupported login method for encryption");
}

// Decrypt entry content using the user's secret key
export async function decryptEntry(ciphertext) {
  if (!state.session) {
    throw new Error("Not logged in");
  }

  const { method, pubkey } = state.session;
  const { nip44, pure, nip46 } = await loadNostrLibs();

  if (method === "ephemeral") {
    // Use stored ephemeral secret
    const stored = localStorage.getItem(EPHEMERAL_SECRET_KEY);
    if (!stored) throw new Error("No secret key found");
    const secret = hexToBytes(stored);
    const conversationKey = nip44.v2.utils.getConversationKey(secret, pubkey);
    return nip44.v2.decrypt(ciphertext, conversationKey);
  }

  if (method === "extension") {
    // Use NIP-07 extension's nip44 methods
    if (!window.nostr?.nip44?.decrypt) {
      throw new Error("Browser extension does not support NIP-44 decryption");
    }
    return await window.nostr.nip44.decrypt(pubkey, ciphertext);
  }

  if (method === "secret") {
    // Use PIN-decrypted secret from memory
    let secret = getMemorySecret();
    if (!secret && hasEncryptedSecret()) {
      secret = await promptPinForDecrypt();
    }
    if (!secret) throw new Error("No secret key available");
    const conversationKey = nip44.v2.utils.getConversationKey(secret, pubkey);
    return nip44.v2.decrypt(ciphertext, conversationKey);
  }

  if (method === "bunker") {
    // Use bunker signer for NIP-44
    let signer = getMemoryBunkerSigner();

    if (!signer && hasEncryptedBunker()) {
      // Reconnect to bunker
      const bunkerUri = await promptPinForBunkerDecrypt();
      if (!bunkerUri) throw new Error("No bunker connection available");

      const pointer = await nip46.parseBunkerInput(bunkerUri);
      if (!pointer) throw new Error("Unable to parse bunker details");

      const clientSecret = pure.generateSecretKey();
      signer = new nip46.BunkerSigner(clientSecret, pointer);
      await signer.connect();

      setMemoryBunkerSigner(signer);
      setMemoryBunkerUri(bunkerUri);
    }

    if (!signer) throw new Error("No bunker connection available");

    // BunkerSigner should have nip44 decrypt method
    if (typeof signer.decrypt === "function") {
      return await signer.decrypt(pubkey, ciphertext);
    }

    throw new Error("Bunker does not support NIP-44 decryption");
  }

  throw new Error("Unsupported login method for decryption");
}

// Decrypt multiple entries in one go (for efficiency)
export async function decryptEntries(entries) {
  const results = [];
  for (const entry of entries) {
    try {
      const content = await decryptEntry(entry.encrypted_content);
      results.push({
        ...entry,
        content,
        decrypted: true,
      });
    } catch (err) {
      console.error(`Failed to decrypt entry ${entry.id}:`, err);
      results.push({
        ...entry,
        content: "[Unable to decrypt]",
        decrypted: false,
        error: err.message,
      });
    }
  }
  return results;
}

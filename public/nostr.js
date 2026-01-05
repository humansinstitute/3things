import { APP_TAG, LOGIN_KIND } from "./constants.js";

export const loadNostrLibs = async () => {
  if (!window.__NOSTR_LIBS__) {
    const base = "https://esm.sh/nostr-tools@2.7.2";
    window.__NOSTR_LIBS__ = {
      pure: await import(`${base}/pure`),
      nip19: await import(`${base}/nip19`),
      nip44: await import(`${base}/nip44`),
      nip46: await import(`${base}/nip46`),
    };
  }
  return window.__NOSTR_LIBS__;
};

export const loadApplesauceLibs = async () => {
  if (!window.__APPLESAUCE_LIBS__) {
    window.__APPLESAUCE_LIBS__ = {
      relay: await import("https://esm.sh/applesauce-relay@4.0.0?bundle"),
      helpers: await import("https://esm.sh/applesauce-core@4.0.0/helpers?bundle"),
      rxjs: await import("https://esm.sh/rxjs@7.8.1?bundle"),
    };
  }
  return window.__APPLESAUCE_LIBS__;
};

export const loadQRCodeLib = async () => {
  if (!window.__QRCODE_LIB__) {
    const mod = await import("https://esm.sh/qrcode@1.5.3");
    window.__QRCODE_LIB__ = mod.default || mod;
  }
  return window.__QRCODE_LIB__;
};

export const hexToBytes = (hex) => {
  if (!hex) return new Uint8Array();
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
};

export const bytesToHex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

export const decodeNsec = (nip19, input) => {
  try {
    const decoded = nip19.decode(input);
    if (decoded.type !== "nsec" || !decoded.data) throw new Error("Not a valid nsec key.");
    if (decoded.data instanceof Uint8Array) return decoded.data;
    if (Array.isArray(decoded.data)) return new Uint8Array(decoded.data);
    throw new Error("Unable to read nsec payload.");
  } catch (_err) {
    throw new Error("Invalid nsec key.");
  }
};

export const buildUnsignedEvent = (method) => ({
  kind: LOGIN_KIND,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["app", APP_TAG],
    ["method", method],
  ],
  content: "Authenticate with Three Things",
});

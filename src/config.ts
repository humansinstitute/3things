import { join } from "path";

export const PORT = Number(Bun.env.PORT ?? 3000);
export const SESSION_COOKIE = "nostr_session";
export const LOGIN_EVENT_KIND = 27235;
export const LOGIN_MAX_AGE_SECONDS = 60;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const COOKIE_SECURE = Bun.env.NODE_ENV === "production";
export const APP_NAME = "Three Things";
export const APP_TAG = "three-things";
export const PUBLIC_DIR = join(import.meta.dir, "../public");

export const STATIC_FILES = new Map<string, string>([
  ["/favicon.ico", "favicon.png"],
  ["/favicon.png", "favicon.png"],
  ["/apple-touch-icon.png", "apple-touch-icon.png"],
  ["/icon-192.png", "icon-192.png"],
  ["/icon-512.png", "icon-512.png"],
  ["/manifest.webmanifest", "manifest.webmanifest"],
  ["/app.js", "app.js"],
  ["/app.css", "app.css"],
]);

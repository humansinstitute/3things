// Service Worker for Three Things
// Caches external libraries and app assets

const CACHE_NAME = "three-things-v3";

// External libraries to cache
const EXTERNAL_LIBS = [
  "https://esm.sh/nostr-tools@2.7.2/pure",
  "https://esm.sh/nostr-tools@2.7.2/nip19",
  "https://esm.sh/nostr-tools@2.7.2/nip44",
  "https://esm.sh/nostr-tools@2.7.2/nip46",
  "https://esm.sh/applesauce-relay@4.0.0?bundle",
  "https://esm.sh/applesauce-core@4.0.0/helpers?bundle",
  "https://esm.sh/rxjs@7.8.1?bundle",
  "https://esm.sh/qrcode@1.5.3",
];

// Local assets to cache
const LOCAL_ASSETS = [
  "/",
  "/app.js",
  "/app.css",
  "/auth.js",
  "/avatar.js",
  "/constants.js",
  "/crypto.js",
  "/dom.js",
  "/entries.js",
  "/entryCrypto.js",
  "/nostr.js",
  "/pin.js",
  "/state.js",
  "/ui.js",
  "/favicon.png",
  "/manifest.webmanifest",
];

// Install - cache all assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache local assets
      await cache.addAll(LOCAL_ASSETS);

      // Cache external libs (don't fail install if one fails)
      for (const url of EXTERNAL_LIBS) {
        try {
          const response = await fetch(url, { mode: "cors" });
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (err) {
          console.warn("Failed to cache:", url, err);
        }
      }
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  // Take control immediately
  self.clients.claim();
});

// Known image hosts for profile pictures
const IMAGE_HOSTS = [
  "robohash.org",
  "nostr.build",
  "imgur.com",
  "i.imgur.com",
  "cdn.nostr.build",
  "image.nostr.build",
  "void.cat",
  "pbs.twimg.com",
  "avatars.githubusercontent.com",
  "pfp.nostr.build",
  "primal.b-cdn.net",
  "media.tenor.com",
  "i.nostr.build",
];

// Check if URL is an image
function isImageRequest(url) {
  const ext = url.pathname.split(".").pop()?.toLowerCase();
  const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "ico"];
  return imageExts.includes(ext) || IMAGE_HOSTS.some((host) => url.hostname.includes(host));
}

// Fetch - serve from cache, fallback to network
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // For API calls (entries, auth), always use network
  if (url.pathname.startsWith("/entries") || url.pathname.startsWith("/auth")) {
    return;
  }

  // For esm.sh requests, use cache-first strategy
  if (url.hostname === "esm.sh") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          // Cache successful responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // For profile images, use cache-first with network fallback
  if (isImageRequest(url) && url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request, { mode: "cors", credentials: "omit" })
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {
            // Return placeholder on network failure
            return new Response("", { status: 404 });
          });
      })
    );
    return;
  }

  // For local assets, use stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
        return cached || fetchPromise;
      })
    );
  }
});

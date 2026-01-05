import { initAuth } from "./auth.js";
import { initAvatarMenu } from "./avatar.js";
import { initEntries } from "./entries.js";
import { initPullRefresh } from "./pullRefresh.js";
import { initUI } from "./ui.js";

// Register service worker for caching
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("Service worker registration failed:", err);
  });
}

initAvatarMenu();
initUI();
initAuth();
initPullRefresh();

// Initialize entries after auth has a chance to set up session
window.addEventListener("load", () => {
  initEntries();
});

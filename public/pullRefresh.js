// Pull-to-refresh for mobile web app

const THRESHOLD = 80; // Pixels to pull before refresh triggers
const MAX_PULL = 120; // Maximum pull distance

let startY = 0;
let currentY = 0;
let isPulling = false;
let indicator = null;

export function initPullRefresh() {
  // Only enable on touch devices
  if (!("ontouchstart" in window)) return;

  createIndicator();

  document.addEventListener("touchstart", handleTouchStart, { passive: true });
  document.addEventListener("touchmove", handleTouchMove, { passive: false });
  document.addEventListener("touchend", handleTouchEnd, { passive: true });
}

function createIndicator() {
  indicator = document.createElement("div");
  indicator.className = "pull-refresh-indicator";
  indicator.innerHTML = `
    <div class="pull-refresh-content">
      <span class="pull-refresh-arrow">↓</span>
      <span class="pull-refresh-text">Pull to refresh</span>
    </div>
  `;
  document.body.prepend(indicator);
}

function handleTouchStart(e) {
  // Only activate when at top of page
  if (window.scrollY > 0) return;

  startY = e.touches[0].clientY;
  isPulling = true;
}

function handleTouchMove(e) {
  if (!isPulling || window.scrollY > 0) {
    isPulling = false;
    return;
  }

  currentY = e.touches[0].clientY;
  const pullDistance = Math.min(currentY - startY, MAX_PULL);

  if (pullDistance > 0) {
    // Prevent default scroll when pulling down from top
    e.preventDefault();

    // Update indicator
    updateIndicator(pullDistance);
  }
}

function handleTouchEnd() {
  if (!isPulling) return;

  const pullDistance = currentY - startY;

  if (pullDistance >= THRESHOLD) {
    // Trigger refresh
    triggerRefresh();
  } else {
    // Reset indicator
    resetIndicator();
  }

  isPulling = false;
  startY = 0;
  currentY = 0;
}

function updateIndicator(distance) {
  if (!indicator) return;

  const progress = Math.min(distance / THRESHOLD, 1);
  const opacity = Math.min(progress, 1);
  const translateY = Math.min(distance * 0.5, MAX_PULL * 0.5);

  indicator.style.opacity = opacity;
  indicator.style.transform = `translateY(${translateY}px)`;

  const text = indicator.querySelector(".pull-refresh-text");
  const arrow = indicator.querySelector(".pull-refresh-arrow");

  if (distance >= THRESHOLD) {
    text.textContent = "Release to refresh";
    arrow.style.transform = "rotate(180deg)";
    indicator.classList.add("ready");
  } else {
    text.textContent = "Pull to refresh";
    arrow.style.transform = "rotate(0deg)";
    indicator.classList.remove("ready");
  }
}

function resetIndicator() {
  if (!indicator) return;

  indicator.style.opacity = "0";
  indicator.style.transform = "translateY(0)";
  indicator.classList.remove("ready", "refreshing");
}

function triggerRefresh() {
  if (!indicator) return;

  indicator.classList.add("refreshing");
  indicator.querySelector(".pull-refresh-text").textContent = "Refreshing...";
  indicator.querySelector(".pull-refresh-arrow").innerHTML = "↻";

  // Small delay for visual feedback, then reload
  setTimeout(() => {
    window.location.reload();
  }, 300);
}

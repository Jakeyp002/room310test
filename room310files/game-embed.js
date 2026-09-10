(() => {
  "use strict";

  const frame = document.querySelector("#apex-trails-frame");
  const button = document.querySelector("[data-game-fullscreen]");
  const status = document.querySelector("[data-fullscreen-status]");
  const unavailable = document.querySelector("[data-game-state]");
  if (!frame || !button) return;

  const checkAvailability = async () => {
    try {
      await fetch(frame.src, { mode: "no-cors", cache: "no-store", referrerPolicy: "no-referrer" });
    } catch {
      if (unavailable) unavailable.hidden = false;
      frame.hidden = true;
      button.hidden = true;
      if (status) status.textContent = "Apex Trails is currently unavailable.";
    }
  };

  if (!document.fullscreenEnabled || typeof frame.requestFullscreen !== "function") {
    button.hidden = true;
    if (status) status.textContent = "Fullscreen is unavailable in this browser.";
    return;
  }

  const updateState = () => {
    const active = document.fullscreenElement === frame;
    button.textContent = active ? "Exit fullscreen" : "Fullscreen";
    button.setAttribute("aria-label", active ? "Exit Apex Trails fullscreen" : "Open Apex Trails fullscreen");
    button.setAttribute("aria-pressed", String(active));
    if (status) status.textContent = active ? "Apex Trails is fullscreen." : "Apex Trails left fullscreen.";
  };

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (document.fullscreenElement === frame) await document.exitFullscreen();
      else await frame.requestFullscreen({ navigationUI: "hide" });
    } catch {
      if (status) status.textContent = "Fullscreen could not be opened. Try the separate game link instead.";
    } finally {
      button.disabled = false;
      updateState();
    }
  });

  document.addEventListener("fullscreenchange", updateState);
  updateState();
  checkAvailability();
})();

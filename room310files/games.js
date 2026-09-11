(() => {
  "use strict";

  const container = document.querySelector(".games-list");
  const heroCopy = document.querySelector(".games-hero > p");
  if (!container) return;

  const isApexTrailsUrl = (value) => {
    try {
      const url = new URL(value);
      const apexHost =
        url.hostname === "apextrails.lol" || url.hostname.endsWith(".apextrails.lol");
      const studioHost =
        url.hostname === "oneshotstudios.org" || url.hostname.endsWith(".oneshotstudios.org");
      return url.protocol === "https:" && (apexHost || studioHost);
    } catch {
      return false;
    }
  };

  const makeCard = (game, index) => {
    const article = document.createElement("article");
    article.className = "public-game-card";

    const visual = document.createElement("div");
    visual.className = "public-game-cover";
    if (game.thumbnailUrl) {
      const image = document.createElement("img");
      image.src = game.thumbnailUrl;
      image.alt = `Cover artwork for ${game.title}`;
      image.loading = "lazy";
      visual.append(image);
    } else {
      const number = document.createElement("span");
      number.textContent = String(index + 1).padStart(2, "0");
      visual.append(number);
    }

    const body = document.createElement("div");
    body.className = "public-game-body";
    const meta = document.createElement("div");
    meta.className = "public-game-meta";
    const year = document.createElement("span");
    year.textContent = game.year;
    const type = document.createElement("span");
    type.textContent = game.hostType === "external" ? "External game" : "Room310 player";
    meta.append(year, type);

    const title = document.createElement("h2");
    title.textContent = game.title;
    const description = document.createElement("p");
    description.textContent = game.description;
    const link = document.createElement("a");
    if (
      game.hostType === "external" &&
      isApexTrailsUrl(game.externalUrl || game.playUrl)
    ) {
      link.href = "#apex-trails";
      link.textContent = "Play in Room310 →";
      link.addEventListener("click", () => {
        document.querySelector("#apex-trails-frame")?.focus({ preventScroll: true });
      });
    } else {
      link.href = game.playUrl;
      if (game.hostType === "external") {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      link.textContent = "Play game →";
    }

    body.append(meta, title, description, link);
    article.append(visual, body);
    return article;
  };

  fetch("/api/games", { credentials: "same-origin" })
    .then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Games could not be loaded.");
      if (!result.games.length) return;

      container.classList.add("games-list-populated");
      container.replaceChildren(...result.games.map(makeCard));
      heroCopy.textContent = "Play Apex Trails and browser games selected for Room310.";
    })
    .catch(() => {
      container.dataset.loadError = "true";
    });
})();

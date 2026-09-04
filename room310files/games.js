(() => {
  "use strict";
  const container = document.querySelector(".games-list");
  const heroCopy = document.querySelector(".games-hero > p");
  if (!container) return;

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
    type.textContent = game.hostType === "hosted" ? "Room310 hosted" : "External game";
    meta.append(year, type);
    const title = document.createElement("h2");
    title.textContent = game.title;
    const description = document.createElement("p");
    description.textContent = game.description;
    const link = document.createElement("a");
    link.href = game.playUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Play game →";
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
      heroCopy.textContent = "Play browser games and interactive projects created for Room310.";
    })
    .catch(() => {
      container.dataset.loadError = "true";
    });
})();

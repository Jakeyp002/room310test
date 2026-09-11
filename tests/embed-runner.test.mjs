import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSandboxedGameFrame, createSandboxedUrlFrame, embeddedDocument, GAME_SANDBOX } from "../client-src/embed-runner.js";

function fakeDocument() {
  return {
    body: { dataset: {} },
    createElement(tagName) {
      const attributes = new Map();
      return {
        tagName: tagName.toUpperCase(),
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.get(name) ?? null; },
        addEventListener() {}
      };
    }
  };
}

test("embedded snippets receive a full-size isolated document wrapper", () => {
  const document = embeddedDocument('<iframe src="https://example.com/game"></iframe>');
  assert.match(document, /^<!doctype html>/);
  assert.match(document, /body>iframe:only-child/);
});

test("full HTML game documents are preserved", () => {
  const source = "<!doctype html><html><body><canvas></canvas></body></html>";
  assert.equal(embeddedDocument(source), source);
});

test("the local admin preview uses srcdoc without a same-origin message receiver", async () => {
  const source = await readFile(new URL("../room310files/admin-games.js", import.meta.url), "utf8");
  assert.match(source, /frame\.srcdoc = embeddedDocument\(html\)/);
  assert.doesNotMatch(source, /embed-bootstrap|postMessage|innerHTML/);
});

test("malicious HTML is data in an opaque-origin sandbox, not parent DOM", () => {
  const document = fakeDocument();
  const malicious = '<script>parent.document.body.dataset.pwned="yes";top.location="https://evil.test"</script><div id="pwned">game</div>';
  const frame = createSandboxedGameFrame(document, malicious, "Malicious test game");

  assert.equal(frame.getAttribute("sandbox"), GAME_SANDBOX);
  assert.match(GAME_SANDBOX, /allow-scripts/);
  for (const forbidden of ["allow-same-origin", "allow-top-navigation", "allow-popups", "allow-downloads"]) {
    assert.doesNotMatch(GAME_SANDBOX, new RegExp(forbidden));
  }
  assert.equal(frame.getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(frame.innerHTML, undefined);
  assert.match(frame.srcdoc, /parent\.document/);
  assert.equal(document.body.dataset.pwned, undefined);
});

test("linked and hosted game URLs use the same opaque-origin sandbox", () => {
  const frame = createSandboxedUrlFrame(fakeDocument(), "https://example.com/game", "Linked game");
  assert.equal(frame.src, "https://example.com/game");
  assert.equal(frame.getAttribute("sandbox"), GAME_SANDBOX);
  assert.doesNotMatch(frame.getAttribute("sandbox"), /allow-same-origin|allow-top-navigation|allow-popups/);
  assert.equal(frame.getAttribute("referrerpolicy"), "no-referrer");
});

test("the production player supports HTML, hosted ZIP, and opt-in linked games", async () => {
  const source = await readFile(new URL("../client-src/game-player.js", import.meta.url), "utf8");
  assert.match(source, /game\.hostType === "embed"/);
  assert.match(source, /game\.hostType === "hosted"/);
  assert.match(source, /\/game-assets\/\$\{encodeURIComponent\(game\.slug\)\}/);
  assert.match(source, /showExternalChoice\(game\)/);
  assert.match(source, /playExternal\.href = game\.externalUrl/);
  assert.match(source, /openExperimental\.addEventListener\("click", openExternalExperiment\)/);
  const choiceBranch = source.match(/else if \(game\.hostType === "external"\) \{([\s\S]*?)\n  \} else \{/);
  assert.ok(choiceBranch);
  assert.doesNotMatch(choiceBranch[1], /renderSandboxedUrl/);
});

test("linked games present the reliable launch and experimental Room310 choices", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../room310files/game.html", import.meta.url), "utf8"),
    readFile(new URL("../room310files/style.css", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="game-play-external"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>Play Game/);
  assert.match(html, /id="game-open-experimental"[^>]*>Open in Room310 \(experimental\)<\/button>/);
  assert.match(html, /does not work for every online game/);
  assert.match(css, /\.game-play-external[^}]*background: var\(--accent\)/s);
  assert.match(css, /\.game-open-experimental[^}]*background: #b72f25/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.game-external-actions \{ grid-template-columns: 1fr;/);
});

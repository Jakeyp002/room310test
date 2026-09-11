import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSandboxedGameFrame, embeddedDocument, GAME_SANDBOX } from "../client-src/embed-runner.js";

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

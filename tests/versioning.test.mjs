import assert from "node:assert/strict";
import test from "node:test";
import { classifyUpdate, nextVersion, parseVersion, synchronizeHtmlVersion } from "../scripts/versioning.mjs";

test("Room310 uses strict three-part versions", () => {
  assert.deepEqual(parseVersion("0.5.0"), [0, 5, 0]);
  assert.throws(() => parseVersion("0.5"), /Invalid 0\.0\.0 version/);
  assert.throws(() => parseVersion("v0.5.0"), /Invalid 0\.0\.0 version/);
});

test("patches and features receive appropriate pre-1.0 increments", () => {
  assert.equal(nextVersion("0.5.0", "patch"), "0.5.1");
  assert.equal(nextVersion("0.5.7", "minor"), "0.6.0");
  assert.equal(classifyUpdate("Fix the mobile menu spacing"), "patch");
  assert.equal(classifyUpdate("Add a new lesson system"), "minor");
});

test("automatic bumps cannot cross the 1.0.0 boundary", () => {
  assert.throws(() => nextVersion("0.99.4", "minor"), /explicit 1\.0\.0 release/);
  assert.throws(() => nextVersion("0.5.0", "major"), /Unknown update significance/);
});

test("the visible version marker updates when it is the last attribute", () => {
  const html = '<span class="version" data-room310-version>v0.5.0</span><script src="/app.js?v=0.5.0"></script>';
  assert.equal(
    synchronizeHtmlVersion(html, "0.7.0"),
    '<span class="version" data-room310-version>v0.7.0</span><script src="/app.js?v=0.7.0"></script>'
  );
});

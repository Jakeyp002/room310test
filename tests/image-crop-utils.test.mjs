import test from "node:test";
import assert from "node:assert/strict";
import { clamp, coverTransform } from "../client-src/image-crop-utils.js";

test("clamp keeps crop controls inside their allowed range", () => {
  assert.equal(clamp(-2, 0, 10), 0);
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(4, 0, 10), 4);
});

test("coverTransform fills a 16:9 canvas without empty edges", () => {
  const portrait = coverTransform(800, 1200, 1280, 720, 1, 9999, -9999);
  assert.ok(portrait.width >= 1280);
  assert.ok(portrait.height >= 720);
  assert.ok(portrait.x <= 0);
  assert.ok(portrait.y <= 0);
  assert.ok(portrait.x + portrait.width >= 1280);
  assert.ok(portrait.y + portrait.height >= 720);
});

test("coverTransform constrains zoom and drag offsets", () => {
  const crop = coverTransform(1600, 900, 1280, 720, 10, 100000, 100000);
  assert.equal(crop.zoom, 3);
  assert.equal(crop.offsetX, (crop.width - 1280) / 2);
  assert.equal(crop.offsetY, (crop.height - 720) / 2);
});

"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const context = vm.createContext({});
for (const file of ["settings.js", "config.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8"), context);
}
const { serialize, parse } = context.YTWindowConfig;
const plain = value => JSON.parse(JSON.stringify(value));
const backup = settings => JSON.stringify({
  format: "youtube-faux-fullscreen", schemaVersion: 1, settings
});

test("export/import round trip preserves all current settings", () => {
  const { controls, behaviors } = context.YTWindowSettings;
  const settings = {
    toolbarVisibility: Object.fromEntries(controls.map(({ id }, i) => [id, i % 2 === 0])),
    playerPreferences: {
      ...Object.fromEntries(behaviors.map(({ id }, i) => [id, i % 2 === 0])),
      theme: "dark"
    }
  };
  assert.deepEqual(plain(parse(serialize(settings))), settings);
});

test("older files fill missing options with defaults and ignore unknown keys", () => {
  const imported = parse(backup({
    toolbarVisibility: { play: false, futureControl: false },
    playerPreferences: { futurePreference: "anything" }
  }));
  assert.equal(imported.toolbarVisibility.play, false);
  assert.equal(imported.toolbarVisibility.headerSearch, true);
  assert.equal(imported.playerPreferences.autoEnter, true);
  assert.equal(imported.playerPreferences.keepToolbarVisible, false);
  assert.equal(imported.playerPreferences.theme, "system");
  assert.equal(Object.hasOwn(imported.toolbarVisibility, "futureControl"), false);
  assert.equal(Object.hasOwn(imported.playerPreferences, "futurePreference"), false);
  assert.deepEqual(plain(parse(backup({}))), plain(parse(serialize({}))));
});

test("legacy ratings migrate and an explicit combined preference wins", () => {
  assert.equal(parse(backup({ toolbarVisibility: { like: false, dislike: true } })).toolbarVisibility.ratings, false);
  assert.equal(parse(backup({ toolbarVisibility: { like: false, ratings: true } })).toolbarVisibility.ratings, true);
});

test("reject invalid documents, sections, versions and known setting types", () => {
  for (const text of [
    "{", "null", "[]", "{}",
    JSON.stringify({ format: "another-app", schemaVersion: 1, settings: {} }),
    JSON.stringify({ format: "youtube-faux-fullscreen", schemaVersion: 2, settings: {} }),
    backup({ toolbarVisibility: [] }),
    backup({ playerPreferences: null }),
    backup({ toolbarVisibility: { play: "false" } }),
    backup({ playerPreferences: { autoEnter: 0 } }),
    backup({ playerPreferences: { theme: "invalid" } })
  ]) assert.throws(() => parse(text));
});

test("accept a UTF-8 BOM and discard unknown metadata", () => {
  const text = backup({ toolbarVisibility: { play: false }, otherSection: {} });
  assert.equal(parse("\uFEFF" + text).toolbarVisibility.play, false);
  assert.equal(Object.hasOwn(parse(text), "otherSection"), false);
});

"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const root = path.join(__dirname, "..");

test("toolbar action opens options in both background environments", () => {
  for (const worker of [false, true]) {
    let listener;
    let opened = 0;
    const api = {
      action: { onClicked: { addListener: fn => { listener = fn; } } },
      runtime: { openOptionsPage: () => { opened++; } }
    };
    const context = vm.createContext(worker ? { chrome: api } : { browser: api, chrome: {} });
    const run = file => vm.runInContext(fs.readFileSync(path.join(root, "src", file), "utf8"), context);
    if (worker) context.importScripts = run;
    else run("extension-api.js");
    run("background.js");
    listener();
    assert.equal(opened, 1);
  }
});

test("both builds include their entry points and identical shared source", () => {
  execFileSync(process.execPath, [path.join(root, "scripts/build.mjs")]);
  const manifests = [];
  for (const browser of ["chromium", "firefox"]) {
    const output = path.join(root, "dist", browser);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
    manifests.push(manifest);
    const entries = [
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
      manifest.options_ui.page,
      ...(manifest.background.scripts || [manifest.background.service_worker]),
      ...manifest.content_scripts.flatMap(script => [...script.js, ...script.css])
    ];
    const html = fs.readFileSync(path.join(output, manifest.options_ui.page), "utf8");
    entries.push(...Array.from(html.matchAll(/(?:src|href)="([^"#]+)"/g), match => match[1]));
    for (const entry of new Set(entries)) {
      assert.deepEqual(fs.readFileSync(path.join(output, entry)), fs.readFileSync(path.join(root, "src", entry)), entry);
    }
    assert.equal(manifest.content_scripts[0].js[0], "extension-api.js");
    assert.ok(html.indexOf('src="extension-api.js"') < html.indexOf('src="options.js"'));
    assert.equal(fs.existsSync(path.join(output, "tests")), false);
  }
  assert.equal(manifests[0].version, manifests[1].version);
  assert.equal(manifests[0].background.scripts, undefined);
  assert.equal(manifests[1].background.service_worker, undefined);
  assert.equal(manifests[0].browser_specific_settings, undefined);
  assert.ok(manifests[1].browser_specific_settings.gecko.id);
});

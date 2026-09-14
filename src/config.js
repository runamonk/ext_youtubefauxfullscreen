"use strict";

globalThis.YTWindowConfig = (() => {
  const { controls, key, normalize, behaviors, preferencesKey, normalizePreferences } = YTWindowSettings;
  const format = "youtube-faux-fullscreen";
  const schemaVersion = 1;
  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

  function serialize(settings) {
    return JSON.stringify({
      format,
      schemaVersion,
      settings: {
        [key]: normalize(settings[key]),
        [preferencesKey]: normalizePreferences(settings[preferencesKey])
      }
    }, null, 2) + "\n";
  }

  function parse(text) {
    let data;
    try {
      data = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error("This file is not valid JSON.");
    }
    if (!isObject(data) || data.format !== format || !isObject(data.settings)) {
      throw new Error("Choose a Faux fullscreen configuration export.");
    }
    if (data.schemaVersion !== schemaVersion) {
      throw new Error("This configuration format is not supported. Try updating the extension.");
    }
    for (const section of [key, preferencesKey]) {
      if (Object.hasOwn(data.settings, section) && !isObject(data.settings[section])) {
        throw new Error("Invalid settings section: " + section + ".");
      }
    }
    const visibility = data.settings[key] || {};
    const preferences = data.settings[preferencesKey] || {};
    for (const id of [...controls.map(control => control.id), "like", "dislike"]) {
      if (Object.hasOwn(visibility, id) && typeof visibility[id] !== "boolean") {
        throw new Error("The " + id + " visibility setting must be true or false.");
      }
    }
    for (const { id } of behaviors) {
      if (Object.hasOwn(preferences, id) && typeof preferences[id] !== "boolean") {
        throw new Error("The " + id + " setting must be true or false.");
      }
    }
    if (Object.hasOwn(preferences, "theme") && !["system", "light", "dark"].includes(preferences.theme)) {
      throw new Error("Theme must be system, light or dark.");
    }
    // Rebuild from known keys. Missing options use current defaults, never
    // the importing device's previous settings; unknown options are ignored.
    return { [key]: normalize(visibility), [preferencesKey]: normalizePreferences(preferences) };
  }
  return { serialize, parse };
})();

"use strict";

const { controls, key, normalize, behaviors, preferencesKey, normalizePreferences } = YTWindowSettings;
const form = document.getElementById("options");
const fieldsets = [...form.querySelectorAll("fieldset")];
const reset = document.getElementById("reset");
const status = document.getElementById("status");
const theme = document.getElementById("theme");
const inputs = new Map();
let saved = { [key]: normalize(), [preferencesKey]: normalizePreferences() };
let saving = false;
const creatorList = document.getElementById("creator-list");
const removeCreators = document.getElementById("remove-creators");
let creators = {};
const creatorChanges = new Set();

function renderCreators() {
  const selected = new Set([...creatorList.selectedOptions].map(option => option.value));
  creatorList.replaceChildren();
  for (const [storageKey, name] of Object.entries(creators).sort((a, b) => a[1].localeCompare(b[1]))) {
    const option = document.createElement("option");
    option.value = storageKey;
    option.textContent = name;
    option.selected = selected.has(storageKey);
    creatorList.append(option);
  }
  removeCreators.disabled = saving || !creatorList.selectedOptions.length;
}
creatorList.addEventListener("change", renderCreators);
removeCreators.addEventListener("click", async () => {
  if (saving) return;
  const keys = [...creatorList.selectedOptions].map(option => option.value);
  saving = true;
  disable(true);
  try {
    await YTWindowExtension.storage.local.remove(keys);
    for (const storageKey of keys) delete creators[storageKey];
    status.textContent = "Selected creators removed.";
  } catch {
    status.textContent = "Could not remove creators. Please try again.";
  } finally {
    saving = false;
    disable(false);
    renderCreators();
  }
});
const changedDuringLoad = new Set();

for (const [items, container, storageKey] of [
  [controls.filter(({ group }) => group === "header"), "header-controls", key],
  [controls.filter(({ group }) => group === "player"), "player-controls", key],
  [behaviors, "behaviors", preferencesKey]
]) {
  for (const { id, label: text } of items) {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = text;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = id;
    input.setAttribute("role", "switch");
    inputs.set(id, { input, storageKey });
    label.append(caption, input);
    document.getElementById(container).append(label);
  }
}

function render() {
  for (const [id, { input, storageKey }] of inputs) input.checked = saved[storageKey][id];
  theme.value = saved[preferencesKey].theme;
  document.documentElement.dataset.theme = theme.value;
}
function disable(value) {
  for (const fieldset of fieldsets) fieldset.disabled = value;
  reset.disabled = value;
  removeCreators.disabled = value || !creatorList.selectedOptions.length;
}
async function save(update, successMessage = "Saved.") {
  saving = true;
  disable(true);
  status.textContent = "Saving...";
  try {
    await YTWindowExtension.storage.local.set(update);
    Object.assign(saved, update);
    status.textContent = successMessage;
  } catch {
    status.textContent = "Could not save. Please try again.";
  } finally {
    render();
    saving = false;
    disable(false);
  }
}
form.addEventListener("submit", event => event.preventDefault());
form.addEventListener("change", event => {
  if (saving) return;
  if (event.target === theme) {
    document.documentElement.dataset.theme = theme.value;
    save({ [preferencesKey]: { ...saved[preferencesKey], theme: theme.value } });
    return;
  }
  const entry = inputs.get(event.target.name);
  if (entry) save({
    [entry.storageKey]: { ...saved[entry.storageKey], [event.target.name]: event.target.checked }
  });
});
reset.addEventListener("click", () => {
  if (!saving) save({ [key]: normalize(), [preferencesKey]: normalizePreferences() });
});
YTWindowExtension.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [storageKey, change] of Object.entries(changes)) {
    if (!storageKey.startsWith("autoLikeCreator:")) continue;
    creatorChanges.add(storageKey);
    if (typeof change.newValue === "string") creators[storageKey] = change.newValue;
    else delete creators[storageKey];
  }
  renderCreators();
  for (const [storageKey, normalizeValue] of [[key, normalize], [preferencesKey, normalizePreferences]]) {
    if (!changes[storageKey]) continue;
    changedDuringLoad.add(storageKey);
    saved[storageKey] = normalizeValue(changes[storageKey].newValue);
  }
  render();
});
(async () => {
  try {
    const result = await YTWindowExtension.storage.local.get(null);
    if (!changedDuringLoad.has(key)) saved[key] = normalize(result[key]);
    if (!changedDuringLoad.has(preferencesKey)) saved[preferencesKey] = normalizePreferences(result[preferencesKey]);
    for (const [storageKey, name] of Object.entries(result)) {
      if (storageKey.startsWith("autoLikeCreator:") && typeof name === "string" && !creatorChanges.has(storageKey)) creators[storageKey] = name;
    }
    renderCreators();
    render();
    disable(false);
    status.textContent = "Ready. All changes save automatically.";
  } catch {
    status.textContent = "Could not load settings. Reload this page to try again.";
  }
})();

const configFile = document.getElementById("config-file");
document.getElementById("export-config").addEventListener("click", () => {
  if (saving) return;
  try {
    const blob = new Blob([YTWindowConfig.serialize(saved)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "faux-fullscreen-config-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "JSON export download started.";
  } catch {
    status.textContent = "Could not export settings. Please try again.";
  }
});
document.getElementById("import-config").addEventListener("click", () => {
  if (!saving) configFile.click();
});
configFile.addEventListener("change", async () => {
  const file = configFile.files[0];
  configFile.value = "";
  if (!file || saving) return;
  saving = true;
  disable(true);
  status.textContent = "Reading configuration...";
  try {
    if (file.size > 1024 * 1024) throw new Error("Choose a configuration file smaller than 1 MB.");
    const update = YTWindowConfig.parse(await file.text());
    await save(update, "Configuration imported. Open players updated.");
  } catch (error) {
    status.textContent = "Import failed: " + error.message;
  } finally {
    saving = false;
    disable(false);
  }
});

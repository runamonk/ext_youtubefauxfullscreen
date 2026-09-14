import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const readJson = async name => JSON.parse(await readFile(path.join(root, "manifests", name + ".json"), "utf8"));
const base = await readJson("base");
const dist = path.join(root, "dist");
await mkdir(dist, { recursive: true });
if (await realpath(dist) !== dist) throw new Error("dist must be a real directory inside the project");

for (const browser of ["chromium", "firefox"]) {
  // Overrides replace whole top-level keys, so background declarations stay separate.
  const manifest = { ...base, ...await readJson(browser) };
  const output = path.resolve(dist, browser);
  if (path.dirname(output) !== dist) throw new Error("Output outside dist");
  try {
    if (await realpath(output) !== output) throw new Error("Output must not be a symlink");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rm(output, { recursive: true, force: true });
  await cp(path.join(root, "src"), output, { recursive: true });
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Built ${browser} ${manifest.version} in dist/${browser}`);
}

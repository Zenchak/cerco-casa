import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const homesPath = path.join(root, "homes.json");
const dir = path.join(root, "homes");

const base = JSON.parse(fs.readFileSync(homesPath, "utf8"));
if (!Array.isArray(base)) throw new Error("homes.json must be an array");

if (!fs.existsSync(dir)) {
  console.log("homes/ does not exist; nothing to merge.");
  process.exit(0);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
const byId = new Map(base.map(h => [h.id, h]));
const urlKey = u => String(u || "").trim().replace(/\/$/, "").toLowerCase();
const byUrl = new Map(
  base
    .filter(h => urlKey(h.url))
    .map(h => [urlKey(h.url), h])
);

let added = 0;
let updated = 0;
let skippedDuplicateUrls = 0;

for (const file of files) {
  const item = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  if (!item || Array.isArray(item) || !item.id) {
    throw new Error(`Invalid home file: ${file}`);
  }

  const key = urlKey(item.url);
  const duplicateUrl = key ? byUrl.get(key) : null;

  // Some legacy entries already exist in homes.json under an older/stable id.
  // Do not fail the whole workflow in that case: keep the stable catalog entry
  // and skip the modular duplicate so new homes can still be merged.
  if (duplicateUrl && duplicateUrl.id !== item.id) {
    console.warn(
      `Skipping duplicate URL in ${file}: already used by ${duplicateUrl.id}`
    );
    skippedDuplicateUrls++;
    continue;
  }

  const existed = byId.has(item.id);
  byId.set(item.id, item);
  if (key) byUrl.set(key, item);

  if (existed) updated++;
  else added++;
}

const merged = [...byId.values()];
fs.writeFileSync(homesPath, JSON.stringify(merged, null, 2) + "\n");

console.log(
  `Merged ${files.length} modular homes; total ${merged.length}; added ${added}; updated ${updated}; skipped duplicate URLs ${skippedDuplicateUrls}.`
);

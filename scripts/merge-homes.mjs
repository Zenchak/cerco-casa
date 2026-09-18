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
const urlKey = u => String(u || "").trim().replace(/\/$/, "");

for (const file of files) {
  const item = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  if (!item || Array.isArray(item) || !item.id) throw new Error(`Invalid home file: ${file}`);
  const duplicateUrl = [...byId.values()].find(h => urlKey(h.url) && urlKey(h.url) === urlKey(item.url) && h.id !== item.id);
  if (duplicateUrl) throw new Error(`Duplicate URL in ${file}: already used by ${duplicateUrl.id}`);
  byId.set(item.id, item);
}

const merged = [...byId.values()];
fs.writeFileSync(homesPath, JSON.stringify(merged, null, 2) + "\n");
console.log(`Merged ${files.length} modular homes; total ${merged.length}.`);

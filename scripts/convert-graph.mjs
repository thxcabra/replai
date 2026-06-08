// Converte node_metrics.csv (formato MOIC) pro indice JSON usado pela extensao:
// { handle_lowercase: { isv, inferred_layer, is_poi } }
//
// Uso: node scripts/convert-graph.mjs <input.csv> <output.json>

import { readFileSync, writeFileSync } from "node:fs";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error("uso: node convert-graph.mjs <input.csv> <output.json>");
  process.exit(1);
}

let text = readFileSync(inFile, "utf8");
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
const lines = text.split(/\r?\n/);

const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
const cols = {
  handle: header.indexOf("handle"),
  isv: header.indexOf("isv"),
  inferred_layer: header.indexOf("inferred_layer"),
  is_poi: header.indexOf("is_poi"),
};
const missing = Object.entries(cols)
  .filter(([, i]) => i === -1)
  .map(([k]) => k);
if (missing.length) {
  console.error("colunas faltando:", missing.join(", "));
  process.exit(1);
}

const out = {};
let count = 0;
let skipped = 0;
for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const fields = parseCsvLine(line);
  let handle = (fields[cols.handle] || "").trim().toLowerCase();
  if (handle.startsWith("@")) handle = handle.slice(1);
  if (!handle) {
    skipped++;
    continue;
  }
  const isv = Number(fields[cols.isv]);
  const layer = Number(fields[cols.inferred_layer]);
  const poi = Number(fields[cols.is_poi]);
  if (!Number.isFinite(isv) || !Number.isFinite(layer)) {
    skipped++;
    continue;
  }
  out[handle] = {
    isv: Math.round(isv * 100) / 100,
    inferred_layer: layer,
    is_poi: poi === 1 ? 1 : 0,
  };
  count++;
}

writeFileSync(outFile, JSON.stringify(out));
const pois = Object.values(out).filter((v) => v.is_poi === 1).length;
const layer1 = Object.values(out).filter((v) => v.inferred_layer === 1).length;
const layer2 = Object.values(out).filter((v) => v.inferred_layer === 2).length;
const layer3 = Object.values(out).filter((v) => v.inferred_layer === 3).length;
console.log(`convertido: ${count} handles | ${skipped} ignorados`);
console.log(`POIs: ${pois} | L1: ${layer1} | L2: ${layer2} | L3: ${layer3}`);

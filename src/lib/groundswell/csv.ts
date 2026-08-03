// V5 — CSV parser minimalista. Groundswell exporta CSV RFC-4180 (aspas duplas
// pra fields com virgula/newline, aspas duplicadas pra escape). Nao usamos
// biblioteca externa pra manter o bundle enxuto — 60 linhas resolve.
//
// Nao lida com casos exoticos (BOM em cada linha, delimitadores custom, etc).
// Se algum bundle Groundswell no futuro sair de RFC-4180, refactor aqui.

/** Remove BOM (UTF-8: EF BB BF => ﻿) do inicio do arquivo. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse RFC-4180 CSV. Retorna array de records (Object com key=header).
 * `casts` opcional: mapa de coluna -> conversor. `undefined`/`""` viram
 * undefined (null-ish) automaticamente.
 */
export function parseCsv<T = Record<string, unknown>>(
  raw: string,
  casts: Partial<Record<string, (v: string) => unknown>> = {}
): T[] {
  const text = stripBom(raw);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      // vamos tratar \r\n ou \r sozinho
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (text[i + 1] === "\n") i += 2;
      else i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // ultimo field/row (arquivo sem trailing newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const out: T[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    // pula linhas totalmente vazias
    if (cells.length === 1 && cells[0] === "") continue;
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      const val = cells[c] ?? "";
      if (val === "") {
        obj[key] = undefined;
        continue;
      }
      const cast = casts[key];
      obj[key] = cast ? cast(val) : val;
    }
    out.push(obj as T);
  }
  return out;
}

// Casts comuns pros CSVs Groundswell
export const casts = {
  int: (v: string): number | undefined => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  },
  float: (v: string): number | undefined => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  },
  bool01: (v: string): boolean => v === "1" || v.toLowerCase() === "true",
  iso: (v: string): string | undefined => {
    if (!v) return undefined;
    // aceita "2026-07-02 22:54" ou ISO — normaliza pra ISO
    if (v.includes("T")) return v;
    const iso = v.replace(" ", "T");
    return iso.includes("Z") || /[+-]\d{2}/.test(iso) ? iso : iso + "Z";
  },
  jsonSafe: (v: string): unknown => {
    if (!v) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  },
};

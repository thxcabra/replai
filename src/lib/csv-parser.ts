import type { Graph, GraphEntry } from "./types";

export interface CsvParseResult {
  data: Graph;
  rowCount: number;
  errors: string[]; // erros nao-fatais (linhas individuais que foram puladas)
}

export class CsvFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvFatalError";
  }
}

// Parse do CSV de node_metrics. Cabecalho obrigatorio: handle, isv,
// inferred_layer, is_poi (ordem nao importa, case-insensitive). Suporta:
// - BOM no inicio do arquivo
// - CRLF ou LF
// - Aspas em campos (CSV padrao, escape com "")
// - Handle com @ (normaliza removendo)
// - Linhas vazias (ignoradas)
//
// Lanca CsvFatalError se o cabecalho nao bate. Linhas com numeros invalidos
// vao pra `errors` mas o parse continua.
export function parseGraphCsv(text: string): CsvParseResult {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const lines = text.split(/\r?\n/);
  // pega a primeira linha nao-vazia como cabecalho
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new CsvFatalError("CSV vazio.");
  }

  const header = parseCsvLine(lines[headerIdx]).map((h) =>
    h.trim().toLowerCase()
  );
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
    throw new CsvFatalError(
      `Colunas faltando no cabecalho: ${missing.join(", ")}. ` +
        `Esperado: handle, isv, inferred_layer, is_poi.`
    );
  }

  const data: Graph = {};
  const errors: string[] = [];
  let rowCount = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    rowCount++;

    const fields = parseCsvLine(line);
    if (fields.length < header.length) {
      errors.push(`linha ${i + 1}: colunas insuficientes`);
      continue;
    }

    let handle = fields[cols.handle].trim().toLowerCase();
    if (handle.startsWith("@")) handle = handle.slice(1);
    if (!handle) {
      errors.push(`linha ${i + 1}: handle vazio`);
      continue;
    }

    const isv = Number(fields[cols.isv]);
    const inferred_layer = Number(fields[cols.inferred_layer]);
    const is_poi_num = Number(fields[cols.is_poi]);

    if (
      !Number.isFinite(isv) ||
      !Number.isFinite(inferred_layer) ||
      !Number.isFinite(is_poi_num)
    ) {
      errors.push(`linha ${i + 1} (@${handle}): valor numerico invalido`);
      continue;
    }

    const entry: GraphEntry = {
      isv,
      inferred_layer,
      is_poi: is_poi_num === 1 ? 1 : 0,
    };
    data[handle] = entry;
  }

  if (Object.keys(data).length === 0) {
    throw new CsvFatalError(
      "Nenhuma linha valida encontrada no CSV. Cheque o formato."
    );
  }

  return { data, rowCount, errors };
}

// Parser de uma linha de CSV. Suporta campos entre aspas com virgulas
// embutidas e aspas escapadas via "" (padrao CSV).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

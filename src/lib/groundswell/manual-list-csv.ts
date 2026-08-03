import { parseCsv } from "./csv.ts";
import type { ManualListRow } from "./storage";

export const MANUAL_LIST_CSV_HEADERS = [
  "empresa",
  "cargo",
  "nome",
  "linkedin",
] as const;

const COLUMN_ALIASES = {
  current_company: ["empresa", "company", "current_company"],
  headline: ["cargo", "headline", "title"],
  name: ["nome", "name", "full_name", "fullname"],
  linkedin_url: ["linkedin", "linkedin_url", "url", "link", "profile"],
} satisfies Partial<Record<keyof ManualListRow, string[]>>;

export interface ManualListCsvResult {
  rows: ManualListRow[];
  errors: string[];
}

export function parseManualListCsv(text: string): ManualListCsvResult {
  const parsed = parseCsv<Record<string, unknown>>(text);
  if (parsed.length === 0) {
    return { rows: [], errors: ["CSV vazio ou sem linhas de dados."] };
  }

  const availableHeaders = new Set(
    Object.keys(parsed[0]).map(normalizeHeader)
  );
  const missingHeaders = Object.entries(COLUMN_ALIASES)
    .filter(([, aliases]) => !aliases.some((key) => availableHeaders.has(key)))
    .map(([field]) => MANUAL_LIST_CSV_HEADERS[
      Object.keys(COLUMN_ALIASES).indexOf(field)
    ]);

  if (missingHeaders.length > 0) {
    return {
      rows: [],
      errors: [`Colunas faltando: ${missingHeaders.join(", ")}.`],
    };
  }

  const rows: ManualListRow[] = [];
  const errors: string[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];
    const name = pickColumn(raw, COLUMN_ALIASES.name);
    const linkedinUrl = normalizeLinkedInProfileUrl(
      pickColumn(raw, COLUMN_ALIASES.linkedin_url)
    );

    if (!name || !linkedinUrl) {
      errors.push(
        `linha ${i + 2}: ${!name ? "Nome ausente" : "LinkedIn inválido ou ausente"}`
      );
      continue;
    }
    if (seenUrls.has(linkedinUrl)) {
      errors.push(`linha ${i + 2}: LinkedIn duplicado`);
      continue;
    }
    seenUrls.add(linkedinUrl);

    rows.push({
      name,
      linkedin_url: linkedinUrl,
      headline: pickColumn(raw, COLUMN_ALIASES.headline),
      current_company: pickColumn(raw, COLUMN_ALIASES.current_company),
    });
  }

  return { rows, errors };
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function pickColumn(
  row: Record<string, unknown>,
  aliases: string[]
): string | undefined {
  for (const [header, rawValue] of Object.entries(row)) {
    if (!aliases.includes(normalizeHeader(header))) continue;
    const value = typeof rawValue === "string" ? rawValue.trim() : "";
    if (value) return value;
  }
  return undefined;
}

function normalizeLinkedInProfileUrl(
  raw: string | undefined
): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(
      /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`
    );
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return undefined;
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
    return match
      ? `https://www.linkedin.com/in/${match[1]}`
      : undefined;
  } catch {
    return undefined;
  }
}

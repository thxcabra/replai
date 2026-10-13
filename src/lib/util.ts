const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

// A TwitterAPI.io devolve createdAt no formato classico do Twitter
// ("Tue May 27 14:32:00 +0000 2026") ou as vezes ISO. Tenta os dois.
export function parseTweetDate(value: string | undefined): number | null {
  if (!value) return null;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;

  const m = value.match(
    /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})\s+(\d{4})$/
  );
  if (!m) return null;
  const [, mon, day, hh, mm, ss, tz, year] = m;
  const month = MONTHS[mon];
  if (month === undefined) return null;
  const offsetMin =
    (tz[0] === "-" ? -1 : 1) *
    (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3, 5), 10));
  const utc = Date.UTC(
    parseInt(year, 10),
    month,
    parseInt(day, 10),
    parseInt(hh, 10),
    parseInt(mm, 10),
    parseInt(ss, 10)
  );
  return utc - offsetMin * 60 * 1000;
}

// Conta palavras "reais", ignorando URLs e mentions puras.
export function meaningfulWordCount(text: string): number {
  return text
    .split(/\s+/)
    .filter((tok) => {
      const t = tok.trim();
      if (!t) return false;
      if (/^https?:\/\//i.test(t)) return false; // URL
      if (/^@\w+$/.test(t)) return false; // mention pura
      if (/^#\w+$/.test(t)) return false; // hashtag pura
      return true;
    }).length;
}

// Texto sem URLs e mentions, pra checar se sobra conteudo proprio.
export function textWithoutNoise(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/@\w+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

export function isPureRetweetText(text: string): boolean {
  return /^RT\s+@\w+/i.test(text.trim());
}

// Dominio de login permitido. Valor sem ponto ("acme") aceita qualquer TLD
// (@acme.com, @acme.com.br); valor com ponto ("acme.com") exige match exato.
// Mesma regra nas Edge Functions (apify-fetch, notion-watchtower).
export function isEmailDomainAllowed(email: string, allowed: string): boolean {
  const at = email.lastIndexOf("@");
  const domain = allowed.trim().toLowerCase().replace(/^@/, "");
  if (at < 0 || !domain) return false;
  const host = email.slice(at + 1).trim().toLowerCase();
  return domain.includes(".") ? host === domain : host.startsWith(`${domain}.`);
}

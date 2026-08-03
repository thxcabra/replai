// V5 — Client-side rate limiter pra proteger conta LinkedIn de ban.
//
// LinkedIn detecta padroes de bot: velocidade constante, muito rapido,
// horario fora do padrao humano. Este modulo bloqueia geracao de reply
// (nao o post — analista posta manual, mas limitar quantas geramos por hora
// previne o analista de FICAR TENTADO a postar em cascata).
//
// State vive em chrome.storage.local por user (nao workspace) — cada
// analista tem seu proprio limite.
//
// Ver LINKEDIN_COMPLIANCE em constants.ts pros limites.

import { LINKEDIN_COMPLIANCE } from "../../constants";

const STORAGE_KEY = "v5_linkedin_rate_state";

interface RateState {
  generations_last_hour: number[];        // timestamps ms
  posts_today: number[];                   // timestamps ms
  last_generation_at: number;
  next_generation_allowed_at: number;      // pra jitter
}

async function readState(): Promise<RateState> {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  const s = r[STORAGE_KEY] as RateState | undefined;
  if (!s) {
    return {
      generations_last_hour: [],
      posts_today: [],
      last_generation_at: 0,
      next_generation_allowed_at: 0,
    };
  }
  return s;
}

async function writeState(s: RateState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: s });
}

/** Purga entradas fora da janela relevante */
function prune(state: RateState): RateState {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  return {
    generations_last_hour: state.generations_last_hour.filter(
      (t) => t >= oneHourAgo
    ),
    posts_today: state.posts_today.filter((t) => t >= oneDayAgo),
    last_generation_at: state.last_generation_at,
    next_generation_allowed_at: state.next_generation_allowed_at,
  };
}

export interface RateCheckResult {
  allowed: boolean;
  reason?: "hourly_cap" | "cooldown" | "daily_cap" | "off_hours";
  wait_ms?: number;
  remaining_generations_hour?: number;
  remaining_posts_day?: number;
}

/**
 * Consulta se o user pode gerar reply agora — NAO consome o slot.
 * Chamar `recordGeneration()` depois se realmente gerar.
 */
export async function checkCanGenerate(
  maxPostsPerDay: number = LINKEDIN_COMPLIANCE.MAX_POSTS_PER_DAY_DEFAULT
): Promise<RateCheckResult> {
  const now = Date.now();
  const state = prune(await readState());

  // 1. horario ativo (evita 00-06 detectar bot)
  const hour = new Date(now).getHours();
  const { start, end } = LINKEDIN_COMPLIANCE.ACTIVE_HOURS_LOCAL;
  if (hour < start || hour > end) {
    return {
      allowed: false,
      reason: "off_hours",
      wait_ms: computeWaitToStartHour(now, start),
    };
  }

  // 2. hourly cap
  if (
    state.generations_last_hour.length >=
    LINKEDIN_COMPLIANCE.MAX_GENERATIONS_PER_HOUR
  ) {
    const oldest = Math.min(...state.generations_last_hour);
    const wait = oldest + 60 * 60 * 1000 - now;
    return {
      allowed: false,
      reason: "hourly_cap",
      wait_ms: wait,
      remaining_generations_hour: 0,
    };
  }

  // 3. daily post cap (soft — usa config do user)
  const effectiveDailyCap = Math.min(
    maxPostsPerDay,
    LINKEDIN_COMPLIANCE.MAX_POSTS_PER_DAY_HARD
  );
  if (state.posts_today.length >= effectiveDailyCap) {
    return {
      allowed: false,
      reason: "daily_cap",
      remaining_posts_day: 0,
    };
  }

  // 4. cooldown jitter — evita ritmo de bot
  if (now < state.next_generation_allowed_at) {
    return {
      allowed: false,
      reason: "cooldown",
      wait_ms: state.next_generation_allowed_at - now,
    };
  }

  return {
    allowed: true,
    remaining_generations_hour:
      LINKEDIN_COMPLIANCE.MAX_GENERATIONS_PER_HOUR -
      state.generations_last_hour.length,
    remaining_posts_day: effectiveDailyCap - state.posts_today.length,
  };
}

/** Registra uma geracao — chamar apos LLM devolver a reply */
export async function recordGeneration(): Promise<void> {
  const now = Date.now();
  const state = prune(await readState());
  state.generations_last_hour.push(now);
  state.last_generation_at = now;
  // jitter 60-180s aleatorio pra proxima
  const range =
    LINKEDIN_COMPLIANCE.GENERATION_COOLDOWN_MAX_S -
    LINKEDIN_COMPLIANCE.GENERATION_COOLDOWN_MIN_S;
  const cooldownS =
    LINKEDIN_COMPLIANCE.GENERATION_COOLDOWN_MIN_S +
    Math.random() * range;
  state.next_generation_allowed_at = now + cooldownS * 1000;
  await writeState(state);
}

/** Registra um post — chamar quando analista confirma no PostConfirmDialog */
export async function recordPost(): Promise<void> {
  const now = Date.now();
  const state = prune(await readState());
  state.posts_today.push(now);
  await writeState(state);
}

function computeWaitToStartHour(nowMs: number, targetHour: number): number {
  const d = new Date(nowMs);
  d.setHours(targetHour, 0, 0, 0);
  if (d.getTime() < nowMs) d.setDate(d.getDate() + 1);
  return d.getTime() - nowMs;
}

/** Reset — util em Settings pra "esqueceu contador" ou testes */
export async function resetRateLimiter(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/** Formatador amigavel do wait_ms */
export function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.ceil(m / 60);
  return `${h}h`;
}

import { LIMITS, TTLS } from "./constants";
import { GEMINI_API_KEY } from "./keys";

// V4.1.8 — Gemini image gen com FALLBACK em multiplos modelos.
//
// O modelo "gemini-2.5-flash-image-preview" usado em V4.1.6 retornava 404
// pra alguns analistas (depende de region + tier). V4.1.8 tenta uma lista
// de modelos em ordem ate algum responder. Tambem loga o erro especifico
// no console pra facilitar diagnose.
//
// Ordem de tentativas (mais barato/free → premium):
//   1. gemini-2.5-flash-image      (free tier, mais novo)
//   2. gemini-2.0-flash-preview-image-generation  (free tier, estavel)
//   3. imagen-3.0-fast-generate-001 (paid, fallback final)

const CANDIDATE_MODELS: { id: string; isImagen: boolean }[] = [
  { id: "gemini-2.5-flash-image", isImagen: false },
  { id: "gemini-2.0-flash-preview-image-generation", isImagen: false },
  // Imagen e o endpoint :predict, diferente do :generateContent. Marcado pra
  // tratar separado abaixo. So tenta se Gemini falhar (e provavelmente cobra).
  { id: "imagen-3.0-fast-generate-001", isImagen: true },
];

// V4.1.14 (WR-15): valida modelId antes de interpolar em URL. Hoje todos
// vem da const acima, mas se algum dia houver override por config, preserva
// contra path traversal / URL injection (`../`, `?`, `&`).
function safeModelId(id: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(`gemini-image: modelId invalido: ${id}`);
  }
  return id;
}

export interface GeneratedImage {
  dataUrl: string;
  mimeType: string;
  prompt: string;
  modelUsed: string;
}

interface InlineMedia {
  mimeType?: string;
  mime_type?: string;
  data?: string;
}

interface GeminiImageResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: InlineMedia;
        inline_data?: InlineMedia;
      }>;
    };
    finishReason?: string;
  }>;
  error?: { message?: string; status?: string };
  promptFeedback?: { blockReason?: string };
}

interface ImagenPredictResponse {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    mimeType?: string;
    raiFilteredReason?: string;
  }>;
  error?: { message?: string };
}

// V4.1.14 (CR-03 + WR-08): LRU cache com TTL.
// - cap em LIMITS.MAX_IMAGE_CACHE (20 entries) — evita leak no service worker
// - TTL positivo: 24h (sucessos)
// - TTL negativo: 5min (falhas) — permite retry rapido apos quota/network blip
// - Map preserva insertion order — eviction = drop oldest key
interface CachedImageEntry {
  image: GeneratedImage | null;
  expiresAt: number;
}
const cache = new Map<string, CachedImageEntry>();

function cacheGet(key: string): GeneratedImage | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.image;
}

function cacheSet(key: string, image: GeneratedImage | null): void {
  const ttl = image ? TTLS.ANALYSIS_MS : TTLS.NEGATIVE_MS;
  cache.set(key, { image, expiresAt: Date.now() + ttl });
  // LRU eviction: se passou do cap, drop oldest (primeiro inserido)
  if (cache.size > LIMITS.MAX_IMAGE_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

function buildImagePrompt(topic: string): string {
  return `A clean, editorial-style photograph illustrating: ${topic.trim()}.
Style: realistic, journalistic, magazine-quality lighting. NO text, NO logos,
NO captions, NO watermarks. Wide composition (16:9). Professional photography
aesthetic. Avoid AI-art tropes (no glowing neon, no purple gradients, no
abstract surreal elements). Single focused subject with good depth of field.`;
}

async function callGeminiModel(
  modelId: string,
  prompt: string,
  signal?: AbortSignal
): Promise<{ image: GeneratedImage | null; error?: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${safeModelId(modelId)}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
      temperature: 0.7,
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      return { image: null, error: "aborted" };
    }
    return { image: null, error: `network: ${(e as Error).message}` };
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as GeminiImageResponse;
      if (j.error?.message) detail += ` ${j.error.message}`;
    } catch {
      /* ignora */
    }
    return { image: null, error: detail };
  }

  let data: GeminiImageResponse;
  try {
    data = await res.json();
  } catch {
    return { image: null, error: "json parse failed" };
  }

  if (data.promptFeedback?.blockReason) {
    return {
      image: null,
      error: `blocked: ${data.promptFeedback.blockReason}`,
    };
  }

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    const mimeType = inline?.mimeType ?? inline?.mime_type;
    const b64 = inline?.data;
    if (mimeType?.startsWith("image/") && b64) {
      return {
        image: {
          dataUrl: `data:${mimeType};base64,${b64}`,
          mimeType,
          prompt,
          modelUsed: modelId,
        },
      };
    }
  }
  const finish = data.candidates?.[0]?.finishReason ?? "";
  return {
    image: null,
    error: finish
      ? `no image part (finish=${finish})`
      : "no image part in response",
  };
}

async function callImagenModel(
  modelId: string,
  prompt: string,
  signal?: AbortSignal
): Promise<{ image: GeneratedImage | null; error?: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${safeModelId(modelId)}:predict`;
  const body = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: "16:9" },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      return { image: null, error: "aborted" };
    }
    return { image: null, error: `network: ${(e as Error).message}` };
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as ImagenPredictResponse;
      if (j.error?.message) detail += ` ${j.error.message}`;
    } catch {
      /* ignora */
    }
    return { image: null, error: detail };
  }

  let data: ImagenPredictResponse;
  try {
    data = await res.json();
  } catch {
    return { image: null, error: "json parse failed" };
  }
  const pred = data.predictions?.[0];
  if (pred?.raiFilteredReason) {
    return { image: null, error: `rai filter: ${pred.raiFilteredReason}` };
  }
  if (pred?.bytesBase64Encoded) {
    const mt = pred.mimeType ?? "image/png";
    return {
      image: {
        dataUrl: `data:${mt};base64,${pred.bytesBase64Encoded}`,
        mimeType: mt,
        prompt,
        modelUsed: modelId,
      },
    };
  }
  return { image: null, error: "no prediction in response" };
}

export async function generatePostImage(
  topic: string,
  options?: { signal?: AbortSignal }
): Promise<GeneratedImage | null> {
  const trimmed = topic.trim();
  if (!trimmed) return null;
  if (!GEMINI_API_KEY) {
    console.warn("[gemini-image] sem GEMINI_API_KEY — image gen pulado");
    return null;
  }

  const cached = cacheGet(trimmed);
  if (cached !== undefined) return cached;

  const prompt = buildImagePrompt(trimmed);
  const errors: string[] = [];

  for (const model of CANDIDATE_MODELS) {
    const result = model.isImagen
      ? await callImagenModel(model.id, prompt, options?.signal)
      : await callGeminiModel(model.id, prompt, options?.signal);
    if (result.image) {
      cacheSet(trimmed, result.image);
      console.info(`[gemini-image] ✓ ${model.id} for "${trimmed.slice(0, 50)}"`);
      return result.image;
    }
    errors.push(`${model.id}: ${result.error}`);
    // se foi abort, nao tenta os outros
    if (result.error === "aborted") break;
  }

  console.warn(
    `[gemini-image] todos os modelos falharam para "${trimmed.slice(0, 50)}":`,
    errors
  );
  cacheSet(trimmed, null);
  return null;
}

export function clearGeminiImageCache(): void {
  cache.clear();
}

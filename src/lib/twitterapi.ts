import { ApiError, friendlyHttpMessage } from "./errors";
import type { RawTweet, TwitterListResponse } from "./types";
import { parseTweetDate } from "./util";

// Em producao (extensao) chama a API direto. No preview do browser, o Vite
// injeta VITE_TWITTERAPI_BASE apontando pro proxy local (contorna CORS).
const BASE = import.meta.env.VITE_TWITTERAPI_BASE ?? "https://api.twitterapi.io";

async function fetchPage(
  listId: string,
  apiKey: string,
  cursor?: string
): Promise<TwitterListResponse> {
  let url = `${BASE}/twitter/list/tweets_timeline?listId=${encodeURIComponent(
    listId
  )}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": apiKey },
    });
  } catch {
    throw new ApiError(
      "twitter",
      "Falha de rede ao chamar a TwitterAPI. Cheque sua conexao."
    );
  }

  if (!response.ok) {
    throw new ApiError(
      "twitter",
      friendlyHttpMessage("twitter", response.status),
      response.status
    );
  }

  try {
    return (await response.json()) as TwitterListResponse;
  } catch {
    throw new ApiError("twitter", "Resposta da TwitterAPI nao e JSON valido.");
  }
}

// Puxa tweets da Lista (ordenados do mais recente pro mais antigo), paginando
// ate cruzar a janela de tempo (sinceMs) ou bater o teto de paginas.
// Como vem newest-first, paramos assim que a pagina ja contem tweets mais
// velhos que a janela: isso evita pagar por historico irrelevante.
export async function fetchListTweets(
  listId: string,
  apiKey: string,
  sinceMs: number,
  maxPages = 4
): Promise<RawTweet[]> {
  const all: RawTweet[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const data = await fetchPage(listId, apiKey, cursor);

    if (!Array.isArray(data.tweets)) {
      if (data.message) throw new ApiError("twitter", `TwitterAPI: ${data.message}`);
      break;
    }
    if (data.tweets.length === 0) break;

    all.push(...data.tweets);

    // o ultimo da pagina e o mais antigo; se ja passou da janela, paramos
    const oldest = data.tweets[data.tweets.length - 1];
    const oldestMs = parseTweetDate(oldest?.createdAt);
    if (oldestMs !== null && oldestMs < sinceMs) break;

    if (!data.has_next_page || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return all;
}

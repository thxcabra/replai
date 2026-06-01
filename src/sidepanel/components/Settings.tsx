import { useState } from "preact/hooks";
import { MODEL_OPTIONS, PROVIDER_OPTIONS, type Config } from "../../lib/types";
import { graphSize } from "../../lib/graph";

interface Props {
  config: Config;
  onSave: (config: Config) => void;
  onClose: (() => void) | null;
}

// Aceita ID puro ou URL tipo x.com/i/lists/12345 e extrai o ID.
function extractListId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/lists\/(\d+)/);
  return m ? m[1] : trimmed;
}

export function Settings({ config, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Config>({ ...config });

  function set<K extends keyof Config>(key: K, value: Config[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleLang(lang: string) {
    setDraft((d) => ({
      ...d,
      langs: d.langs.includes(lang)
        ? d.langs.filter((l) => l !== lang)
        : [...d.langs, lang],
    }));
  }

  function handleSave() {
    onSave({ ...draft, listId: extractListId(draft.listId) });
  }

  const labelCls = "mb-1 block text-xs font-medium text-zinc-400";
  const inputCls =
    "w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-600";

  return (
    <div class="flex flex-col gap-4 p-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-zinc-200">Configuracoes</h2>
        {onClose && (
          <button
            onClick={onClose}
            class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            fechar
          </button>
        )}
      </div>

      <div>
        <label class={labelCls}>ID da Lista do X (ou URL)</label>
        <input
          type="text"
          class={inputCls}
          placeholder="x.com/i/lists/1234567890"
          value={draft.listId}
          onInput={(e) => set("listId", (e.target as HTMLInputElement).value)}
        />
      </div>

      <div>
        <label class={labelCls}>Provider de LLM</label>
        <div class="flex flex-col gap-1.5 text-sm text-zinc-200">
          {PROVIDER_OPTIONS.map((p) => (
            <label key={p.id} class="flex items-center gap-2">
              <input
                type="radio"
                name="llm_provider"
                checked={draft.llm_provider === p.id}
                onChange={() => set("llm_provider", p.id)}
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label class={labelCls}>
          Chave Gemini API{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            class="text-sky-400 hover:underline"
          >
            (obter aqui)
          </a>
        </label>
        <input
          type="password"
          class={inputCls}
          placeholder="vazio = usa a chave do .env"
          value={draft.gemini_api_key}
          onInput={(e) =>
            set("gemini_api_key", (e.target as HTMLInputElement).value)
          }
        />
      </div>

      <div>
        <label class={labelCls}>
          Chave Anthropic API{" "}
          <a
            href="https://console.anthropic.com"
            target="_blank"
            rel="noreferrer"
            class="text-sky-400 hover:underline"
          >
            (obter aqui)
          </a>
        </label>
        <input
          type="password"
          class={inputCls}
          placeholder="vazio = usa a chave do .env (se houver)"
          value={draft.anthropic_api_key}
          onInput={(e) =>
            set("anthropic_api_key", (e.target as HTMLInputElement).value)
          }
        />
      </div>

      {draft.llm_provider === "anthropic" && (
        <div>
          <label class={labelCls}>Modelo Anthropic</label>
          <select
            class={inputCls}
            value={draft.model}
            onChange={(e) => set("model", (e.target as HTMLSelectElement).value)}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label class={labelCls}>Janela de tempo (horas)</label>
        <input
          type="number"
          min={1}
          max={168}
          class={inputCls}
          value={draft.timeWindowHours}
          onInput={(e) =>
            set(
              "timeWindowHours",
              Math.max(1, Number((e.target as HTMLInputElement).value) || 10)
            )
          }
        />
      </div>

      <div>
        <label class={labelCls}>Teto de tweets por chamada (batch)</label>
        <input
          type="number"
          min={1}
          max={40}
          class={inputCls}
          value={draft.maxBatch}
          onInput={(e) =>
            set(
              "maxBatch",
              Math.max(1, Number((e.target as HTMLInputElement).value) || 25)
            )
          }
        />
      </div>

      <div>
        <label class={labelCls}>Idiomas aceitos</label>
        <div class="flex gap-3 text-sm text-zinc-200">
          {[
            { id: "en", label: "ingles" },
            { id: "pt", label: "portugues" },
            { id: "", label: "indefinido" },
          ].map((l) => (
            <label key={l.id} class="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={draft.langs.includes(l.id)}
                onChange={() => toggleLang(l.id)}
              />
              {l.label}
            </label>
          ))}
        </div>
      </div>

      <label class="flex items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={draft.includeUnmapped}
          onChange={(e) =>
            set("includeUnmapped", (e.target as HTMLInputElement).checked)
          }
        />
        Incluir handles fora do grafo ({graphSize()} mapeados)
      </label>

      <label class="flex items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={draft.dryRun}
          onChange={(e) =>
            set("dryRun", (e.target as HTMLInputElement).checked)
          }
        />
        Dry-run (so filtra os posts, nao chama o LLM)
      </label>

      <button
        onClick={handleSave}
        class="rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
      >
        salvar
      </button>
    </div>
  );
}

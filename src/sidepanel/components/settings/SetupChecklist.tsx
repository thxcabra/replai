// V5.0.4 — Checklist de setup no topo de Settings.
//
// Aparece pra user novo (ou qualquer workspace com config incompleta) e vai
// riscando itens conforme sao preenchidos. Cada item clicavel faz scroll +
// expand no bloco correspondente — user nao precisa procurar onde salvar
// cada peca.
//
// Some quando todos os items estao completos E user salvou pelo menos 1x.
//
// UX principios (skill /ui-ux-pro-max):
// - Progressive disclosure com feedback (checkmark visivel)
// - Scroll-to-section preserva state (nao empurra pra outra tela)
// - Contador N/M no header pra dimensionamento cognitivo

import type { JSX } from "preact";
import type { ProfileRow } from "../../../lib/supabase-types";
import type { Config } from "../../../lib/types";

interface Props {
  config: Config;
  profile: ProfileRow | null;
}

interface ChecklistItem {
  key: string;
  label: string;
  hint: string;
  sectionId: string;
  done: boolean;
}

function buildItems(config: Config, profile: ProfileRow | null): ChecklistItem[] {
  const hasVoice = (config.voice ?? "").trim().length >= 50;
  const providerKey =
    config.llm_provider === "anthropic"
      ? (profile?.anthropic_api_key ?? "").trim()
      : (profile?.gemini_api_key ?? "").trim();
  const hasProviderKey = providerKey.length > 0;

  const hasXList = Boolean(
    (config.lists && config.lists.some((l) => l.listId?.trim())) ||
      config.listId?.trim()
  );
  const hasLinkedInBundle = Boolean(config.linkedin_bundle_id);
  const hasChannelActive = hasXList || hasLinkedInBundle;

  const hasTwitterKey = Boolean((profile?.twitterapi_key ?? "").trim());
  const hasLinkedInReady =
    config.linkedin_enabled
      ? (config.linkedin_voice ?? "").trim().length >= 50 && hasLinkedInBundle
      : true; // se canal off, considera OK

  return [
    {
      key: "voice",
      label: "Voz do workspace",
      hint: "≥ 50 chars descrevendo tom, temas, referencias",
      sectionId: "settings-voice",
      done: hasVoice,
    },
    {
      key: "llm",
      label: "Provider LLM + chaves",
      hint: `Chave ${config.llm_provider} preenchida no bloco de essenciais`,
      sectionId: "settings-keys",
      done: hasProviderKey,
    },
    {
      key: "channel",
      label: "Pelo menos 1 canal configurado",
      hint: "X: 1 Lista OU LinkedIn: bundle Groundswell carregado",
      sectionId: hasXList
        ? "settings-sources-x"
        : hasLinkedInBundle
        ? "settings-linkedin"
        : "settings-sources-x",
      done: hasChannelActive,
    },
    {
      key: "twitterapi",
      label: "Chave TwitterAPI (se canal X ativo)",
      hint: hasXList
        ? "Necessaria pra fetch da Lista"
        : "Nao obrigatoria enquanto canal X estiver off",
      sectionId: "settings-keys",
      done: !hasXList || hasTwitterKey,
    },
    {
      key: "linkedin",
      label: "Voz LinkedIn (se canal LinkedIn ativo)",
      hint: config.linkedin_enabled
        ? "≥ 50 chars especificos pro tom LinkedIn — separada da voz do workspace"
        : "Nao obrigatoria enquanto canal LinkedIn estiver off",
      sectionId: "settings-linkedin",
      done: hasLinkedInReady,
    },
  ];
}

function handleClick(sectionId: string) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  // Se e <details>, abre. Depois scroll pro topo do bloco.
  if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function SetupChecklist({ config, profile }: Props): JSX.Element | null {
  const items = buildItems(config, profile);
  const done = items.filter((i) => i.done).length;
  const total = items.length;

  // Some quando user esta 100% e profile ja marcado como setup_complete.
  if (done === total && profile?.setup_complete) return null;

  return (
    <section
      aria-label="Checklist de setup"
      class="rounded-lg border border-sky-500/40 bg-sky-950/20 px-3 py-2.5"
    >
      <div class="mb-2 flex items-baseline justify-between gap-2">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
          setup
        </div>
        <div class="font-mono text-[10px] tabular-nums text-sky-400">
          {done} <span class="text-sky-600">de</span> {total} completo
        </div>
      </div>
      <ul class="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => handleClick(item.sectionId)}
              class={`flex w-full items-start gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-sky-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                item.done ? "opacity-60" : ""
              }`}
            >
              <span
                aria-hidden="true"
                class={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                  item.done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-zinc-600 text-transparent"
                }`}
              >
                ✓
              </span>
              <div class="min-w-0 flex-1">
                <div
                  class={`truncate text-[11px] ${
                    item.done
                      ? "text-zinc-500 line-through"
                      : "text-zinc-100"
                  }`}
                >
                  {item.label}
                </div>
                <div class="truncate text-[9.5px] leading-snug text-zinc-500">
                  {item.hint}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

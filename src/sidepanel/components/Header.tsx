import type { Channel } from "../../lib/channels/types";
import type { Workspace, WorkspaceMeta } from "../../lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ChannelIcon } from "../ui/ChannelIcon";
import { ChannelSwitcher } from "../ui/ChannelSwitcher";

/** V5.1: bundle LinkedIn resumido pro dropdown do Header (subset de GroundswellBundleSummary). */
export interface LinkedInBundleOption {
  id: string;
  name: string;
}

interface Props {
  workspace: Workspace | null;
  workspaces: WorkspaceMeta[];
  onSwitchWorkspace: (id: string) => void;
  // V4.1: multi-list por workspace. Dropdown so aparece quando >1 lista.
  onSwitchActiveList?: (listId: string) => void;
  collected: number | null;
  passed: number | null;
  windowHours: number | null;
  lastRefreshTs: number | null;
  loading: boolean;
  cooldownSecs: number;
  isAdmin: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenAdmin?: () => void;
  onOpenPosts?: () => void;
  onOpenHistorico?: (initialTab?: "atividade" | "replies") => void;
  // V5: canal ativo — substitui o toggle X-only. LinkedIn agora e simetrico
  channel: Channel;
  onChangeChannel: (c: Channel) => void;
  // V5: abre GlossaryView pra qualquer termo (default: primeiro termo listado)
  onOpenGlossary?: () => void;
  // V5.1: listas Groundswell LinkedIn — dropdown analogo ao workspace.config.lists do X.
  linkedInBundles?: LinkedInBundleOption[];
  activeLinkedInBundleId?: string | null;
  onSwitchActiveBundle?: (bundleId: string) => void;
  activeView?: "main" | "historico" | "posts" | "settings" | "admin";
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `ha ${min}min`;
  const h = Math.floor(min / 60);
  return `ha ${h}h`;
}

export function Header({
  workspace,
  workspaces,
  onSwitchWorkspace,
  onSwitchActiveList,
  collected,
  passed,
  windowHours,
  lastRefreshTs,
  loading,
  cooldownSecs,
  isAdmin,
  onRefresh,
  onOpenSettings,
  onOpenAdmin,
  onOpenPosts,
  onOpenHistorico,
  channel,
  onChangeChannel,
  onOpenGlossary,
  linkedInBundles = [],
  activeLinkedInBundleId,
  onSwitchActiveBundle,
  activeView = "main",
}: Props) {
  const disabled = loading || cooldownSecs > 0;
  const label = loading
    ? "Buscando..."
    : cooldownSecs > 0
      ? `${cooldownSecs}s`
      : "Buscar posts novos";
  const voiceText = workspace?.config.voice?.trim() ?? "";
  const lists = workspace?.config.lists ?? [];
  const activeListId =
    workspace?.config.activeListId ?? (lists.length > 0 ? lists[0].id : null);
  const isLinkedIn = channel === "linkedin";
  // V5.1: dropdown dual.
  //   canal X   → lista de Listas do X (workspace.config.lists) quando >1
  //   canal LI  → lista de Bundles LinkedIn (multi-ativos, migration 0011) quando >1
  const showXListDropdown =
    channel === "twitter" && lists.length > 1 && onSwitchActiveList;
  const showLinkedInListDropdown =
    isLinkedIn && linkedInBundles.length > 1 && onSwitchActiveBundle;
  const activeLinkedInBundleFallback =
    activeLinkedInBundleId ?? linkedInBundles[0]?.id ?? null;

  return (
    <div
      class={`sticky top-0 z-10 border-b border-zinc-800 border-t-4 bg-[color:var(--color-bg-base)]/95 px-3 py-2.5 backdrop-blur ${
        isLinkedIn ? "border-t-[#0a66c2]" : "border-t-sky-500"
      }`}
    >
      {/* V5.3.2: linha 1 redesenhada — indicador CLARO de workspace + canal.
          Layout: brand pequeno + botao "?" + badge voz. Workspace + canal
          viraram um "pill" grande abaixo com bg colorido do canal ativo.
          Antes: workspace era so um select cinza discreto — dificil saber
          em qual voce esta trabalhando quando tem varios workspaces. */}
      <div class="flex items-center justify-between gap-2">
        <h1 class="text-base font-bold tracking-tight text-zinc-100">
          Replai
        </h1>
        <div class="flex items-center gap-1.5">
          {voiceText ? (
            <Badge
              variant="special"
              title={`voz: ${voiceText.slice(0, 120)}${voiceText.length > 120 ? "..." : ""}${workspace?.config.voice_source ? ` [${workspace.config.voice_source}]` : ""}`}
            >
              voz
            </Badge>
          ) : (
            <Badge
              variant="muted"
              title="sem voz configurada - replies podem sair genericas. configure em settings."
            >
              sem voz
            </Badge>
          )}
          {onOpenGlossary && (
            <button
              type="button"
              onClick={onOpenGlossary}
              aria-label="abrir glossario"
              title="Glossario"
              class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-[10px] font-bold text-zinc-400 transition-colors hover:border-sky-500 hover:text-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              ?
            </button>
          )}
        </div>
      </div>

      {/* V5.3.2: pill de workspace + canal — sinal principal de "onde estou".
          bg + border colorido pelo canal ativo (sky no X, azul do LinkedIn
          no LinkedIn). Muda instantaneamente ao trocar canal. */}
      {workspace && workspaces.length > 0 && (
        <div
          class={`mt-2 flex items-center gap-2 rounded-lg border-2 px-2 py-1.5 transition-colors ${
            isLinkedIn
              ? "border-[#0a66c2]/50 bg-[#0a66c2]/10"
              : "border-sky-500/50 bg-sky-500/10"
          }`}
        >
          <ChannelIcon
            channel={channel}
            size={20}
            className={isLinkedIn ? "text-[#0a66c2]" : "text-sky-300"}
            title={isLinkedIn ? "trabalhando em LinkedIn" : "trabalhando em X"}
          />
          <div class="flex min-w-0 flex-1 flex-col">
            <span
              class={`text-[10px] font-semibold uppercase tracking-wider ${
                isLinkedIn ? "text-[#7fb3ea]" : "text-sky-300"
              }`}
            >
              {isLinkedIn ? "LinkedIn" : "X (Twitter)"} · workspace
            </span>
            <select
              value={workspace.id}
              onChange={(e) =>
                onSwitchWorkspace((e.target as HTMLSelectElement).value)
              }
              aria-label="trocar workspace"
              title="trocar workspace"
              class="min-w-0 truncate bg-transparent px-0 py-0 text-sm font-semibold text-zinc-100 outline-none focus:ring-0"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id} class="bg-zinc-900">
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* linha 2: ChannelSwitcher — simetria conceitual X ≡ LinkedIn.
          Sempre visivel; chips sao permanentes. O toggle enabled em Settings
          controla so as tabs internas do Settings, nao o Header. */}
      <div class="mt-2 flex items-center gap-2">
        <ChannelSwitcher value={channel} onChange={onChangeChannel} />
      </div>

      {/* linha 2.5: dropdown da "lista" ativa. V5.1 dual:
            canal X   → Listas do X (workspace.config.lists) quando >1
            canal LI  → Bundles Groundswell LinkedIn (migration 0011) quando >1 */}
      {showXListDropdown && (
        <div class="mt-1.5 flex items-center gap-1.5">
          <span class="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
            lista
          </span>
          <select
            value={activeListId ?? lists[0].id}
            onChange={(e) =>
              onSwitchActiveList?.((e.target as HTMLSelectElement).value)
            }
            aria-label="trocar lista ativa"
            title="lista do X usada no proximo atualizar"
            class="min-w-0 flex-1 truncate rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-sky-500"
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {showLinkedInListDropdown && (
        <div class="mt-1.5 flex items-center gap-1.5">
          <span class="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">
            lista
          </span>
          <select
            value={activeLinkedInBundleFallback ?? linkedInBundles[0].id}
            onChange={(e) =>
              onSwitchActiveBundle?.((e.target as HTMLSelectElement).value)
            }
            aria-label="trocar lista LinkedIn ativa"
            title="lista LinkedIn usada no proximo atualizar"
            class="min-w-0 flex-1 truncate rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-sky-500"
          >
            {linkedInBundles.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* linha 3: acao principal — atualizar. LinkedIn tem sua propria triage
          separada por enquanto (commit 10 unifica). Ainda funciona como
          entry-point pro canal X. */}
      <div class="mt-2">
        <Button
          variant="primary"
          size="md"
          onClick={onRefresh}
          disabled={disabled}
          aria-label="atualizar lista"
          title={
            cooldownSecs > 0
              ? "cooldown: aguarde antes do proximo atualizar"
              : isLinkedIn
                ? "buscar novos posts das conexoes"
                : "buscar tweets novos"
          }
          fullWidth
        >
          {label}
        </Button>
      </div>

      {/* linha 4: nav principal — tabs simetricas por canal */}
      <div
        class="mt-2 flex items-center gap-1.5"
        role="navigation"
        aria-label="abas principais"
      >
        {onOpenHistorico && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenHistorico()}
            aria-label="historico (atividade + replies)"
            aria-current={activeView === "historico" ? "page" : undefined}
            title="historico: atividade + meus replies"
            class={
              activeView === "historico"
                ? "border-b-2 border-sky-500 text-sky-300"
                : ""
            }
          >
            Meu histórico
          </Button>
        )}
        {/* V5.2: aba Posts agora existe em ambos canais. Cada canal renderiza
            sua propria PostsView com pipeline especifico (X: Watchtower + virais;
            LinkedIn: sintese das replies LinkedIn recentes + POIs do bundle). */}
        {onOpenPosts && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenPosts}
            aria-label="aba posts"
            aria-current={activeView === "posts" ? "page" : undefined}
            title="sugestoes de posts originais (Watchtower + virais)"
            class={
              activeView === "posts"
                ? "border-b-2 border-sky-500 text-sky-300"
                : ""
            }
          >
            Sugerir posts
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenSettings}
          aria-label="configuracoes"
          aria-current={activeView === "settings" ? "page" : undefined}
          title="configuracoes"
          class={
            activeView === "settings"
              ? "border-b-2 border-sky-500 text-sky-300"
              : ""
          }
        >
          Configurações
        </Button>
        {isAdmin && onOpenAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenAdmin}
            aria-label="painel admin"
            aria-current={activeView === "admin" ? "page" : undefined}
            title="painel admin (so visivel pra admins)"
            class={`ml-auto ${
              activeView === "admin"
                ? "border-b-2 border-sky-500 text-sky-300"
                : ""
            }`}
          >
            admin
          </Button>
        )}
      </div>

      {/* linha 5: meta contextual da sessao — X-only.
          V5.2: contadores (collected/passed/windowHours) sao especificos do
          pipeline X (twitterapi). LinkedIn tem sua propria linha de "posts pra
          triagem" dentro do LinkedInView. Aqui so o timestamp aparece nos 2. */}
      {!isLinkedIn && (
        <div class="mt-1 flex items-center gap-3 text-[11px] text-zinc-500">
          {collected !== null ? (
            <span>
              sessao: {passed} post(s)
              {windowHours ? ` (janela ${windowHours}h)` : ""} de {collected}{" "}
              coletados
            </span>
          ) : (
            <span>nenhuma sessao ainda</span>
          )}
          {lastRefreshTs && <span class="ml-auto">{timeAgo(lastRefreshTs)}</span>}
        </div>
      )}
      {isLinkedIn && lastRefreshTs && (
        <div class="mt-1 flex items-center justify-end text-[11px] text-zinc-500">
          <span>{timeAgo(lastRefreshTs)}</span>
        </div>
      )}
    </div>
  );
}

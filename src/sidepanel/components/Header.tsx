import type { Workspace, WorkspaceMeta } from "../../lib/types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface Props {
  workspace: Workspace | null;
  workspaces: WorkspaceMeta[];
  onSwitchWorkspace: (id: string) => void;
  collected: number | null;
  passed: number | null;
  windowHours: number | null;
  lastRefreshTs: number | null;
  loading: boolean;
  cooldownSecs: number;
  isAdmin: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  onOpenAdmin?: () => void;
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
  collected,
  passed,
  windowHours,
  lastRefreshTs,
  loading,
  cooldownSecs,
  isAdmin,
  onRefresh,
  onOpenSettings,
  onOpenDashboard,
  onOpenAdmin,
}: Props) {
  const disabled = loading || cooldownSecs > 0;
  const label = loading
    ? "..."
    : cooldownSecs > 0
      ? `${cooldownSecs}s`
      : "atualizar";
  const voiceText = workspace?.config.voice?.trim() ?? "";
  return (
    <div class="sticky top-0 z-10 border-b border-zinc-800 bg-[color:var(--color-bg-base)]/95 px-3 py-2.5 backdrop-blur">
      {/* linha 1: brand + workspace + voice badge */}
      <div class="flex items-center gap-2">
        <h1 class="shrink-0 text-base font-bold tracking-tight text-zinc-100">
          Replai
        </h1>
        {workspace && workspaces.length > 0 && (
          <select
            value={workspace.id}
            onChange={(e) =>
              onSwitchWorkspace((e.target as HTMLSelectElement).value)
            }
            aria-label="trocar workspace"
            title="trocar workspace"
            class="min-w-0 flex-1 truncate rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-sky-500"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
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
      </div>

      {/* linha 2: acoes */}
      <div class="mt-2 flex items-center gap-1.5">
        <Button
          variant="primary"
          size="md"
          onClick={onRefresh}
          disabled={disabled}
          aria-label="atualizar lista"
          title={
            cooldownSecs > 0
              ? "cooldown: aguarde antes do proximo atualizar"
              : "buscar tweets novos"
          }
          fullWidth
        >
          {label}
        </Button>
        <Button
          variant="ghost"
          size="md"
          onClick={onOpenDashboard}
          aria-label="ver atividade"
          title="atividade / dashboard de uso"
        >
          atividade
        </Button>
        {isAdmin && onOpenAdmin && (
          <Button
            variant="ghost"
            size="md"
            onClick={onOpenAdmin}
            aria-label="painel admin"
            title="painel admin (so visivel pra admins)"
          >
            admin
          </Button>
        )}
        <Button
          variant="ghost"
          size="md"
          onClick={onOpenSettings}
          aria-label="configuracoes"
          title="configuracoes"
        >
          config
        </Button>
      </div>

      {/* linha 3: meta da sessao */}
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
    </div>
  );
}

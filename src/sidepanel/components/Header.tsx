import type { Workspace, WorkspaceMeta } from "../../lib/types";

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
  onRefresh: () => void;
  onOpenSettings: () => void;
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
  onRefresh,
  onOpenSettings,
}: Props) {
  const disabled = loading || cooldownSecs > 0;
  const label = loading
    ? "..."
    : cooldownSecs > 0
      ? `${cooldownSecs}s`
      : "atualizar";
  return (
    <div class="sticky top-0 z-10 border-b border-zinc-800 bg-[#0f1115]/95 px-3 py-2.5 backdrop-blur">
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <h1 class="text-base font-bold tracking-tight text-zinc-100">
            Replai
          </h1>
          {workspace && workspaces.length > 0 && (
            <select
              value={workspace.id}
              onChange={(e) =>
                onSwitchWorkspace((e.target as HTMLSelectElement).value)
              }
              title="trocar workspace"
              class="max-w-[140px] truncate rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-sky-600"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          {workspace?.config.custom_prompt.trim() && (
            <span
              title="custom prompt / persona ativa neste workspace"
              class="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-300"
            >
              persona
            </span>
          )}
        </div>
        <div class="flex items-center gap-1.5">
          <button
            onClick={onRefresh}
            disabled={disabled}
            title={cooldownSecs > 0 ? "cooldown: aguarde antes do proximo atualizar" : undefined}
            class="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {label}
          </button>
          <button
            onClick={onOpenSettings}
            title="configuracoes"
            class="rounded border border-zinc-700 px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            config
          </button>
        </div>
      </div>

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

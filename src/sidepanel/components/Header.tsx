interface Props {
  collected: number | null;
  passed: number | null;
  windowHours: number | null;
  lastRefreshTs: number | null;
  loading: boolean;
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
  collected,
  passed,
  windowHours,
  lastRefreshTs,
  loading,
  onRefresh,
  onOpenSettings,
}: Props) {
  return (
    <div class="sticky top-0 z-10 border-b border-zinc-800 bg-[#0f1115]/95 px-3 py-2.5 backdrop-blur">
      <div class="flex items-center justify-between">
        <h1 class="text-base font-bold tracking-tight text-zinc-100">Replai</h1>
        <div class="flex items-center gap-1.5">
          <button
            onClick={onRefresh}
            disabled={loading}
            class="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "..." : "atualizar"}
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

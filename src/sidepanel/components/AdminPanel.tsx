import { useEffect, useState } from "preact/hooks";
import {
  adminExport,
  fetchVerifiedStats,
  listUsers,
  promoteUser,
  revokeAdmin,
  toCsv,
  type AdminUserRow,
  type ExportFilters,
  type ExportTable,
  type VerifiedStats,
} from "../../lib/admin";
import { formatCostUsd } from "../../lib/cost-calc";
import { Alert } from "../ui/Alert";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input, Select } from "../ui/Input";
import { SectionHeader } from "../ui/SectionHeader";
import { Tabs } from "../ui/Tabs";

interface Props {
  currentUserId: string;
  onClose: () => void;
}

// Painel master/admin. Tabs: visao geral | analistas | exportar | por analista.
// Renderizado apenas quando isAdmin === true (App gateia).
//
// Importante: admins SAO analistas tambem. Os replies/posts deles aparecem
// nas mesmas agregacoes que de qualquer outro analista (admin_overview view
// no Supabase agrega TODOS os user_id sem filtro por role).
export function AdminPanel({ currentUserId, onClose }: Props) {
  const [tab, setTab] = useState<"overview" | "users" | "export">("overview");
  // Quando user clica num analista na aba "analistas", expande inline com
  // detalhes + botoes (promover/revogar/exportar dele).
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingUsers(true);
    setError(null);
    listUsers()
      .then(setUsers)
      .catch((e) =>
        setError(`erro carregando usuarios: ${(e as Error).message}`)
      )
      .finally(() => setLoadingUsers(false));
  }, []);

  function refreshUsers() {
    setLoadingUsers(true);
    listUsers()
      .then(setUsers)
      .finally(() => setLoadingUsers(false));
  }

  const adminCount = users.filter((u) => u.role === "admin").length;

  return (
    <div class="flex flex-col gap-3 p-3">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-zinc-100">
            Painel administrador
          </h2>
          <p class="text-[10px] text-zinc-500">
            {users.length} analista(s) na equipe • {adminCount} com acesso admin
          </p>
        </div>
        <Button variant="subtle" size="sm" onClick={onClose}>
          voltar
        </Button>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      <Tabs
        tabs={[
          { id: "overview", label: "visao geral" },
          { id: "users", label: "analistas", badge: users.length },
          { id: "export", label: "exportar (geral)" },
        ]}
        active={tab}
        onChange={(t) => setTab(t as typeof tab)}
      >
        {tab === "overview" && (
          <OverviewTab users={users} loading={loadingUsers} />
        )}
        {tab === "users" && (
          <UsersTab
            users={users}
            loading={loadingUsers}
            currentUserId={currentUserId}
            expandedUserId={expandedUserId}
            onExpand={setExpandedUserId}
            onChanged={refreshUsers}
          />
        )}
        {tab === "export" && <ExportTab users={users} />}
      </Tabs>
    </div>
  );
}

// ---------- Visao Geral ----------

function OverviewTab({
  users,
  loading,
}: {
  users: AdminUserRow[];
  loading: boolean;
}) {
  // Toggle "verificadas apenas": filtra metricas pra mostrar so as replies
  // onde posted_reply_id NAO E NULL (sinal forte de que foi postada de
  // verdade, nao so um auto-report). Off = mostra todas as "posted".
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [verified, setVerified] = useState<VerifiedStats | null>(null);

  useEffect(() => {
    fetchVerifiedStats()
      .then(setVerified)
      .catch((e) => console.warn("[admin] verified stats:", e));
  }, []);

  if (loading) {
    return (
      <div class="py-6 text-center text-xs text-zinc-500">carregando...</div>
    );
  }
  const totalReplies = users.reduce((s, u) => s + u.replies_total, 0);
  const totalPosted = users.reduce((s, u) => s + u.replies_posted, 0);
  const totalLast7 = users.reduce((s, u) => s + u.replies_last_7d, 0);
  const totalCost = users.reduce((s, u) => s + Number(u.total_cost_usd ?? 0), 0);

  // "postadas" e o numero exibido — alterna entre auto-reported vs verificadas
  // com URL. taxa de postagem usa o mesmo numero como numerador.
  const postedDisplay = verifiedOnly ? (verified?.total_verified ?? 0) : totalPosted;
  const convPct =
    totalReplies > 0 ? Math.round((postedDisplay / totalReplies) * 100) : 0;

  // top 5 ordenado pelo metric escolhido
  const verifiedByEmail = new Map(
    (verified?.by_user ?? []).map((u) => [u.user_email, u.verified])
  );
  const topByPosted = [...users]
    .map((u) => ({
      ...u,
      _displayPosted: verifiedOnly
        ? (verifiedByEmail.get(u.user_email) ?? 0)
        : u.replies_posted,
    }))
    .filter((u) => u._displayPosted > 0)
    .sort((a, b) => b._displayPosted - a._displayPosted)
    .slice(0, 5);

  return (
    <div class="mt-3 flex flex-col gap-3">
      <Alert type="info">
        admins tambem sao analistas — replies deles entram nas mesmas
        agregacoes abaixo.
      </Alert>

      {/* Toggle: contar so verificadas (com URL) vs todas auto-reported */}
      <label class="flex cursor-pointer items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-xs">
        <input
          type="checkbox"
          checked={verifiedOnly}
          onChange={(e) =>
            setVerifiedOnly((e.target as HTMLInputElement).checked)
          }
        />
        <span class="text-zinc-200">
          contar so replies <strong>verificadas</strong> (com URL postada)
        </span>
        {verified && (
          <span class="ml-auto text-[10px] text-zinc-500">
            {verified.total_verified}/{verified.total_posted} ={" "}
            {verified.verified_pct}%
          </span>
        )}
      </label>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="replies geradas"
          value={totalReplies}
          hint="total de replies disparados pelo time"
        />
        <Stat
          label={verifiedOnly ? "verificadas no X" : "postadas no X"}
          value={postedDisplay}
          hint={`${convPct}% taxa de postagem${verifiedOnly ? " (com URL)" : ""}`}
        />
        <Stat
          label="ultimos 7 dias"
          value={totalLast7}
          hint="atividade recente"
        />
        <Stat
          label="custo LLM"
          value={formatCostUsd(totalCost)}
          hint="tokens gastos no Gemini/Anthropic"
        />
      </div>

      <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <SectionHeader
          hint={
            verifiedOnly
              ? "ordenado por replies com URL postada (mais confiavel)"
              : "ordenado por replies confirmadas como postadas (auto-report)"
          }
        >
          top 5 analistas {verifiedOnly ? "(verificadas)" : "(postagens)"}
        </SectionHeader>
        {topByPosted.length === 0 ? (
          <p class="text-[11px] text-zinc-500">
            {verifiedOnly
              ? "ninguem postou e colou a URL ainda."
              : "ninguem confirmou postagem ainda."}
          </p>
        ) : (
          <ol class="flex flex-col gap-1.5">
            {topByPosted.map((u, i) => (
              <li
                key={u.user_id}
                class="flex items-center gap-2 text-xs text-zinc-200"
              >
                <span class="w-4 text-right tabular-nums text-zinc-500">
                  {i + 1}.
                </span>
                <span class="min-w-0 flex-1 truncate">
                  {u.display_name ?? u.user_email}
                </span>
                {u.role === "admin" && <Badge variant="special">admin</Badge>}
                <span class="tabular-nums text-emerald-300">
                  {u._displayPosted}
                </span>
                <span class="tabular-nums text-zinc-500">
                  /{u.replies_total}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ---------- Analistas (promover/revogar admin) ----------

function UsersTab({
  users,
  loading,
  currentUserId,
  expandedUserId,
  onExpand,
  onChanged,
}: {
  users: AdminUserRow[];
  loading: boolean;
  currentUserId: string;
  expandedUserId: string | null;
  onExpand: (id: string | null) => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleToggle(u: AdminUserRow, e: Event) {
    e.stopPropagation();
    if (u.user_id === currentUserId) {
      setErr("voce nao pode mudar o proprio nivel de acesso.");
      return;
    }
    setBusyId(u.user_id);
    setErr(null);
    try {
      if (u.role === "admin") {
        await revokeAdmin(u.user_id);
      } else {
        await promoteUser(u.user_id);
      }
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div class="py-6 text-center text-xs text-zinc-500">carregando...</div>
    );
  }

  return (
    <div class="mt-3 flex flex-col gap-2">
      <Alert type="info">
        <strong>analistas aparecem aqui automaticamente</strong> apos o
        primeiro login deles (Google @moicdigital). Clica em um pra ver
        detalhes + exportar dados dele. Promove a admin pra dar acesso a este
        painel.
      </Alert>

      {err && <Alert type="error">{err}</Alert>}

      {users.length === 0 && (
        <p class="text-[11px] text-zinc-500">
          nenhum analista cadastrado ainda.
        </p>
      )}

      {users.length === 1 && users[0]?.user_id === currentUserId && (
        <Alert type="warning">
          voce e o unico analista logado ate agora. peca pro time fazer login
          pra eles aparecerem aqui.
        </Alert>
      )}

      {users.map((u) => {
        const isExpanded = expandedUserId === u.user_id;
        return (
          <div
            key={u.user_id}
            class={`rounded-lg border bg-zinc-900/40 transition-colors ${
              isExpanded
                ? "border-sky-500/50 bg-sky-500/5"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <button
              type="button"
              onClick={() => onExpand(isExpanded ? null : u.user_id)}
              class="flex w-full items-start justify-between gap-2 p-2.5 text-left"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-sm text-zinc-100">
                    {u.display_name ?? u.user_email}
                  </span>
                  {u.role === "admin" && <Badge variant="special">admin</Badge>}
                  {u.user_id === currentUserId && (
                    <Badge variant="muted">voce</Badge>
                  )}
                </div>
                <div class="text-[10px] text-zinc-500">{u.user_email}</div>
                <div class="mt-1 flex flex-wrap gap-1.5 text-[10px] text-zinc-400">
                  <span>{u.replies_total} replies</span>
                  <span>•</span>
                  <span class="text-emerald-300">
                    {u.replies_posted} postadas
                  </span>
                  <span>•</span>
                  <span>{u.workspaces_count} workspaces</span>
                </div>
              </div>
              <span class="text-zinc-500">{isExpanded ? "▾" : "▸"}</span>
            </button>

            {isExpanded && (
              <div class="border-t border-zinc-800 px-2.5 pb-3 pt-2">
                <DrilldownDetails
                  user={u}
                  currentUserId={currentUserId}
                  busy={busyId === u.user_id}
                  onToggleRole={(e) => handleToggle(u, e)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Detalhes inline (stats + export especifico + promover/revogar) do analista
// quando expandido. Substitui o que era DrilldownTab.
function DrilldownDetails({
  user,
  currentUserId,
  busy,
  onToggleRole,
}: {
  user: AdminUserRow;
  currentUserId: string;
  busy: boolean;
  onToggleRole: (e: Event) => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [format, setFormat] = useState<"csv" | "json">("csv");

  async function handleExportThisUser() {
    setExporting(true);
    setExportInfo(null);
    setExportErr(null);
    try {
      const rows = await adminExport({
        table: "reply_logs",
        userEmails: [user.user_email],
      });
      if (rows.length === 0) {
        setExportInfo("nenhum reply deste analista.");
        return;
      }
      const content =
        format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2);
      const mime = format === "csv" ? "text/csv" : "application/json";
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
      const safe = user.user_email.replace(/[^a-z0-9_-]/gi, "_");
      a.download = `replai-${safe}-${stamp}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportInfo(`baixou ${rows.length} reply(s).`);
    } catch (e) {
      setExportErr(`erro: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div class="flex flex-col gap-3">
      {/* Stats */}
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="replies geradas" value={user.replies_total} />
        <Stat label="postadas" value={user.replies_posted} />
        <Stat label="descartadas" value={user.replies_skipped} />
        <Stat label="ultimos 7d" value={user.replies_last_7d} />
        <Stat label="workspaces" value={user.workspaces_count} />
        <Stat
          label="custo LLM"
          value={formatCostUsd(Number(user.total_cost_usd ?? 0))}
        />
      </div>
      <div class="text-[10px] text-zinc-500">
        primeiro acesso: {new Date(user.first_seen_at).toLocaleString("pt-BR")} •
        ultimo: {new Date(user.last_seen_at).toLocaleString("pt-BR")}
      </div>

      {/* Acoes */}
      <div class="flex flex-wrap gap-2">
        <Button
          variant={user.role === "admin" ? "danger" : "primary"}
          size="sm"
          loading={busy}
          disabled={user.user_id === currentUserId}
          title={
            user.user_id === currentUserId
              ? "voce nao pode mudar o proprio acesso"
              : user.role === "admin"
                ? "remover acesso admin"
                : "dar acesso admin"
          }
          onClick={onToggleRole}
        >
          {user.role === "admin" ? "revogar admin" : "promover a admin"}
        </Button>
      </div>

      {/* Export especifico deste analista */}
      <div class="rounded border border-zinc-700 bg-zinc-950/60 p-2">
        <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          exportar replies deste analista
        </div>
        <div class="flex items-center gap-1.5">
          <Select
            value={format}
            onChange={(e) =>
              setFormat((e.target as HTMLSelectElement).value as "csv" | "json")
            }
            class="flex-1"
          >
            <option value="csv">CSV (Excel/Sheets)</option>
            <option value="json">JSON</option>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            loading={exporting}
            onClick={handleExportThisUser}
          >
            baixar
          </Button>
        </div>
        {exportErr && (
          <div class="mt-1.5">
            <Alert type="error">{exportErr}</Alert>
          </div>
        )}
        {exportInfo && (
          <div class="mt-1.5">
            <Alert type="success">{exportInfo}</Alert>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Exportar dados ----------

function ExportTab({ users }: { users: AdminUserRow[] }) {
  const [table, setTable] = useState<ExportTable>("reply_logs");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [emailFilter, setEmailFilter] = useState<string>("");
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setErr(null);
    setInfo(null);
    setProgress(0);
    try {
      const filters: ExportFilters = {
        table,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
        userEmails: emailFilter ? [emailFilter] : undefined,
      };
      const rows = await adminExport(filters, setProgress);
      if (rows.length === 0) {
        setInfo("nenhuma linha encontrada com esses filtros.");
        return;
      }
      const content =
        format === "csv" ? toCsv(rows) : JSON.stringify(rows, null, 2);
      const mime = format === "csv" ? "text/csv" : "application/json";
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
      a.download = `replai-${table}-${stamp}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setInfo(`baixou ${rows.length} linha(s).`);
    } catch (e) {
      setErr(`erro exportando: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="mt-3 flex flex-col gap-3">
      <Select
        label="qual tabela exportar"
        value={table}
        onChange={(e) =>
          setTable((e.target as HTMLSelectElement).value as ExportTable)
        }
      >
        <option value="reply_logs">
          replies geradas (52 colunas, analytics completo)
        </option>
        <option value="post_logs">
          posts originais (Watchtower + virais + LLM, V4.1.8)
        </option>
        <option value="replied_tweets">
          tweets marcados como respondidos (resumo)
        </option>
        <option value="session_logs">
          sessoes de uso (custo LLM, performance, erros)
        </option>
        <option value="events">eventos operacionais (cliques, edits)</option>
      </Select>
      <Input
        type="date"
        label="data inicio (opcional)"
        value={startDate}
        onInput={(e) => setStartDate((e.target as HTMLInputElement).value)}
      />
      <Input
        type="date"
        label="data fim (opcional)"
        value={endDate}
        onInput={(e) => setEndDate((e.target as HTMLInputElement).value)}
      />
      <Select
        label="filtrar por analista (opcional, so funciona em 'replies geradas')"
        value={emailFilter}
        onChange={(e) => setEmailFilter((e.target as HTMLSelectElement).value)}
      >
        <option value="">— todos os analistas —</option>
        {users.map((u) => (
          <option key={u.user_id} value={u.user_email}>
            {u.user_email}
            {u.role === "admin" ? " (admin)" : ""}
          </option>
        ))}
      </Select>
      <Select
        label="formato do arquivo"
        value={format}
        onChange={(e) =>
          setFormat((e.target as HTMLSelectElement).value as "csv" | "json")
        }
      >
        <option value="csv">CSV (abre direto no Excel/Sheets)</option>
        <option value="json">JSON (preserva tipos aninhados)</option>
      </Select>

      {err && <Alert type="error">{err}</Alert>}
      {info && <Alert type="success">{info}</Alert>}

      <Button variant="primary" loading={busy} onClick={handleExport} fullWidth>
        {busy ? `exportando... ${progress} linhas` : "baixar arquivo"}
      </Button>

      <p class="text-[10px] text-zinc-500">
        limite: 50 mil linhas por export. pra volumes maiores, use o SQL Editor
        do Supabase diretamente.
      </p>
    </div>
  );
}

// ---------- Helpers ----------

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
      <div class="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div class="text-lg font-bold tabular-nums text-zinc-100">{value}</div>
      {hint && <div class="text-[10px] text-zinc-500">{hint}</div>}
    </div>
  );
}

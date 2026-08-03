// V5 — Bloco Settings LinkedIn.
//
// UX principios aplicados:
// - Voice OBRIGATORIA: validation inline + error clarity (WCAG error-clarity)
// - Disabled state visual + semantico quando canal off (state-clarity)
// - Progressive disclosure: config APIFY em details collapsed
// - Rate limit warnings visiveis mas nao intrusivos (compliance guardrail)
// - Todos os inputs com label visivel (WCAG form-labels)

import { useEffect, useRef, useState } from "preact/hooks";
import { LINKEDIN_COMPLIANCE, APIFY } from "../../../lib/constants";
import type { GroundswellBundleSummary } from "../../../lib/channels/types";
import { GLOSSARY } from "../../../lib/glossary";
import {
  listActiveBundles,
  renameBundle,
  deleteBundle,
} from "../../../lib/groundswell/storage";
import { InfoPopover } from "../../ui/InfoPopover";
import { SettingSection } from "../settings/SettingSection";
import { BundleUpload } from "./BundleUpload";
import { ManualListUpload } from "./ManualListUpload";

interface LinkedInConfig {
  linkedin_enabled?: boolean;
  linkedin_voice?: string;
  linkedin_daily_reply_limit?: number;
  linkedin_daily_run_limit?: number;
  /** V5.1: persona LinkedIn (publicos-alvo) — canal-especifica. */
  linkedin_persona_public_target?: string[];
  linkedin_time_window_hours?: number;
  linkedin_max_batch?: number;
}

interface Props {
  workspaceId: string;
  config: LinkedInConfig;
  onChange: (config: LinkedInConfig) => void;
  activeBundle?: GroundswellBundleSummary | null;
  onBundleReload?: () => void;
  onOpenGlossary?: (term: string) => void;
  /** V5.2: abrir Voice Creator modal (owned pelo pai Settings). */
  onOpenVoiceCreator?: () => void;
}

export function LinkedInSettings({
  workspaceId,
  config,
  onChange,
  activeBundle,
  onBundleReload,
  onOpenGlossary: _onOpenGlossary,
  onOpenVoiceCreator,
}: Props) {
  const [voiceDraft, setVoiceDraft] = useState(config.linkedin_voice ?? "");
  const [dailyReply, setDailyReply] = useState(
    config.linkedin_daily_reply_limit ??
      LINKEDIN_COMPLIANCE.MAX_POSTS_PER_DAY_DEFAULT
  );
  const [dailyRun, setDailyRun] = useState(
    config.linkedin_daily_run_limit ?? APIFY.DAILY_RUN_LIMIT_DEFAULT
  );
  // V5.1: lista de bundles ativos (LinkedIn) — cada bundle e uma "lista"
  // no dropdown Header. Recarrega quando workspaceId muda ou onBundleReload
  // dispara (ex: apos novo upload).
  const [bundles, setBundles] = useState<
    Array<{ id: string; name: string; source: "groundswell" | "manual"; workspace_slug: string; is_default: boolean; latest_engagement_date: string }>
  >([]);
  const [addMode, setAddMode] = useState(false);
  const [bundlesTick, setBundlesTick] = useState(0);
  // V5.2: sub-tab dentro do bloco Listas — Bundle Groundswell (upload zip) vs
  // Lista manual (upload CSV padrão ICP).
  const [uploadTab, setUploadTab] = useState<"groundswell" | "manual">(
    "groundswell"
  );
  // V5.3.2: state pra edicao inline de nome de lista + confirmacao de exclusao.
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [bundleActionBusy, setBundleActionBusy] = useState(false);
  const [bundleActionError, setBundleActionError] = useState<string | null>(null);

  const enabled = Boolean(config.linkedin_enabled);
  const voiceOk = voiceDraft.trim().length >= 50;
  const canEnable = voiceOk && Boolean(activeBundle);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const rows = await listActiveBundles(workspaceId, "linkedin");
        if (cancelled) return;
        setBundles(rows);
      } catch {
        if (!cancelled) setBundles([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, bundlesTick]);

  function apply(patch: Partial<LinkedInConfig>) {
    onChange({ ...config, ...patch });
  }

  // V5.0.4: commit debounced onInput. Antes era so onBlur — se o user
  // clicava salvar no header sticky sem o textarea perder foco antes,
  // apply() nao rodava e a voz ficava stale no draft global.
  const voiceCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  useEffect(() => {
    if (voiceCommitTimerRef.current) {
      clearTimeout(voiceCommitTimerRef.current);
    }
    // Se o valor ja bate com o config, nao precisa commit.
    if (voiceDraft.trim() === (config.linkedin_voice ?? "").trim()) {
      return;
    }
    voiceCommitTimerRef.current = setTimeout(() => {
      apply({ linkedin_voice: voiceDraft.trim() });
    }, 300);
    return () => {
      if (voiceCommitTimerRef.current) {
        clearTimeout(voiceCommitTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceDraft]);

  // Se o config vier atualizado por fora (pullAll, switch de workspace),
  // sincroniza o draft local sem gerar loop de commit.
  useEffect(() => {
    const upstream = config.linkedin_voice ?? "";
    if (upstream.trim() !== voiceDraft.trim()) {
      setVoiceDraft(upstream);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.linkedin_voice]);

  const bundleStale = activeBundle
    ? isStale(activeBundle.latest_engagement_date)
    : false;

  // V5.1: canal LinkedIn e implicitamente "ativo" quando voice + bundle
  // estao configurados. O toggle explicito foi removido — canEnable e usado
  // apenas pra logica de estado interno (nao mais UI). Assinatura de
  // ChannelToggle preservada pra retro-compat mas nao mais renderizada.
  void enabled; void canEnable;

  return (
    <>
      {/* V5.2: Listas — SettingSection sky (order 3, uniforme com Fontes X).
          Titulo + help simplificados: user escolhe entre bundle Groundswell
          (POIs+Bridges scored) ou lista manual (CSV padrão ICP). */}
      <SettingSection
        title="Listas de perfis LinkedIn"
        channel="li"
        tone="sky"
        order={3}
        defaultOpen
        help="Perfis que voce vai acompanhar. Suba um bundle Groundswell ou uma lista manual no CSV padrão ICP (contexto para o LLM + LinkedIn para a Apify)."
      >
        <div class="flex justify-end">
          <a
            href="/modelo-lista-linkedin.csv"
            download
            class="rounded border border-sky-700/60 bg-sky-950/30 px-2.5 py-1 text-[11px] font-medium text-sky-200 hover:border-sky-500 hover:bg-sky-900/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            baixar template CSV
          </a>
        </div>

        {bundles.length === 0 && !addMode && (
          <div class="space-y-2">
            <UploadTabSwitcher active={uploadTab} onChange={setUploadTab} />
            {uploadTab === "groundswell" ? (
              <BundleUpload
                workspaceId={workspaceId}
                onUploaded={() => {
                  setBundlesTick((t) => t + 1);
                  onBundleReload?.();
                }}
              />
            ) : (
              <ManualListUpload
                workspaceId={workspaceId}
                onUploaded={() => {
                  setBundlesTick((t) => t + 1);
                  onBundleReload?.();
                }}
              />
            )}
          </div>
        )}

        {bundles.length > 0 && !addMode && (
          <div class="space-y-1.5">
            {activeBundle && (
              <BundleSummaryCard
                summary={activeBundle}
                stale={bundleStale}
                onReplace={onBundleReload}
                workspaceId={workspaceId}
              />
            )}
            {bundleActionError && (
              <div class="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">
                {bundleActionError}
              </div>
            )}
            <ul class="flex flex-col gap-1">
              {bundles.map((b) => {
                const isEditing = editingBundleId === b.id;
                const isConfirmingDelete = confirmDeleteId === b.id;
                const isActive = activeBundle?.id === b.id;
                return (
                  <li
                    key={b.id}
                    class={`group rounded border text-[11px] ${
                      isActive
                        ? "border-sky-500/40 bg-sky-500/5 text-sky-200"
                        : "border-zinc-800 bg-zinc-900/40 text-zinc-300"
                    }`}
                  >
                    {/* Linha principal — nome + badges + actions */}
                    <div class="flex items-center gap-1.5 px-2 py-1">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingName}
                          autoFocus
                          onInput={(e) =>
                            setEditingName((e.target as HTMLInputElement).value)
                          }
                          onKeyDown={async (e) => {
                            if (e.key === "Enter" && !bundleActionBusy) {
                              e.preventDefault();
                              setBundleActionError(null);
                              setBundleActionBusy(true);
                              try {
                                await renameBundle(b.id, editingName);
                                setEditingBundleId(null);
                                setBundlesTick((t) => t + 1);
                                onBundleReload?.();
                              } catch (err) {
                                setBundleActionError(
                                  `erro ao renomear: ${(err as Error).message}`
                                );
                              } finally {
                                setBundleActionBusy(false);
                              }
                            } else if (e.key === "Escape") {
                              setEditingBundleId(null);
                              setBundleActionError(null);
                            }
                          }}
                          class="min-w-0 flex-1 rounded border border-amber-500/40 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-100 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        />
                      ) : (
                        <span class="min-w-0 flex-1 truncate">
                          {b.name}
                          <span
                            class={`ml-1.5 rounded px-1 py-[1px] text-[9px] uppercase tracking-wide ${
                              b.source === "manual"
                                ? "bg-zinc-800 text-zinc-400"
                                : "bg-indigo-500/20 text-indigo-300"
                            }`}
                          >
                            {b.source === "manual" ? "manual" : "groundswell"}
                          </span>
                          {b.is_default && (
                            <span class="ml-1.5 rounded bg-zinc-700 px-1 py-[1px] text-[9px] uppercase tracking-wide text-zinc-400">
                              default
                            </span>
                          )}
                        </span>
                      )}
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            disabled={bundleActionBusy}
                            onClick={async () => {
                              setBundleActionError(null);
                              setBundleActionBusy(true);
                              try {
                                await renameBundle(b.id, editingName);
                                setEditingBundleId(null);
                                setBundlesTick((t) => t + 1);
                                onBundleReload?.();
                              } catch (err) {
                                setBundleActionError(
                                  `erro ao renomear: ${(err as Error).message}`
                                );
                              } finally {
                                setBundleActionBusy(false);
                              }
                            }}
                            class="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                            title="salvar (Enter)"
                          >
                            salvar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBundleId(null);
                              setBundleActionError(null);
                            }}
                            class="text-[10px] text-zinc-400 hover:text-zinc-200"
                            title="cancelar (Esc)"
                          >
                            cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <span class="shrink-0 text-[10px] text-zinc-500 tabular-nums">
                            {b.latest_engagement_date}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBundleId(b.id);
                              setEditingName(b.name);
                              setConfirmDeleteId(null);
                              setBundleActionError(null);
                            }}
                            title="renomear lista"
                            aria-label="renomear lista"
                            class="ml-0.5 rounded p-0.5 text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-800 hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(b.id);
                              setEditingBundleId(null);
                              setBundleActionError(null);
                            }}
                            title="excluir lista"
                            aria-label="excluir lista"
                            class="rounded p-0.5 text-zinc-500 opacity-0 transition-opacity hover:bg-red-500/20 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"/>
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                    {/* Confirmacao de exclusao — inline, dentro do proprio card */}
                    {isConfirmingDelete && (
                      <div class="flex items-center gap-1.5 border-t border-zinc-800 bg-red-500/5 px-2 py-1 text-[10px] text-red-200">
                        <span class="flex-1">
                          excluir <strong>{b.name}</strong>? nao apaga historico
                          de replies, mas some do dropdown.
                        </span>
                        <button
                          type="button"
                          disabled={bundleActionBusy}
                          onClick={async () => {
                            setBundleActionError(null);
                            setBundleActionBusy(true);
                            try {
                              await deleteBundle(b.id);
                              setConfirmDeleteId(null);
                              setBundlesTick((t) => t + 1);
                              onBundleReload?.();
                            } catch (err) {
                              setBundleActionError(
                                `erro ao excluir: ${(err as Error).message}`
                              );
                            } finally {
                              setBundleActionBusy(false);
                            }
                          }}
                          class="rounded bg-red-600 px-1.5 py-0.5 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                        >
                          excluir
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          class="text-zinc-400 hover:text-zinc-200"
                        >
                          cancelar
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => setAddMode(true)}
              class="w-full rounded border border-dashed border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-400 hover:border-sky-500 hover:text-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              + adicionar nova lista
            </button>
          </div>
        )}

        {addMode && (
          <div class="space-y-2">
            <UploadTabSwitcher active={uploadTab} onChange={setUploadTab} />
            {uploadTab === "groundswell" ? (
              <BundleUpload
                workspaceId={workspaceId}
                onUploaded={() => {
                  setAddMode(false);
                  setBundlesTick((t) => t + 1);
                  onBundleReload?.();
                }}
              />
            ) : (
              <ManualListUpload
                workspaceId={workspaceId}
                onUploaded={() => {
                  setAddMode(false);
                  setBundlesTick((t) => t + 1);
                  onBundleReload?.();
                }}
              />
            )}
            <button
              type="button"
              onClick={() => setAddMode(false)}
              class="text-[10px] text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
            >
              cancelar
            </button>
          </div>
        )}
      </SettingSection>

      {/* V5.1: Voz LinkedIn — SettingSection violet (order 1, uniforme com X) */}
      <SettingSection
        title="Voz do canal LinkedIn"
        channel="li"
        tone="violet"
        order={1}
        defaultOpen
        help="Tom formal/expositivo. Nunca snark. Nao usar categorias X (perguntar sobre thread). LinkedIn premia longform 3-5 linhas. Independente da voz do X."
      >
        <div>
          <label
            class="mb-1 flex items-baseline justify-between"
            for="linkedin-voice"
          >
            <span class="text-xs font-medium text-zinc-300">
              voz LinkedIn <span class="text-red-400">*</span>
            </span>
            <span
              class={`font-mono text-[10px] tabular-nums ${
                voiceOk ? "text-emerald-400" : "text-zinc-500"
              }`}
              aria-live="polite"
            >
              {voiceDraft.trim().length} / 50 min
            </span>
          </label>
          {/* V5.2: Voice Creator (LLM) — mesmo modal do Voz X, aplica em ambos ou so LinkedIn. */}
          {onOpenVoiceCreator && (
            <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenVoiceCreator}
                class="rounded border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-200 hover:bg-violet-500/20"
              >
                criar voz automatica
              </button>
            </div>
          )}
          <textarea
            id="linkedin-voice"
            value={voiceDraft}
            onInput={(e) => setVoiceDraft((e.target as HTMLTextAreaElement).value)}
            rows={6}
            aria-describedby="linkedin-voice-help"
            aria-invalid={!voiceOk}
            placeholder="Tom formal/expositivo. Nunca snark. Nao usar categorias X (perguntar sobre thread) — LinkedIn premia longform..."
            class={`w-full rounded border bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-zinc-950 ${
              voiceOk
                ? "border-zinc-700 focus:border-sky-600 focus:ring-sky-500"
                : "border-red-800/60 focus:border-red-500 focus:ring-red-500"
            }`}
          />
          <p
            id="linkedin-voice-help"
            class={`text-[10px] leading-snug ${
              voiceOk ? "text-zinc-500" : "text-red-300/85"
            }`}
          >
            {voiceOk
              ? "Voz aplicada em toda reply LinkedIn."
              : "Obrigatoria pra ativar canal. Min 50 chars, ideal 200-500 palavras."}
          </p>
        </div>
      </SettingSection>

      {/* V5.2: Persona LinkedIn removida da UI — user feedback: redundante
          com Publicos-alvo do X (audiencia = mesma pessoa). O campo continua
          no schema pra retro-compat, e o reply-generator + posts-suggestion
          caem no fallback pra persona_public_target (X) quando vazio. */}

      {/* V5.1: Filtros + batch LinkedIn — SettingSection indigo (order 4, uniforme com X) */}
      <SettingSection
        title="Filtros + batch LinkedIn (janela, tamanho)"
        channel="li"
        tone="indigo"
        order={4}
        help="Controle quais posts armazenados aparecem na triagem. A coleta busca somente o post mais recente de cada perfil e reaproveita o resultado por 24h."
      >
        <div class="space-y-2.5">
          <NumberField
            id="ln-window-hours"
            label="janela de tempo (horas)"
            hint="mostra posts coletados que foram publicados nas ultimas N horas. Default 168h (1 semana)."
            value={config.linkedin_time_window_hours ?? 168}
            min={1}
            max={720}
            onChange={(v) => apply({ linkedin_time_window_hours: v })}
          />
          <NumberField
            id="ln-max-batch"
            label="max posts por atualizar"
            hint="cap de quantos posts LinkedIn passam pro LLM em cada refresh. Default 50."
            value={config.linkedin_max_batch ?? 50}
            min={1}
            max={200}
            onChange={(v) => apply({ linkedin_max_batch: v })}
          />
        </div>
      </SettingSection>

      {/* V5.1: Compliance LinkedIn — SettingSection amber (order 5) */}
      <SettingSection
        advanced
        title="Limites de seguranca LinkedIn (evita ban)"
        channel="li"
        tone="amber"
        order={5}
        help="Rate limits pra proteger a conta. LinkedIn flaga contas com >50 replies/dia. Cache Apify de 24h evita coletas repetidas."
      >
        <div class="space-y-2.5">
          <NumberField
              id="ln-daily-reply"
              label="posts / dia (soft)"
              hint={`hard limit ${LINKEDIN_COMPLIANCE.MAX_POSTS_PER_DAY_HARD}. LinkedIn flaga contas >50/dia`}
              value={dailyReply}
              min={1}
              max={LINKEDIN_COMPLIANCE.MAX_POSTS_PER_DAY_HARD}
              onChange={(v) => {
                setDailyReply(v);
                apply({ linkedin_daily_reply_limit: v });
              }}
            />
            <NumberField
              id="ln-daily-run"
              label="runs APIFY / dia"
              hint={`hard limit ${APIFY.DAILY_RUN_LIMIT_HARD}. cache reduz muito`}
              value={dailyRun}
              min={1}
              max={APIFY.DAILY_RUN_LIMIT_HARD}
              onChange={(v) => {
                setDailyRun(v);
                apply({ linkedin_daily_run_limit: v });
            }}
          />
          <ComplianceInfo />
        </div>
      </SettingSection>
    </>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

// V5.1: ChannelToggle removido — canal LinkedIn agora e implicitamente ativo
// quando voice + bundle estao configurados. Sem toggle explicito.

function BundleSummaryCard({
  summary,
  stale,
  onReplace,
  workspaceId,
}: {
  summary: GroundswellBundleSummary;
  stale: boolean;
  onReplace?: () => void;
  workspaceId: string;
}) {
  const [replaceMode, setReplaceMode] = useState(false);
  if (replaceMode) {
    return (
      <div class="space-y-1.5">
        <BundleUpload
          workspaceId={workspaceId}
          onUploaded={() => {
            setReplaceMode(false);
            onReplace?.();
          }}
        />
        <button
          onClick={() => setReplaceMode(false)}
          class="text-[10px] text-zinc-400 underline underline-offset-2 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-1 focus:ring-offset-zinc-900"
        >
          cancelar
        </button>
      </div>
    );
  }
  return (
    <div class="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-2">
      {stale && (
        <div
          role="alert"
          class="mb-1.5 rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1 text-[10px] text-amber-200"
        >
          lista desatualizada — ultima interacao{" "}
          {daysSince(summary.latest_engagement_date)} dias atras. gere uma nova coleta Groundswell.
        </div>
      )}
      <div class="grid grid-cols-3 gap-x-2 gap-y-1 font-mono text-[10px] tabular-nums">
        <StatMini
          label="pessoas-alvo"
          value={summary.n_pois}
          info={{ term: "POI", short: GLOSSARY.POI.short }}
        />
        <StatMini
          label="conexoes"
          value={summary.n_bridges_ready}
          suffix={`/${summary.n_bridges}`}
          info={{ term: "Bridge", short: GLOSSARY.Bridge.short }}
        />
        <StatMini label="relacoes" value={summary.n_relationships} />
      </div>
      <div class="mt-2 flex items-center justify-between border-t border-zinc-800 pt-1.5">
        <span class="text-[9.5px] uppercase tracking-wide text-zinc-500">
          {summary.is_default ? "usando lista padrao do time" : "lista deste workspace"}
        </span>
        <button
          onClick={() => setReplaceMode(true)}
          class="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 focus:ring-offset-zinc-900"
        >
          substituir
        </button>
      </div>
    </div>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label for={id} class="mb-0.5 flex items-baseline justify-between text-[10px]">
        <span class="text-zinc-300">{label}</span>
        <span class="text-zinc-500">
          max <span class="font-mono tabular-nums">{max}</span>
        </span>
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onInput={(e) => {
          const raw = parseInt((e.target as HTMLInputElement).value, 10);
          if (Number.isFinite(raw)) {
            onChange(Math.max(min, Math.min(max, raw)));
          }
        }}
        aria-describedby={`${id}-hint`}
        class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-mono tabular-nums text-zinc-100 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 focus:ring-offset-zinc-900"
      />
      <p id={`${id}-hint`} class="mt-0.5 text-[9.5px] leading-snug text-zinc-500">
        {hint}
      </p>
    </div>
  );
}

function ComplianceInfo() {
  return (
    <ul class="space-y-0.5 border-t border-amber-900/30 pt-2 text-[9.5px] leading-snug text-amber-200/70">
      <li>
        cooldown <span class="font-mono tabular-nums">60–180s</span> aleatorio entre generations
      </li>
      <li>
        max <span class="font-mono tabular-nums">15</span> generations / hora por analista
      </li>
      <li>
        atividade so entre <span class="font-mono tabular-nums">8h–23h</span> local
      </li>
    </ul>
  );
}

function StatMini({
  label,
  value,
  suffix,
  info,
}: {
  label: string;
  value: number;
  suffix?: string;
  info?: { term: string; short: string };
}) {
  return (
    <div>
      <div class="flex items-center gap-1 text-zinc-500">
        {label}
        {info && <InfoPopover term={info.term} short={info.short} />}
      </div>
      <div class="text-zinc-200">
        {value.toLocaleString("pt-BR")}
        {suffix && <span class="text-zinc-500">{suffix}</span>}
      </div>
    </div>
  );
}

// V5.2: switcher entre upload Groundswell (zip) e Lista manual (CSV padrão ICP).
// Coexistem no mesmo bloco "Listas" — user escolhe qual criar.
function UploadTabSwitcher({
  active,
  onChange,
}: {
  active: "groundswell" | "manual";
  onChange: (v: "groundswell" | "manual") => void;
}) {
  const tabClass = (v: "groundswell" | "manual") =>
    `flex-1 rounded px-2 py-1 text-[10px] uppercase tracking-wide transition-colors ${
      active === v
        ? "bg-sky-500/15 text-sky-200 border border-sky-500/40"
        : "bg-zinc-900/50 text-zinc-500 border border-zinc-800 hover:text-zinc-300"
    }`;
  return (
    <div class="flex gap-1">
      <button type="button" onClick={() => onChange("groundswell")} class={tabClass("groundswell")}>
        Bundle Groundswell
      </button>
      <button type="button" onClick={() => onChange("manual")} class={tabClass("manual")}>
        Lista manual (CSV)
      </button>
    </div>
  );
}

// helpers
function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}
function isStale(dateStr: string): boolean {
  return daysSince(dateStr) > 30;
}

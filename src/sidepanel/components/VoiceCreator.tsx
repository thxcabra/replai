// V5.2 — VoiceCreator (renomeado de "Wizard" pra ser autoexplicativo).
//
// Modal overlay com stepper de 5 perguntas + preview. Substitui a friccao de
// escrever textarea de voz do zero. LLM (Gemini Flash) gera 2 versoes (X +
// LinkedIn) a partir das respostas.
//
// Fluxo:
//   step 1: trabalho (textarea)
//   step 2: temas (list input, 3-5 itens)
//   step 3: referencias (list input, 3-5 itens)
//   step 4: anti-padroes (list input, 3 itens)
//   step 5: tom (4 sliders 1-5)
//   step 6: preview + editar + aplicar
//
// Onde chamar:
//   - Voz X (Settings): botao "criar voz automatica"
//   - Voz LinkedIn (LinkedInSettings): idem
//   - SetupWizard step voz: idem (opcional)
//
// Aplicar as vozes chama onApply({voice_x, voice_linkedin}) — o consumidor
// escolhe se seta so uma ou as duas (tem opcao "usar so pro X" / "so LinkedIn").

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  generateVoices,
  type VoiceCreatorAnswers,
  type GeneratedVoices,
} from "../../lib/voice-generator";
import type { Config } from "../../lib/types";

interface Props {
  config: Pick<Config, "gemini_api_key">;
  /** Aplicar vozes escolhidas pelo user. Chamado com uma ou ambas (X/LinkedIn). */
  onApply: (voices: { voice_x?: string; voice_linkedin?: string }) => void;
  onClose: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const EMPTY: VoiceCreatorAnswers = {
  work: "",
  themes: ["", "", ""],
  references: ["", "", ""],
  antiPatterns: ["", "", ""],
  tone: { formal: 3, technical: 3, provocative: 3, analytical: 3 },
};

export function VoiceCreator({ config, onApply, onClose }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [answers, setAnswers] = useState<VoiceCreatorAnswers>(EMPTY);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedVoices | null>(null);
  const [editedX, setEditedX] = useState("");
  const [editedLinkedIn, setEditedLinkedIn] = useState("");

  const canAdvance = () => {
    if (step === 1) return answers.work.trim().length >= 10;
    if (step === 2) return answers.themes.filter((t) => t.trim()).length >= 2;
    if (step === 3) return answers.references.filter((r) => r.trim()).length >= 2;
    if (step === 4) return answers.antiPatterns.filter((p) => p.trim()).length >= 1;
    if (step === 5) return true;
    return false;
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const v = await generateVoices(answers, config);
      setGenerated(v);
      setEditedX(v.voice_x);
      setEditedLinkedIn(v.voice_linkedin);
      setStep(6);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <header class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 class="text-sm font-semibold text-zinc-100">Voice Creator</h2>
            <p class="text-[10px] text-zinc-500">
              {step < 6
                ? `Passo ${step} de 5 — voz X + LinkedIn geradas automaticamente`
                : "Preview — edite antes de aplicar"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            class="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Fechar"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div class="max-h-[70vh] overflow-y-auto px-4 py-4">
          {step === 1 && <StepWork value={answers.work} onChange={(v) => setAnswers({ ...answers, work: v })} />}
          {step === 2 && (
            <StepList
              title="Temas recorrentes"
              hint="3-5 temas que suas replies quase sempre tocam."
              placeholder="ex: politica monetaria, cripto/DeFi, macro brasileira"
              values={answers.themes}
              onChange={(v) => setAnswers({ ...answers, themes: v })}
              minRequired={2}
            />
          )}
          {step === 3 && (
            <StepList
              title="Referencias que voce cita"
              hint="3-5 empresas, papers, personagens que aparecem naturalmente."
              placeholder="ex: BIS, Zoltan Pozsar, Circle, Tether"
              values={answers.references}
              onChange={(v) => setAnswers({ ...answers, references: v })}
              minRequired={2}
            />
          )}
          {step === 4 && (
            <StepList
              title="Anti-padroes"
              hint="3 coisas que voce NUNCA escreve (formatos, tons, expressoes)."
              placeholder="ex: emoji ostensivo, saudacoes formais, hashtags"
              values={answers.antiPatterns}
              onChange={(v) => setAnswers({ ...answers, antiPatterns: v })}
              minRequired={1}
            />
          )}
          {step === 5 && (
            <StepTone
              tone={answers.tone}
              onChange={(tone) => setAnswers({ ...answers, tone })}
            />
          )}
          {step === 6 && generated && (
            <StepPreview
              editedX={editedX}
              editedLinkedIn={editedLinkedIn}
              onChangeX={setEditedX}
              onChangeLinkedIn={setEditedLinkedIn}
              onRegenerate={handleGenerate}
              regenerating={generating}
            />
          )}
          {error && (
            <p class="mt-3 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300">
              {error}
            </p>
          )}
        </div>

        <footer class="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
          {step > 1 && step < 6 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              class="text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              voltar
            </button>
          ) : (
            <span />
          )}
          {step < 5 && (
            <button
              type="button"
              disabled={!canAdvance()}
              onClick={() => setStep((s) => (s + 1) as Step)}
              class="rounded bg-sky-500 px-3 py-1.5 text-[11px] font-medium text-white disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              proximo
            </button>
          )}
          {step === 5 && (
            <button
              type="button"
              disabled={generating}
              onClick={handleGenerate}
              class="rounded bg-emerald-500 px-3 py-1.5 text-[11px] font-medium text-white disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {generating ? "gerando..." : "gerar vozes"}
            </button>
          )}
          {step === 6 && (
            <div class="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onApply({ voice_x: editedX })}
                class="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-200 hover:bg-sky-500/20"
              >
                so X
              </button>
              <button
                type="button"
                onClick={() => onApply({ voice_linkedin: editedLinkedIn })}
                class="rounded border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-[10px] font-medium text-indigo-200 hover:bg-indigo-500/20"
              >
                so LinkedIn
              </button>
              <button
                type="button"
                onClick={() => onApply({ voice_x: editedX, voice_linkedin: editedLinkedIn })}
                class="rounded bg-emerald-500 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-400"
              >
                aplicar ambas
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}

function StepWork({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label class="mb-1 block text-xs font-medium text-zinc-200">Descreve teu trabalho</label>
      <p class="mb-2 text-[10px] text-zinc-500">
        1-2 frases: area, seniority, mercado. Ex: "analista macro em Sao Paulo,
        cobrindo BCB e Fed, foco em curva de juros e cripto."
      </p>
      <textarea
        value={value}
        onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
        rows={4}
        class="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
      />
      <p class="mt-1 text-[10px] text-zinc-500">{value.trim().length} chars (min 10)</p>
    </div>
  );
}

function StepList({
  title,
  hint,
  placeholder,
  values,
  onChange,
  minRequired,
}: {
  title: string;
  hint: string;
  placeholder: string;
  values: string[];
  onChange: (v: string[]) => void;
  minRequired: number;
}) {
  const setAt = (i: number, v: string) => {
    const copy = [...values];
    copy[i] = v;
    onChange(copy);
  };
  const addRow = () => onChange([...values, ""]);
  const removeAt = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const filled = values.filter((v) => v.trim()).length;
  return (
    <div>
      <label class="mb-1 block text-xs font-medium text-zinc-200">{title}</label>
      <p class="mb-2 text-[10px] text-zinc-500">{hint}</p>
      <div class="space-y-1.5">
        {values.map((v, i) => (
          <div key={i} class="flex gap-1.5">
            <input
              type="text"
              value={v}
              placeholder={placeholder}
              onInput={(e) => setAt(i, (e.currentTarget as HTMLInputElement).value)}
              class="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
            />
            {values.length > minRequired && (
              <button
                type="button"
                onClick={() => removeAt(i)}
                class="rounded px-2 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                aria-label="Remover"
              >
                x
              </button>
            )}
          </div>
        ))}
      </div>
      {values.length < 5 && (
        <button
          type="button"
          onClick={addRow}
          class="mt-1.5 text-[10px] text-sky-400 hover:text-sky-300"
        >
          + adicionar
        </button>
      )}
      <p class="mt-1 text-[10px] text-zinc-500">
        {filled}/{values.length} preenchidos (min {minRequired})
      </p>
    </div>
  );
}

function StepTone({
  tone,
  onChange,
}: {
  tone: VoiceCreatorAnswers["tone"];
  onChange: (t: VoiceCreatorAnswers["tone"]) => void;
}) {
  const dims: Array<{ key: keyof VoiceCreatorAnswers["tone"]; left: string; right: string }> = [
    { key: "formal", left: "coloquial", right: "formal" },
    { key: "technical", left: "generalista", right: "tecnico" },
    { key: "provocative", left: "medido", right: "provocativo" },
    { key: "analytical", left: "intuitivo", right: "analitico" },
  ];
  return (
    <div>
      <label class="mb-1 block text-xs font-medium text-zinc-200">Tom da voz</label>
      <p class="mb-3 text-[10px] text-zinc-500">
        Ajuste onde voce se posiciona em cada dimensao (1-5).
      </p>
      <div class="space-y-3">
        {dims.map((d) => (
          <div key={d.key}>
            <div class="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
              <span>{d.left}</span>
              <span class="tabular-nums text-zinc-300">{tone[d.key]}/5</span>
              <span>{d.right}</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={tone[d.key]}
              onInput={(e: JSX.TargetedEvent<HTMLInputElement>) =>
                onChange({ ...tone, [d.key]: Number((e.currentTarget as HTMLInputElement).value) })
              }
              class="w-full accent-sky-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function StepPreview({
  editedX,
  editedLinkedIn,
  onChangeX,
  onChangeLinkedIn,
  onRegenerate,
  regenerating,
}: {
  editedX: string;
  editedLinkedIn: string;
  onChangeX: (v: string) => void;
  onChangeLinkedIn: (v: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  return (
    <div class="space-y-3">
      <div>
        <label class="mb-1 flex items-center justify-between text-xs font-medium text-sky-300">
          <span>Voz X</span>
          <span class="text-[10px] text-zinc-500 tabular-nums">{editedX.length} chars</span>
        </label>
        <textarea
          value={editedX}
          onInput={(e) => onChangeX((e.currentTarget as HTMLTextAreaElement).value)}
          rows={6}
          class="w-full rounded border border-sky-500/30 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-sky-500 focus:outline-none"
        />
      </div>
      <div>
        <label class="mb-1 flex items-center justify-between text-xs font-medium text-indigo-300">
          <span>Voz LinkedIn</span>
          <span class="text-[10px] text-zinc-500 tabular-nums">{editedLinkedIn.length} chars</span>
        </label>
        <textarea
          value={editedLinkedIn}
          onInput={(e) => onChangeLinkedIn((e.currentTarget as HTMLTextAreaElement).value)}
          rows={6}
          class="w-full rounded border border-indigo-500/30 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenerating}
        class="text-[10px] text-zinc-400 underline underline-offset-2 hover:text-zinc-200 disabled:opacity-50"
      >
        {regenerating ? "regerando..." : "regerar com as mesmas respostas"}
      </button>
    </div>
  );
}

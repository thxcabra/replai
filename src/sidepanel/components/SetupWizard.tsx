import { useState } from "preact/hooks";
import {
  AuthCancelledError,
  AuthNotConfiguredError,
  DomainNotAllowedError,
  signIn,
} from "../../lib/auth";
import type { ProfileRow } from "../../lib/supabase-types";

interface Props {
  step: "login" | "keys";
  profile: ProfileRow | null;
  userEmail: string | null;
  onSignedIn: () => void;
  onKeysSaved: (keys: {
    twitterapi_key: string;
    gemini_api_key: string;
    anthropic_api_key: string;
  }) => Promise<void>;
  onSkipKeys: () => void;
}

// Setup wizard pra primeiro uso (logado mas profile.setup_complete=false).
// Dois steps: login Google, depois colar chaves. Chaves podem ser puladas
// (Settings tem os mesmos inputs e o analista pode preencher depois).
export function SetupWizard({
  step,
  profile,
  userEmail,
  onSignedIn,
  onKeysSaved,
  onSkipKeys,
}: Props) {
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geminiKey, setGeminiKey] = useState(profile?.gemini_api_key ?? "");
  const [anthropicKey, setAnthropicKey] = useState(
    profile?.anthropic_api_key ?? ""
  );
  const [saving, setSaving] = useState(false);

  async function handleLogin() {
    setError(null);
    setSigning(true);
    try {
      await signIn();
      onSignedIn();
    } catch (e) {
      if (e instanceof AuthCancelledError) {
        setError("login cancelado.");
      } else if (e instanceof AuthNotConfiguredError) {
        setError(
          "Supabase nao configurado neste build. Avise o admin que falta VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."
        );
      } else if (e instanceof DomainNotAllowedError) {
        setError(
          "acesso restrito ao time @moicdigital. use o email da empresa pra logar."
        );
      } else {
        setError(`erro no login: ${(e as Error).message ?? e}`);
      }
    } finally {
      setSigning(false);
    }
  }

  async function handleSaveKeys() {
    setError(null);
    setSaving(true);
    try {
      await onKeysSaved({
        twitterapi_key: "",
        gemini_api_key: geminiKey.trim(),
        anthropic_api_key: anthropicKey.trim(),
      });
    } catch (e) {
      setError(`erro salvando chaves: ${(e as Error).message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-600";
  const labelCls = "mb-1 block text-xs font-medium text-zinc-400";
  const linkCls = "text-sky-400 hover:underline";

  if (step === "login") {
    return (
      <div class="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 class="text-2xl font-bold text-zinc-100">Replai</h1>
        <p class="max-w-xs text-sm text-zinc-400">
          login com sua conta Google pra sincronizar workspaces, personas e
          chaves entre devices.
        </p>
        <button
          onClick={handleLogin}
          disabled={signing}
          class="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {signing ? "abrindo popup do Google..." : "login com Google"}
        </button>
        {error && (
          <div class="max-w-xs rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>
    );
  }

  // step === "keys"
  return (
    <div class="flex flex-col gap-4 p-3">
      <div>
        <h2 class="text-sm font-semibold text-zinc-200">
          Bem-vindo ao Replai
        </h2>
        {userEmail && (
          <p class="mt-0.5 text-xs text-zinc-500">logado como {userEmail}</p>
        )}
        <p class="mt-2 text-xs text-zinc-400">
          cole suas chaves de API. elas sao salvas no seu profile e sincronizam
          entre devices automaticamente. voce pode pular agora e preencher
          depois em settings.
        </p>
      </div>

      <div>
        <label class={labelCls}>
          Chave Gemini API{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            class={linkCls}
          >
            (obter aqui - free tier)
          </a>
        </label>
        <input
          type="password"
          class={inputCls}
          placeholder="AIza..."
          value={geminiKey}
          onInput={(e) => setGeminiKey((e.target as HTMLInputElement).value)}
        />
      </div>

      <div>
        <label class={labelCls}>
          Chave Anthropic API{" "}
          <a
            href="https://console.anthropic.com"
            target="_blank"
            rel="noreferrer"
            class={linkCls}
          >
            (obter aqui - pago, opcional)
          </a>
        </label>
        <input
          type="password"
          class={inputCls}
          placeholder="sk-ant-..."
          value={anthropicKey}
          onInput={(e) => setAnthropicKey((e.target as HTMLInputElement).value)}
        />
      </div>

      {error && (
        <div class="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div class="flex gap-2">
        <button
          onClick={handleSaveKeys}
          disabled={saving}
          class="flex-1 rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? "salvando..." : "salvar e continuar"}
        </button>
        <button
          onClick={onSkipKeys}
          disabled={saving}
          class="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          pular
        </button>
      </div>

      <div class="text-[10px] text-zinc-500">
        seguranca: chaves vivem no seu profile do Supabase (RLS impede outros
        usuarios de ver). nunca aparecem em URL, log ou export.
      </div>

      {/* V5.2: hint pro Voice Creator — apos salvar chaves, a proxima friccao
          e escrever a voz do zero. O botao "criar voz automatica" resolve isso. */}
      <div class="rounded border border-violet-500/30 bg-violet-500/10 px-2.5 py-2 text-[11px] text-violet-200">
        <span class="font-semibold">Dica:</span> apos salvar, va em Settings &gt;
        Voz e clique <span class="font-mono">"criar voz automatica"</span> — o
        Voice Creator gera as vozes X + LinkedIn a partir de 5 perguntas.
      </div>
    </div>
  );
}

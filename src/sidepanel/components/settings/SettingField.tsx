// V5.0.4 — Wrapper de campo individual em Settings.
//
// Padroniza label + input + help text + error inline. Substitui o padrao
// atual onde cada campo repete inline:
//   <label class={labelCls}>Nome do campo</label>
//   <input class={inputCls} ... />
//   <p class="mt-1 text-[10px] text-zinc-400">help</p>
//
// UX principios (skill /ui-ux-pro-max):
// - form-labels: label sempre visivel (nao placeholder-only)
// - error-clarity: erro proximo do campo, aria-invalid + aria-describedby
// - required-indicators: asterisco vermelho pra campos obrigatorios
// - contrast: help-text zinc-400 tem >4.5:1 sobre bg-zinc-900

import type { JSX, ComponentChildren } from "preact";

interface Props {
  /** Texto do label — sempre visivel */
  label: string;
  /** ID do input filho (associacao label pra tecnologia assistiva) */
  htmlFor: string;
  /** Marca como obrigatorio (asterisco visivel + aria-required) */
  required?: boolean;
  /** Explicacao inline abaixo do input. Formato recomendado: "O que faz. Ex: Y." */
  help?: string;
  /** Estado de erro — string vazia ou null = sem erro */
  error?: string | null;
  /** Elemento a direita do label (ex: contador de chars, link "obter aqui") */
  labelAdornment?: ComponentChildren;
  children: ComponentChildren;
}

export function SettingField({
  label,
  htmlFor,
  required = false,
  help,
  error,
  labelAdornment,
  children,
}: Props): JSX.Element {
  const helpId = help ? `${htmlFor}-help` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label
        for={htmlFor}
        class="mb-1 flex items-baseline justify-between gap-2 text-xs font-medium text-zinc-300"
      >
        <span>
          {label}
          {required && (
            <span
              aria-label="obrigatorio"
              class="ml-0.5 text-red-400"
            >
              *
            </span>
          )}
        </span>
        {labelAdornment && (
          <span class="text-[10px] text-zinc-500">{labelAdornment}</span>
        )}
      </label>
      {/* Passa aria-describedby pro filho via contexto de attrs.
          Convencao: o filho ja tem `id={htmlFor}` e vai receber aria-describedby por props. */}
      <div aria-describedby={describedBy}>{children}</div>
      {help && (
        <p
          id={helpId}
          class="mt-1 text-[10px] leading-snug text-zinc-500"
        >
          {help}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          class="mt-1 text-[10px] leading-snug text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}

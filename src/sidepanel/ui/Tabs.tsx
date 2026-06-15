import type { ComponentChildren } from "preact";

interface Tab {
  id: string;
  label: string;
  badge?: string | number;
}

interface Props {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  children: ComponentChildren;
}

// Tabs simples horizontais. Suporta badge numerico/textual. Acessivel via
// role="tablist"/"tab"/"tabpanel". Pra ate ~6 tabs cabem em 376px.
export function Tabs({ tabs, active, onChange, children }: Props) {
  return (
    <div class="flex flex-col">
      <div
        role="tablist"
        aria-label="abas"
        class="flex overflow-x-auto border-b border-zinc-800"
      >
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${t.id}`}
              id={`tab-${t.id}`}
              onClick={() => onChange(t.id)}
              class={[
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "border-sky-500 text-sky-300"
                  : "border-transparent text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200",
              ].join(" ")}
            >
              {t.label}
              {t.badge !== undefined && (
                <span
                  class={[
                    "rounded px-1 text-[10px] tabular-nums",
                    isActive
                      ? "bg-sky-500/20 text-sky-200"
                      : "bg-zinc-700/60 text-zinc-300",
                  ].join(" ")}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`tabpanel-${active}`}
        aria-labelledby={`tab-${active}`}
      >
        {children}
      </div>
    </div>
  );
}

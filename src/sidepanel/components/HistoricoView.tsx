import { useState } from "preact/hooks";
import type { ProfileRow } from "../../lib/supabase-types";
import type { Workspace } from "../../lib/types";
import { Tabs } from "../ui/Tabs";
import { Button } from "../ui/Button";
import { Dashboard } from "./Dashboard";
import { MyRepliesView } from "./MyRepliesView";

interface Props {
  workspace: Workspace;
  profile: ProfileRow | null;
  initialTab?: "atividade" | "replies";
  onClose: () => void;
}

// V4.1.5 — UI/UX refactor: wrapper que consolida "atividade" (Dashboard)
// + "meus replies" (MyRepliesView) numa unica view com sub-tabs internas.
//
// Reduz a quantidade de botoes top-level no Header (6 → 4), agrupando
// conceitos relacionados ("o que eu ja fiz") sob uma intencao unica.
// Skill UI UX Pro Max: nav <=5, agrupar por intencao, predictable back.
export function HistoricoView({
  workspace,
  profile,
  initialTab = "atividade",
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<"atividade" | "replies">(
    initialTab
  );

  const tabs = [
    { id: "atividade", label: "atividade" },
    { id: "replies", label: "meus replies" },
  ];

  return (
    <div class="flex min-h-screen flex-col">
      {/* HEADER sticky com close global da view */}
      <div class="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-zinc-800 bg-[color:var(--color-bg-base)]/95 px-3 py-2.5 backdrop-blur">
        <div class="min-w-0">
          <h2 class="text-sm font-bold text-zinc-100">historico</h2>
          <p class="truncate text-[11px] text-zinc-500">
            o que voce ja fez neste e em outros workspaces
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          fechar
        </Button>
      </div>

      <Tabs
        tabs={tabs}
        active={activeTab}
        onChange={(id) => setActiveTab(id as "atividade" | "replies")}
      >
        {activeTab === "atividade" && (
          <Dashboard
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            // Dashboard ja tem seu proprio botao "fechar" — passamos onClose=noop
            // pra suprimir, ja que o close de cima resolve.
            onClose={() => {}}
            embedded
          />
        )}
        {activeTab === "replies" && (
          <MyRepliesView
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            // MyRepliesView ja tem header proprio — passamos onClose=noop tambem.
            onClose={() => {}}
            embedded
            profile={profile}
          />
        )}
      </Tabs>
    </div>
  );
}

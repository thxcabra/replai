// V6 — Analytics LinkedIn embrulhado em ViewShell.
//
// Antes de V6: LinkedInAdminPanel existia mas ficava orfao (nunca importado).
// V6 formaliza como tab "Analytics" quando canal ativo === LinkedIn.
//
// Renderer stateless — passa workspace_id opcional. Sem workspace_id vai
// mostrar agregado do time (admin only) — pero admin do time e feito pelo
// AdminPanel geral, entao aqui sempre passamos workspace.id.

import type { JSX } from "preact";
import type { Workspace } from "../../../lib/types";
import { ViewShell } from "../../ui/ViewShell";
import { LinkedInAdminPanel } from "./LinkedInAdminPanel";

interface Props {
  workspace: Workspace;
  onBack: () => void;
}

export function LinkedInAnalyticsView({
  workspace,
  onBack,
}: Props): JSX.Element {
  return (
    <ViewShell
      title="Analytics LinkedIn"
      subtitle="custo de coleta + mapa de impacto do workspace"
      channel="linkedin"
      onBack={onBack}
    >
      <div class="p-3">
        <LinkedInAdminPanel workspaceId={workspace.id} />
      </div>
    </ViewShell>
  );
}

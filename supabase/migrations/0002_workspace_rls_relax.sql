-- 0002_workspace_rls_relax.sql
-- Fix: analistas nao-admin batiam em "new row violates row-level security
-- policy (USING expression) for table 'workspaces'" no primeiro createWorkspace
-- pos-login. Causa provavel: race entre handle_new_user trigger e o primeiro
-- pushWorkspace (auth.uid() podia retornar NULL no contexto da request).
--
-- Defesa em profundidade: torna a check explicita sobre auth.uid() != null.
-- Sem isso, NULL = user_id avalia silenciosamente e a RLS rejeita.

drop policy if exists "workspaces insert own" on public.workspaces;
create policy "workspaces insert own" on public.workspaces
  for insert with check (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );

-- Mesma defesa em UPDATE: previne race em handleRenameWorkspace + saveWorkspace
-- onde auth.uid() retorne NULL transitoriamente.
drop policy if exists "workspaces update own or admin" on public.workspaces;
create policy "workspaces update own or admin" on public.workspaces
  for update using (
    (select auth.uid()) is not null
    and (user_id = (select auth.uid()) or public.is_admin())
  )
  with check (
    (select auth.uid()) is not null
    and (user_id = (select auth.uid()) or public.is_admin())
  );

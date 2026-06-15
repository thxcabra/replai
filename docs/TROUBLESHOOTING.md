# Troubleshooting — Replai

Erros comuns + fixes. Quando travar, vem aqui antes de pingar o admin.

## Login

### "login cancelado." apos clicar "login com Google"

Causas mais provaveis:
1. **Extension ID mudou** e a redirect URL no Supabase nao bate. Comum quando voce remove + re-instala a extension. Avisa o admin pra atualizar a URL Configuration no Supabase.
2. **Voce fechou o popup do Google** antes de completar (mensagem real)
3. **OAuth Consent Screen** desconfigurado (so admin resolve)

**Pra debugar voce mesmo**: right-click no side panel → Inspect → aba Console. Logs `[auth]` mostram qual URL foi tentada e qual erro.

### "Acesso restrito ao dominio @moicdigital"

Voce ta logando com Google que nao e do dominio da empresa. Use teu @moicdigital, nao Gmail pessoal.

### Login funcionou mas vejo tela vazia

DevTools → Application → Local Storage → procura `is_admin_cached` → deleta. Recarrega o side panel. Cache de 5min as vezes serve dado stale.

## Workspaces

### Workspace some apos logout + login

Era bug em V3 ja resolvido em V4. Se ainda acontece:
1. Confere no Supabase SQL Editor: `select * from public.workspaces where user_id = (select id from auth.users where email = 'you@example.com');`
2. Se aparece row → bug local, recarrega extension (`chrome://extensions` → reload no card)
3. Se nao aparece row → workspace nunca foi salvo no cloud, problema de sync. Abre DevTools console → re-cria workspace → ve logs `[storage] cloud pushWorkspace OK`

### "Sync falhou em 'X': ..." (banner vermelho)

Mensagem mostra qual operacao falhou e o erro real do Supabase. Comuns:
- **"Cannot coerce the result to a single JSON object"**: profile do user nao existe. Rodar backfill SQL em [ADMIN.md](./ADMIN.md)
- **JWT expired**: re-login resolve
- **Network**: tenta de novo daqui a pouco

## Chaves de API / LLM

### Replies nao geram (ou "rodou em dry-run...")

Provavelmente sem chave de Gemini configurada. Settings → expande "chaves de API e modelo" → confirma que campo Gemini tem valor.

**Importante (V4+)**: chaves vivem no profile, valem pra TODOS os workspaces. Nao precisa configurar por workspace.

### Chaves somem apos reload da extension

Era bug ja resolvido. Se ainda acontece:
1. DevTools → console → busca `[storage] cloud pullAll fetched` → ve `profile_has_gemini: true`?
2. Se `false`: chave nunca chegou no profile. Re-cola e salva. Confere logs `[storage] cloud pushProfile`
3. Se `true`: chave no profile mas UI nao mostra. Reload do side panel (fecha + abre)

## Atualizar / triagem

### "Atualizar" nao traz nada

- Confere se a Lista do X no campo `listId` ainda existe e e publica
- Verifica chave TwitterAPI (Settings → expande "chaves" — `VITE_TWITTERAPI_KEY` no .env do build)
- Pode ser que nada novo passou no prefilter (janela de tempo curta + idiomas restritos)
- Aumenta `maxBatch` se queue ta pequena demais

### "Gerar replies" trava em loading infinito

- DevTools console → busca `[replai] LLM call ...` — apareceu?
  - Se nao: bug local, reload extension
  - Se sim mas trava: provider ta lento ou rate-limited. Espera 1min, tenta de novo.
- Se persistir, troca provider (Gemini → Anthropic) em Settings

### Replies geradas mas card vazio ("nenhuma reply gerada")

A skill descartou o tweet via anti-padrao semantico. Isso e by design.

## Dialog de confirmacao

### Postei mas a reply nao apareceu como "verificada" no admin

Sem URL colada no campo, conta como "auto-report" (posted_confirmed=true mas posted_reply_id=null). Pra contar como verificada, na proxima vez:
1. Volta no X apos postar
2. "..." na reply → "Copy link to post"
3. Cola no campo destacado do dialog
4. Confirma

## Admin panel

### Nao vejo o botao "admin" no Header

Voce nao tem role admin. Peca pro admin atual te promover via Header → admin → analistas → click no teu card → "promover a admin".

Apos promocao, recarrega o side panel (cache de 5min). Se urgente: DevTools → Local Storage → deleta `is_admin_cached`.

### Click no analista nao expande

Pode ser cache stale do build antigo. `chrome://extensions` → reload no card. Confere versao do manifest no card (deve ser 0.4.0+).

## Performance

### Side panel demora pra abrir

Primeira abertura apos login pulla tudo do Supabase. Normal (~1-2s). Subsequentes devem ser instantaneas (cache).

### Extension fica lenta com muitos workspaces

Hoje todos workspaces sao carregados no boot. Se voce tem >20 workspaces, considera deletar os que nao usa mais.

## Quando nada funcionar

1. **Logout** (Settings → "sair") → **Login** novamente
2. Se persistir: `chrome://extensions` → reload no card
3. Se persistir: remover extension + load unpacked de novo (gera ID novo — admin precisa atualizar Supabase URL Config)
4. Se persistir: ping no admin com:
   - Print do banner de erro (se houver)
   - Logs do DevTools console (right-click → Inspect → Console → copia tudo)
   - Versao da extension (chrome://extensions → card Replai)
   - Email do teu @moicdigital

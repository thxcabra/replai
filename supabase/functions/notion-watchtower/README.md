# Edge Function: notion-watchtower

Proxy server-side pro Notion API. Mantem o token Notion FORA do client da
extensao — impossivel extrair via DevTools, `.crx` download ou inspecao CWS.

## Por que existe

Em V4.1.5/6 o token Notion vinha embutido no JS bundle. Funcionava, mas
era tecnicamente extraivel. V4.1.7 movimentou pra Supabase secrets +
Edge Function proxy. Beneficios:

- Token Notion **nunca** aparece no client
- Rotacao trivial: `supabase secrets set NOTION_API_TOKEN=novo` (sem
  rebuild + redistribute da extension)
- `api.notion.com` removido do `host_permissions` (zero permission extra
  pro reviewer CWS questionar)
- Validacao do dominio de email permitido (`ALLOWED_EMAIL_DOMAIN`) server-side (defesa em profundidade
  alem das RLS policies)

## Deploy (1x)

Pre-requisito: [Supabase CLI](https://supabase.com/docs/guides/cli) instalado
e linked ao projeto Replai (`supabase link --project-ref <project-ref>`).

```bash
# 1. set secrets (token + page ID default)
supabase secrets set \
  NOTION_API_TOKEN=ntn_xxx \
  WATCHTOWER_PAGE_ID=<32-hex-page-id> \n  ALLOWED_EMAIL_DOMAIN=moicdigital   # opcional, default moicdigital

# 2. deploy a function (--no-verify-jwt pq validamos auth manualmente
#    com check de dominio)
supabase functions deploy notion-watchtower --no-verify-jwt
```

Verifica:
```bash
supabase secrets list   # deve listar NOTION_API_TOKEN + WATCHTOWER_PAGE_ID
supabase functions list # deve listar notion-watchtower (deployed)
```

## Rotacionar o token (futuro)

Quando precisar trocar:

```bash
# 1. cria token novo em https://www.notion.so/profile/integrations
# 2. atualiza secret
supabase secrets set NOTION_API_TOKEN=ntn_novo_xxx

# 3. revoga o antigo no Notion (Refresh secret na integration)
```

Zero rebuild da extension, zero redistribute. A function pega o secret
novo no proximo cold start (~segundos).

## Como o client chama

```ts
import { supabase } from "./supabase";

const { data, error } = await supabase.functions.invoke("notion-watchtower", {
  body: { pageId: "..." }, // opcional, omite pra usar default
});
// data = { pageId, title, matched_by, text, fetched_at }
```

Auth e automatico: `supabase.functions.invoke` injeta o JWT do user logado.
A function valida o JWT, confirma o dominio permitido, e so entao chama
Notion API com o secret server-side.

## Quem pode chamar

Filtro em camadas:

1. **Sem JWT** → 401 ("missing authorization")
2. **JWT invalido** → 401 ("invalid jwt")
3. **JWT valido mas email fora do `ALLOWED_EMAIL_DOMAIN`** → 403 ("domain not allowed")
4. **JWT valido + dominio OK** → executa

(O frontend + trigger Supabase ja impedem cadastro de outros dominios; este
check e defesa em profundidade pra Edge Function.)

## Custos

- Edge Function: free tier Supabase = 500k invocations/mes. 5 analistas
  rodando aba Posts 10x/dia = 1500/mes. Bem abaixo do limite.
- Notion API: free, sem rate limit pra Internal Integrations dentro de
  uso razoavel.

## Logs

```bash
supabase functions logs notion-watchtower --tail
```

Erros (notion fetch falhou, etc) aparecem aqui pra debug.

# Instalacao manual — enquanto a Web Store nao aprova

Esse doc e pra quem quer rodar a versao mais recente do Replai SEM aguardar a aprovacao da Chrome Web Store. Util quando o time tem urgencia em testar uma feature nova.

**Importante:** essa instalacao "side-loaded" e identica em comportamento a versao publicada. Quando a Web Store aprovar, voce pode desinstalar a versao manual e instalar pela loja (o ID e o mesmo — `lhoachajfmnfabhcmjkibijjcdbmgjll` — entao seu login e seus workspaces nao se perdem).

---

## 1. Pegar o `.zip` da versao

Tem duas formas:

### Forma A — release oficial do repositorio
1. Acesse o GitHub interno do time
2. Va em **Releases**
3. Baixe o arquivo `replai-vX.Y.Z.zip` da release mais recente
4. Extraia em uma pasta qualquer (anota o caminho)

### Forma B — build local (se voce e dev)
```bash
git clone <repo-url>
cd replai
npm install
npm run build
```

A pasta `dist/` que sai do build e o que voce vai carregar no Chrome.

---

## 2. Carregar no Chrome

1. Abre o Chrome
2. Vai em `chrome://extensions`
3. Liga o toggle **modo do desenvolvedor** (canto superior direito)
4. Clica em **Carregar sem compactacao**
5. Seleciona a pasta `dist/` (ou a pasta onde voce extraiu o `.zip`)
6. A extensao aparece com o icone verde do Replai

---

## 3. Fixar e abrir

1. Clica no quebra-cabeca (puzzle) no toolbar do Chrome
2. Acha "Replai"
3. Clica no alfinete pra fixar
4. Clica no icone do Replai → side panel abre

---

## 4. Login funciona normalmente

O ID da extensao instalada manualmente e **identico** ao da versao publicada (porque temos um `key` field hardcoded no manifest com a chave publica oficial do Chrome Web Store).

Isso significa:
- O OAuth do Google reconhece a extensao
- Voce loga com `@moicdigital.com.br` normalmente
- Seus workspaces e dados sao os mesmos da versao publicada (mesmo Supabase)

Se der erro de "Authorization page could not be loaded", fala com o Cabral — provavelmente o `key` field foi removido por engano em algum build.

---

## 5. Atualizar manualmente

Cada vez que sair uma versao nova:
1. Baixa o novo `.zip` ou roda `npm run build` de novo
2. Vai em `chrome://extensions`
3. Acha o Replai
4. Clica no botao de **recarregar** (a setinha circular) — o Chrome substitui o conteudo da pasta

Voce NAO precisa remover e adicionar de novo. So recarregar.

---

## 6. Voltar pra versao da Web Store quando aprovar

Quando a Web Store aprovar a versao nova:
1. Vai em `chrome://extensions`
2. Acha o Replai (manual)
3. Clica em **Remover**
4. Instala pela Chrome Web Store normalmente

Login, workspaces, replies, tudo persiste — porque vivem no Supabase, nao no chrome.storage local da extensao.

---

## 7. Notas sobre seguranca

A versao manual tem exatamente o mesmo codigo que a publicada:
- Mesma extension ID
- Mesmas chaves embedadas (so as publicas — chaves privadas vivem em Supabase secrets, nunca no client)
- Mesmas permissoes no manifest

O unico "extra" da pasta `dist/` e o arquivo `manifest.json` com o `key` field — necessario pra o Chrome reconhecer que essa extensao tem o mesmo ID da publicada. **Nao remova esse field**, senao o OAuth quebra.

Se voce fez build local com `npm run build`, o `key` vem junto. Se fez `npm run build:cws:win` ou `:unix`, o `key` e stripped (so usar pra upload no Chrome Web Store, NUNCA pra instalar manualmente).

---

## 8. Troubleshooting

| sintoma | acao |
|---|---|
| icone nao aparece no toolbar | clica no quebra-cabeca → alfinete |
| "manifest invalid" no carregar | conferir se voce selecionou a pasta `dist/`, nao a raiz do repo |
| OAuth nao abre | conferir que o `key` field esta no `manifest.json` da pasta carregada |
| extensao some apos restart do Chrome | normal pra `Carregar sem compactacao` se voce mudou a pasta de lugar — carrega de novo |
| versao da Web Store conflita com manual | desinstala uma das duas (recomendo manter so a Web Store quando aprovar) |

Mais detalhes em [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

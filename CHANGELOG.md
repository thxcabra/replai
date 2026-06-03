# Changelog

Notas das mudanças por sessão de trabalho. Versão mais recente primeiro.

---

## 2026-06-01, release multi-analista

Essa sessão tirou o Replai do modo "POC pessoal" e deixou ele pronto pra **uso simultâneo por vários analistas**, cada um com seu contexto isolado. Quem usava antes não perde nada, a configuração atual vira automaticamente um workspace "Default" no primeiro carregamento.

### Workspaces

Você agora consegue ter **vários contextos isolados** dentro da mesma extensão. Cada workspace é uma "caixa" com sua própria Lista do X, chaves de API, persona, CSV de grafo e histórico, totalmente independentes.

- Trocar entre workspaces pelo dropdown no header. Tudo muda junto: configurações, replies geradas, marcações.
- Criar workspace novo (vazio ou duplicando um existente, útil pra testar variações de persona).
- **Exportar workspace** como arquivo JSON pra compartilhar com colegas ou fazer backup.
- **Importar workspace** a partir de um JSON exportado, cria um novo contexto pronto.
- Renomear e excluir, com confirmação inline.

**O que muda na prática:** um analista pode manter "Cliente A", "Cliente B" e "Teste de voz nova" como workspaces separados, alternando em um clique. Compartilhar uma config de cliente que funcionou bem com o time virou questão de mandar um arquivo.

### Persona / contexto customizado

Campo de texto livre no settings onde o analista descreve o ângulo que quer pras replies (ex: "sou VC de fintech, foco em B2B, priorize replies que citem fundadores que escalaram esse playbook").

- Influencia o conteúdo e os ângulos das replies sem mexer no código.
- Um badge **persona** aparece no header sempre que está ativa, pra ficar visível.
- A regra de idioma é **inviolável**: tweet em inglês recebe reply em inglês mesmo que a persona esteja escrita em português. Isso foi um detalhe sutil mas crítico, sem ele, o LLM puxava as replies pro idioma da persona.

**O que muda na prática:** dá pra moldar a voz por contexto sem precisar criar prompt novo. Testado ao vivo: persona "VC de fintech" trouxe referências a Hamilton Helmer / 7 Powers (livro real e relevante pro contexto), sem inventar dados.

### Provider de LLM trocável

Gemini 2.5 Flash virou o provider padrão (free tier, **1500 requisições/dia grátis**). Claude Sonnet 4.6 continua como alternativa paga, alternável por radio button nas configurações.

- Troca entre providers sem mexer no código nem rebuildar.
- Cada provider valida a chave certa antes de chamar.

**O que muda na prática:** começar a usar não custa nada, só a TwitterAPI. Quem quiser qualidade de Claude liga em um clique.

### Upload de CSV de grafo

Antes, atualizar o `node_metrics` (a tabela de ISV / POIs) significava trocar o arquivo no código e rebuildar. Agora dá pra subir **direto na interface**, por workspace.

- Aceita CSV padrão com cabeçalho `handle,isv,inferred_layer,is_poi`. Ordem das colunas livre.
- Preview antes de salvar mostrando as 5 primeiras linhas parseadas + contadores + erros visíveis.
- "Voltar pro bundled" se quiser cancelar e usar o grafo padrão de novo.
- O grafo bundled continua disponível como fallback (hoje 3057 handles, 14 POIs).

**O que muda na prática:** atualizar o grafo virou trabalho de UI. Cada analista pode ter um grafo próprio por workspace (cliente A com universo X, cliente B com universo Y).

### Quick test por URL

Seção "testar um tweet específico" no topo do painel: cola a URL de um tweet qualquer, gera replies só pra ele.

- Pula o filtro da Lista, o analista escolheu esse tweet a dedo.
- Roda com a persona ativa do workspace.
- Mesma TwitterAPI, mesmo LLM, mesmo cooldown.

**O que muda na prática:** acelera muito o loop de calibração de persona. Ao invés de esperar um tweet relevante aparecer na Lista pra ver como a reply sai, você cola um exemplo concreto e itera.

### Painel de tweets

- **Editar replies inline.** Cada reply é editável com contador de caracteres. As edições **persistem**: fechar e reabrir o painel mantém o que você escreveu (antes perdia tudo).
- **Marcar como respondido.** Botão em cada card. Tweet marcado fica esmaecido e vai pro final da lista, independente do critério de ordenação. Ajuda a navegar batches grandes (25 tweets) sem se perder.
- **Cooldown de 30 segundos** no botão "atualizar" depois de cada refresh, com contagem regressiva visível. Protege contra duplo-clique acidental, cada refresh gasta cota da TwitterAPI (que é paga).
- **Auto dry-run.** Se você não configurou chave de LLM nenhuma, o app **não dá erro**: roda o filtro e mostra os tweets que passariam, com mensagem explicando o que falta. Onboarding mais amigável.

### Distribuição

Três modos de build, escolhidos pelo cenário:

| Modo | O que embute | Pra quê |
|---|---|---|
| `build` | Todas as chaves do seu `env/.env` | Uso pessoal, dev |
| `build:team` | Só a chave da TwitterAPI | Distribuir pro time (TwitterAPI compartilhada, cada analista usa seu Gemini grátis) |
| `build:public` | Nenhuma chave | Distribuição totalmente externa |

**O que muda na prática:** mandar a extensão pra um analista virou uma operação simples e segura. Eles abrem, colam só a chave do Gemini deles (grátis), e estão prontos pra usar.

### Migração transparente

Quem já tinha a extensão instalada com configurações salvas **não perde nada** na primeira vez que carregar essa versão. A config antiga, o cache da última sessão e o grafo uploaded migram automaticamente pro workspace "Default". Sem ação necessária por parte do usuário.

### Robustez

- **Idioma das replies** virou regra inviolável, atrelada ao campo `lang` que vem por tweet. Resolve o bug em que o LLM (especialmente Gemini Flash com thinking off) puxava as replies pra língua dominante do prompt.
- **JSON schema** ajustado pro formato exato que o Gemini aceita, antes dava erro de validação em alguns casos.
- **Migração de storage** testada com cenários de upgrade, preserva config legada, é idempotente (rodar duas vezes não duplica nada).
- **Parser de CSV** tolerante: aceita aspas, BOM, CRLF, ordem livre de colunas, normaliza `@handle`, pula linhas com erro mostrando mensagem clara em vez de abortar tudo.

### Onde tem mais detalhe

- [docs/guia.md](docs/guia.md), **guia do analista**: referência de cada funcionalidade da extensão
- [README.md](README.md), visão completa de features, setup e distribuição
- [docs/briefing.md](docs/briefing.md), contexto original do projeto
- [docs/twitterapi-cost.md](docs/twitterapi-cost.md), análise de custo da TwitterAPI

---

### Resumo numa frase

De um POC com chaves hardcoded e configuração única pra **plataforma multi-analista** com workspaces isolados, persona customizável, upload de grafo na UI, quick test, edits persistentes, marcação de tweets respondidos, distribuição zipada em 78KB pronta pra o time abrir e usar.

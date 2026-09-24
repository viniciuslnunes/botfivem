# Contrato: regras de negócio invariantes

> São lições que já custaram caro. Cada uma tem a forma "nunca X" e um lugar no
> código que a cumpre. Antes de mudar um fluxo, ler as que o tocam. Histórico e
> exemplos completos: `docs/padroes.md` § 1.

## Dinheiro e escopo

- **Dinheiro é sempre o do jogo.** Não há Pix, gateway nem lei de rifas: rifa,
  loja, financeiro e caixa contam moeda do jogo.
- **Um servidor Discord = uma torcida.** Multi-torcida é *instância por
  cliente* (tenant), não hierarquia Sede/Subsede.

## Identidade do jogador

- **O ID do jogo troca a cada season.** "É a mesma pessoa entre períodos"
  correlaciona por **nome** normalizado (`estatisticas.normalizarBusca`,
  similaridade em `idsSemSocio`), com o ID só para exibir.
- **Nome nunca vai cru para o Discord**: `painelFormato.nomeSeguro` escapa o
  markdown que o jogo deixa passar.

## Estado e confiança no dado

- **Marcar "resolvido" só depois da ação ter funcionado.** Nada de gravar
  concluído antes de `setNickname`, DM ou INSERT confirmarem; em erro, deixa
  pendente e loga (bug real: associação marcada resolvida com falha).
- **Fonte de log parada não vira zero.** Acima de `fonteParadaDias` sem log de um
  tipo, o painel avisa (`painelFormato.avisoFonteParada`). Já um item individual
  velho dentro de fonte viva sai da visão de estado atual, mas o histórico
  **nunca é apagado**.
- **Categoria de origem confere antes de gravar.** Canal fora de
  `logsJogo.categoriaLogs` é recusado na sincronização e no INSERT.
- **Valor manual + automático convivem** (`docs/padroes.md` § 1.2–1.3): o
  painel mostra os dois. O ajuste automático só soma sobre baseline que a
  liderança já setou, sempre com `jsonb_set` atômico — nunca ler o objeto,
  somar em JS e gravar (webhook chega em rajada).

## Permissão

- **Permissão é conferida no handler**, nunca só escondendo botão/comando
  (`utils/permissoes.js`: `ehLideranca`, `ehPresidencia`).
- **Alerta avisa quem decide; não pune nem concede sozinho.** Automatizar a
  punição é decisão explícita de produto, com botão de atalho no alerta.
- **Liderança de área só publica no canal** (não é permissão nova).

## Discord

- **Ephemeral nasce no fim do canal**: botão fixo + listagem longa no mesmo canal
  esconde a resposta atrás de scroll — separar em canais ou deixar a mensagem de
  ação sempre por último.
- **Ao reeditar mensagem com imagem, mandar `attachments: []` junto com
  `files`**, senão o Discord empilha anexo a cada edição até parar de atualizar.
- **Edição manual = botão → select → modal de um campo** (nunca modal com vários
  campos).

## Operação e testes

- **Teste e script avulso nunca escrevem no banco real.** `npm test` roda só
  função pura ou PGlite em memória; scripts interceptam `utils/db.js` e
  **abortam** se a interceptação falhar (incidente de 2026-09-13). As
  ferramentas de `tools/` forçam um banco falso inalcançável.
- **Migração é só aditiva** (`IF NOT EXISTS`) e roda a cada start; cada tabela
  pertence a um módulo (`modulo:` em `utils/migracoes.js`).
- **Módulo desligado não deixa rastro** (comando, handler, painel, tabela).
- **Config é imutável em runtime** (`Object.freeze` profundo): o que a liderança
  edita mora em `bot_config` com chave própria, não no tenant.

## Ficha de recrutamento (estados)

- `PENDENTE` → `APROVADO` ou `REPROVADO`; a decisão é gravada com guarda no SQL
  (`WHERE status = 'PENDENTE'`) e só depois a mensagem é editada. Mensagem sem
  componentes = já analisada (é o que barra clique duplo).
- `REPROVADO` com `permite_reenvio = false` é **definitivo**; a liderança libera
  o reenvio (`fichas.liberarReenvio`) e o candidato manda **nova** ficha — a
  ficha antiga nunca volta a `PENDENTE`.
- Aprovar exige ID FiveM fora de "não recrutar"; falhou a ação → ficha continua `PENDENTE`.
- Coberto por `test/fluxos.gavioes.test.js`.

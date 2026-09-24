# Contrato: eventos canônicos (o que uma fonte de logs entrega)

> Quem manda: `fontes/contrato.js` (`ACOES_CANONICAS`, `CATEGORIAS_CANONICAS`,
> `validarRegistro`). Painéis e alertas só conhecem o **registro canônico**
> gravado em `logs_jogo`; nunca o texto do jogo. Cada servidor de jogo tem um
> adapter em `fontes/<id>/` (hoje: `hoolibras`) que traduz o webhook dele.

## Registro canônico

`parseRegistro(embed)` devolve sempre estes campos (use `null` quando não há):

| campo | tipo | nota |
|---|---|---|
| `acao` | texto | do vocabulário abaixo, ou `desconhecido` (nunca descartar) |
| `categoria` | texto ou null | agrupador (vem do rodapé do jogo ou da regra) |
| `atorNome`, `alvoNome` | texto ou null | |
| `atorIdFivem`, `alvoIdFivem` | dígitos ou null | **ID do jogo troca a cada season**: identidade de pessoa é por nome |
| `valor` | número ou null | dinheiro ou quantidade |
| `titulo`, `descricao` | texto ou null | já sem markdown/HTML e com mojibake corrigido |

A ingestão acrescenta `messageId`, `embedIndice`, `canalId`, `ocorridoEm` (hora
em que o webhook publicou = hora do evento) e `bruto` (o embed original, usado
para reprocessar o que era `desconhecido` quando o parser aprende regra nova).

**Contrato do baú (limitação conhecida):** o saldo por baú lê o nome do
compartimento entre colchetes do `titulo` ("Guardou [Baú Sócio]"). Uma fonte
precisa produzir esse título nas ações `bau_*`. Tirar isso da consulta SQL
exige uma coluna normalizada (fica como evolução).

## Como criar uma fonte nova

1. `fontes/<id>/index.js` exportando `{ id, nome, parseRegistro, nomePatrimonio }`
   (`id` = nome da pasta).
2. `fontes/<id>/amostras.json`: pares `{ embed, registro }` de **logs reais**
   (anonimizados) cobrindo cada ação que o servidor emite; amostra inventada
   leva `sintetica: true`.
3. Um teste como `test/fontes.test.js` para o adapter: cada amostra reproduz o
   registro, todo registro passa em `validarRegistro`.
4. `tenant.jogo.fonte = '<id>'`.

Ação nova só vira funcionalidade quando um painel/alerta a consome; até lá o
adapter pode usar `desconhecido` e reprocessar depois.

## Ações e quem as consome

| ação | categoria | consumida por |
|---|---|---|
| adv_finalizou | disciplina | analises |
| adv_removida | disciplina | analises, painelDisciplina, advertência automática |
| advertido | disciplina | analises, painelDisciplina, advertência automática, painelRecrutadores (recrutado com problema) |
| arena_bloqueou | patrimonio | painelFechaduras, painelHistorico |
| arena_desbloqueou | patrimonio | painelFechaduras, painelHistorico |
| banco_depositou | economia | painelCaixa, painelHistorico, repositório |
| banco_sacou | economia | alertas (saque grande), painelCaixa, painelHistorico |
| bau_guardou | bau | alertas, painelBau, painelFarm, advertência automática (pagamento) |
| bau_removeu | bau | alertas (retirada grande/suspeita), painelBau |
| blacklist_adicionou | restricao | analises (painelRestricoes), painelRecrutadores (recrutado com problema) |
| blacklist_removeu | restricao | analises |
| cargo_editado | config | só registro/consulta |
| coins_conquista | territorio | painelTerritorio, painelHistorico |
| coins_dominacao | territorio | painelTerritorio, painelHistorico |
| comprou_item | economia | repositório |
| comprou_roupa | economia | painelCaixa |
| config_alterou | config | só registro/consulta |
| convocou_equipe | lideranca | relatórios |
| dinheiro_adicionado | economia | painelCaixa |
| dinheiro_conquista | economia | painelCaixa |
| expulso_torcida | saida | analises, relatórios, retenção de recrutador |
| fechadura_destrancou | patrimonio | analises (painelFechaduras) |
| fechadura_trancou | patrimonio | analises (painelFechaduras) |
| honra_adicionada | economia | painelCaixa |
| honra_gastou | economia | painelCaixa |
| impedimento_adicionou | restricao | analises, advertência automática, painelRecrutadores (recrutado com problema) |
| impedimento_removeu | restricao | analises, advertência automática |
| jogador_entrou | conexao | presença, registros diários, painelRecrutadores (última vez online, horários, fantasmas) |
| jogador_recrutou | recrutamento | painelRecrutadores (último recrutamento, tendência, meta, horários, qualidade), sócios setados, presença implícita |
| jogador_saiu | conexao | presença, registros diários |
| multou | disciplina | painelDisciplina |
| novato_entrou | lideranca | funil de recrutamento, alerta de novato |
| patrimonio_guardou | patrimonio | alertas, painelBau |
| patrimonio_removeu | patrimonio | alertas, painelBau |
| portao_destrancou | patrimonio | segurança, painelFechaduras |
| portao_trancou | patrimonio | segurança, painelFechaduras |
| promoveu_cargo | hierarquia | painelHistorico, relatórios |
| protecao_alternou | patrimonio | só registro/consulta |
| rebaixou_cargo | hierarquia | repositório |
| removido_torcida_automatico | saida | analises, relatórios |
| saiu_torcida | saida | analises, relatórios |
| sede_destrancou | patrimonio | segurança, painelFechaduras |
| sede_trancou | patrimonio | segurança, painelFechaduras |
| suspensao_adicionou | restricao | analises, painelRecrutadores (recrutado com problema) |
| suspensao_removeu | restricao | analises |
| tag_adicionou | tag | analises (painelTags) |
| tag_alterou | config | só registro/consulta |
| tag_removeu | tag | analises (painelTags) |
| usou_sistema_porta | patrimonio | relatórios |
| desconhecido | (varia) | reprocessado a cada arranque quando o parser aprende |

## Categorias

`bau conexao config disciplina economia hierarquia lideranca patrimonio
recrutamento restricao saida tag territorio`. Categoria nova vinda do rodapé do
jogo não quebra nada: o painel de categorias mostra o que vier.

## Canais de log e a trava de origem

Todo canal em `tenant.logsJogo.canais` precisa estar dentro de
`logsJogo.categoriaLogs`. A ingestão recusa canal fora dela (na sincronização e
de novo no INSERT) — foi assim que um canal de outra comunidade contaminou os
painéis por dois meses. `/setup diagnostico` também avisa.

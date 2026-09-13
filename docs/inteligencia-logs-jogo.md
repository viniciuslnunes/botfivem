# Inteligência dos logs do jogo (canais-painel)

O FiveM publica tudo o que acontece com a torcida em canais de webhook do
Discord. O bot lê esses canais, grava cada log em `logs_jogo` e transforma
cada **tipo de informação** num canal-painel próprio, sempre atualizado. Este
documento explica de onde vem cada dado, como ele vira painel e como criar o
próximo.

## Fontes

| Canal (Discord) | ID | O que traz | Situação |
|---|---|---|---|
| 🦅・logs-registros | `1439061028515090524` | `#ID Nome …`: recrutou, promoveu/rebaixou, expulsou, saiu, tag, blacklist/suspensão/impedimento, multa, arena, sede/portão, config | ativo |
| 🦅・logs-painel | `1531478268975251496` | entrada/saída do servidor | ativo |
| 🦅・logs-baú | `1198743171765637123` | `Guardou/Removeu [GDF Sócio\|Diretoria\|Presidência]`: ID, item, quantidade | ativo, **lido a partir de 2026-09-13** |
| 🦅・logs-banco | `1518021496662917216` | Coins (dominação/conquista), dinheiro (depósito/saque/staff), honra | ativo, **lido a partir de 2026-09-13** |
| 🦅・logs-liderança | `1461544673825783929` | `O jogador X (ID: n) …`: advertência, banco em R$ (antigo), roupa, fechaduras da sede | **parado desde 2026-07-26** |

Os nomes ficam em `config.logsJogo.nomesCanais` e aparecem no rodapé dos
painéis como origem do dado.

## Do log ao painel

1. **Parser** (`utils/logsJogo/parser.js`): uma regra por família de log. Quase
   todas leem só a descrição; baú e banco leem também o **título**, porque é
   nele que o jogo diz o que aconteceu (`Guardou [GDF Sócio]`, `Sacou dinheiro`).
   O que não casa com nenhuma regra vira `desconhecido`, mas nunca é descartado.
2. **Gravação** (`ingestao.js`): um registro por embed, com o embed cru em `bruto`.
3. **Reprocessamento** (`ingestao.reprocessarDesconhecidos`): relê pelo parser
   atual todo registro que ainda está como `desconhecido` e corrige a linha no
   lugar. Roda no arranque do bot e no `/logs-sincronizar`. É o que faz uma regra
   nova valer também pro histórico (a sincronização não atualiza linha existente).
4. **Painel reativo** (`events/messageCreate.js`): cada log novo acorda só o
   painel da categoria dele (`PAINEIS_POR_CATEGORIA`), com debounce próprio.
5. **Alertas na hora** (`alertas.js`): retirada grande do baú
   (`bau.alertaRetiradaQtd`) e saque grande do banco (`caixa.alertaSaqueValor`).

## Família → painel

| Família de log | Ações | Categoria | Canal-painel |
|---|---|---|---|
| Baú | `bau_guardou`, `bau_removeu` | `bau` | 📦・estoque-bau |
| Dinheiro e honra | `banco_depositou`, `banco_sacou`, `dinheiro_adicionado`, `dinheiro_conquista`, `honra_adicionada`, `honra_gastou`, `comprou_roupa`, `comprou_item` | `economia` | 🏦・caixa-do-jogo |
| Território | `coins_dominacao`, `coins_conquista` | `territorio` | 🗺️・dominacao-territorios *(público)* |
| Disciplina | `advertido`, `adv_finalizou`, `adv_removida`, `multou` | `disciplina` | ⚖️・disciplina-jogo |
| Restrições | `blacklist_*`, `suspensao_*`, `impedimento_*` | `restricao` | ⛔・banidos-e-impedidos |
| Fechaduras | `sede_*`, `portao_*`, `fechadura_*`, `arena_*`, `protecao_alternou` | `patrimonio` | 🔐・fechaduras |
| Tags | `tag_adicionou`, `tag_removeu` | `tag` | 🏷️・tags-do-jogo *(público)* |
| Configuração | `config_alterou`, `tag_alterou`, `cargo_editado` | `config` | ⚙️・auditoria-config |
| Não reconhecido | `desconhecido` | — | 🧩・logs-nao-reconhecidos |

Os canais são criados pelo bot na primeira execução, na mesma categoria do
📊・painel-jogadores, visíveis só pra liderança (exceto os marcados como públicos).

## Regras de honestidade do dado

Estas regras existem por casos reais. Painel novo deve seguir todas.

- **O jogo publica evento, não estado.** Quem está banido, quem tem cada tag e
  quem tem advertência aberta sai do **último evento de cada chave**
  (`analises.js`). Por isso a ordem tem desempate por `message_id`/`embed_indice`:
  vários eventos da mesma mensagem têm o mesmo `ocorrido_em`.
- **Não existe saldo, só movimento.** Nem o baú nem o banco informam o que já
  havia antes. O painel diz "saldo líquido desde <data>", nunca "estoque" ou
  "saldo da conta".
- **Moedas não se somam.** A coluna `valor` guarda R$, coins, honra ou
  quantidade de item, conforme a ação. Toda soma filtra por ação; o "dinheiro
  movimentado" genérico usa `repositorio.ACOES_DINHEIRO`.
- **Fonte parada é avisada.** Sem log de um tipo há mais de
  `logsJogo.fonteParadaDias`, o painel mostra `F.avisoFonteParada` em cima: "0
  advertências" de uma fonte morta não pode parecer "ninguém punido". No painel
  de fechaduras, uma fechadura sem log recente aparece como ⚪ último estado
  conhecido, e não conta como destrancada agora.
- **Nome vem cru do jogo.** Todo nome passa por `F.nomeSeguro` (markdown
  escapado, mojibake corrigido). Os logs do baú e do banco só trazem o ID, e o
  nome é emprestado dos outros canais por `F.comNomes`.

## Esqueleto de um painel

- `painelCanal.js`: `criarPainelCanal({ slug, nomeCanal, montarBlocos, montarAcao, … })`.
  Cuida de criar o canal, reeditar as mensagens no lugar, apagar sobras, ciclo
  por tempo e debounce. O bloco de ação (`montarAcao`) é **sempre a última
  mensagem** do canal, porque a resposta ephemeral nasce no fim do canal.
- `painelConsulta.js`: `registrarConsulta(slug, renderizar)` + `selectPeriodo(slug)`.
  É um handler só (`logstat:<slug>`) para o filtro por período de todos os
  painéis. Só a liderança usa.
- `painelFormato.js`: `embedsDeLista` (pagina lista longa respeitando 4096),
  `pessoa`, `nomeSeguro`, `comNomes`, `haQuantoTempo`, `avisoFonteParada`, `nomeCanal`.
- `analises.js`: reduções puras e testadas (estado atual a partir de eventos).

Painel novo: regra(s) no parser com teste usando **exemplo real** →
consulta no repositório se precisar → arquivo `painelX.js` com `montarBlocos` +
`registrarConsulta` → `iniciar` em `events/ready.js` → categoria em
`PAINEIS_POR_CATEGORIA`.

## Formato de log novo

Aparece sozinho no 🧩・logs-nao-reconhecidos, agrupado por formato, com
contagem e exemplo. Para resolver:

1. Escrever a regra em `parser.js` e o teste com o exemplo real (`test/logsJogo.inteligencia.test.js`).
2. Reiniciar o bot ou rodar `/logs-sincronizar`. O reprocessamento corrige o histórico.

## Decisões registradas

- **Sede e portão** mantêm as ações antigas (`sede_trancou` etc.): elas estão
  em 14 mil registros e o módulo de segurança vigia por elas. As outras
  fechaduras usam `fechadura_*` com o nome em `alvo_nome`.
- **Formatos antigos do logs-banco** (até 2026-07-19: `Dinheiro`/`Honra` com
  sinal no valor e `Banco` para prêmio de conquista) viram as mesmas ações dos
  títulos atuais. O histórico soma junto sem o painel saber da troca de texto.
- **Expulsão com motivo** (`removeu #ID Nome (Traidor)`) é `expulso_torcida`.
  Antes só passava com parênteses vazios, e 66 expulsões ficaram fora do churn.
- `comprou_item` (logs-registros) e `honra_gastou` (logs-banco) são a **mesma
  compra** vista de dois canais. O painel de caixa só soma o valor de honra, que
  é quem traz o preço.
- **Baú de Recompensas** (`Baú de Recompensas [GDF] - Depósito/Retirada`, no
  logs-baú) usa as mesmas ações do baú comum, e o compartimento é "Recompensas".
  O colchete `[GDF]` desse título é da torcida, não do baú, então
  `E.bauDoTitulo` e `repositorio.saldoBau` tratam esse caso nos dois lugares.
- **Baú ordena por volume** (guardou + removeu), não por saldo. Ordenado por
  saldo, dezenas de camisas com saldo 0 escondiam tecido, maconha e cocaína.
- **Cruzamento com o não-recrutar é só blacklist.** Suspensão é temporária, e
  impedimento é ligado e desligado com segundos de diferença, inclusive entre
  líderes (visto nos logs de 2026-09-13). Tratar os dois como "não recrutar"
  seria falso alarme.
- **Tags**: grafias da mesma tag (`R.S.J.` → `RSJ`) são uma tag só, exibida com
  a grafia mais recente. Tag recebida antes da última saída ou expulsão da pessoa
  não vale, porque o jogo não publica "removeu tag" quando alguém sai. A lista
  antiga tinha gente que já estava na blacklist. Essa regra é **dedução**, não
  vem de documentação do jogo: se a tag sobreviver à saída, ela deve ser tirada
  de `analises.tagsAtivas`.

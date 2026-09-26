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
- **Sugestões de melhoria** (decisão do usuário, 2026-09-24): **recrutador e acima
  enviam** (`ehRecrutadorOuAcima`; sócio comum não) e **sócio e acima votam**
  (`ehSocioOuAcima`). Um voto por pessoa (repetir retira, o outro troca); o autor
  não vota na própria sugestão. Votos são botões, nunca reação (senão não há como
  barrar quem não pode votar). O botão de enviar fica sempre como última mensagem
  do canal. Botão de voto nunca é `Success` (verde).

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
- **Desfazer decisão** (pedido do recrutamento, 2026-09-24): aprovada ou reprovada por
  engano, a ficha ganha o botão `recrut:desfazer:<fichaId>` (+ aviso com o horário-limite) e
  pode ser reaberta **até 30 min depois** da decisão (`regras.JANELA_DESFAZER_MIN`, conferida
  no SQL). Quem pode: recrutador ou acima. Efeito: ficha volta a **PENDENTE** (mesma mensagem,
  APROVAR/REPROVAR de volta; `desfeitas` conta quantas vezes) e o candidato volta a ser quem
  acabou de pedir: sai o SÓCIO (ou o cargo de reprovado), volta visitante + PROVAR MANTO por
  10 min (nova remoção agendada) e o apelido é limpo. Desfaz também a aprovação contada no
  ranking, o sinal de confiança da decisão e o telefone divulgado em `telefoneSocio`; o
  candidato recebe DM. Banco e cargo decisivo na mesma transação (cargo recusado = nada muda);
  o resto é melhor esforço e vira aviso. Não reabre se o candidato já mandou ficha mais nova.
  Depois de 30 min a tarefa `recrut_expirar_desfazer` tira o botão; rever passa a ser da
  liderança. "Ficha já decidida" = a mensagem **sem o botão APROVAR** (não mais "sem
  componentes", porque a decidida carrega o botão de desfazer). Coberto por
  `test/desfazerRecrutamento.test.js`.

## Avaliação do manto (provar-manto)

- Toda imagem postada por não-bot no canal `provarManto` ganha resposta do bot com
  **MANTO CORRETO / MANTO ERRADO** (botões neutros/vermelho, nunca verde) e é
  registrada em `mantos_avaliados`.
- Quem avalia: liderança (`ehLideranca`: presidência, vices, velha guarda, diretoria)
  ou gestor da área `recrutamento`. Permissão conferida no handler `mantoaval`.
- Última avaliação vale (dá para corrigir clique errado). Ao marcar **CORRETO** os
  botões somem da mensagem; em **ERRADO** ficam, para a liderança poder corrigir.
- O acerto/erro conta para o recrutador que **decidiu a ficha** do candidato (a ficha
  mais recente criada até o envio da foto). Ficha sem decisão = "sem recrutador" no
  placar até ser decidida. O recrutador não é gravado na avaliação, é resolvido na consulta.
- Placar em canal-painel só da liderança (`🧥・placar-manto`), lista todos com cargo
  de recrutador, mesmo zerados. Coberto por `test/manto.test.js`.

## Sequência de divulgação de recrutamento

- Canal `canais.divulgacaoRecrutamento` (null = recurso desligado, sem painel): todo post
  de não-bot é registrado em `divulgacoes_recrutamento` (autor + horário); ao subir, o bot
  importa as últimas 100 mensagens do canal. O bot **não consome** a mensagem.
- "Liberação de postar" = permissão real de enviar mensagem no canal (cargos + overrides),
  não uma lista mantida à mão. Recrutadores liberados entram no rodízio; recrutadores sem
  liberação e outros com liberação (liderança) aparecem separados.
- Rodízio: o próximo é quem está há mais tempo sem postar (quem nunca postou primeiro); o
  último a postar nunca é o próximo. Alertas: mesma pessoa duas vezes seguidas, liberado
  sem postar há mais de 7 dias, e autor recente que perdeu a liberação.
- Painel só da liderança (`📣・sequência-recrutamento`): quem pode postar, próximo da vez,
  alertas, contagem por recrutador e os últimos 15 posts com o intervalo entre eles.
  Post apagado no Discord continua na sequência (não há hook de mensagem apagada).
  Coberto por `test/divulgacao.test.js`.

## Advertência automática de sócio (painel do jogo → Discord)

- Impedimento ou advertência lançados no painel do jogo (`impedimento_adicionou`,
  `advertido`) viram advertência no Discord para o **sócio ativo** dono do ID (correlação
  pelo nick). 1 lançamento = 1 advertência; nível = cargo ADV¹/²/³ atual + 1. Tabela
  `advertencias_socio` (status ATIVA, PAGA, REMOVIDA, VENCIDA, CARGO_REMOVIDO).
- **1ª**: aviso formal em `historicoAdv`, com a justificativa (texto do log). **2ª**: 50
  maconha + 50 cocaína no baú em 2 dias, cobrança em `advPendentes`; o depósito é
  reconhecido pelo log `bau_guardou` do próprio jogador (soma parcial, só vale depois da
  advertência e dentro do prazo); pago = advertência removida e cargo volta um nível.
  Sem pagar, `adv_vencimento` remove o cargo de sócio e marca VENCIDA. **3ª**: remove o
  cargo de sócio na hora.
- Retirar o impedimento/advertência no painel (`impedimento_removeu`, `adv_removida`)
  encerra a advertência ATIVA da mesma origem (REMOVIDA) e baixa o cargo, só se o membro
  ainda está naquele nível. Advertência já paga, vencida ou de 3ª não é reaberta.
- Impedimento e advertência do jogo costumam vir juntos: uma só advertência por janela de
  10 min. Log com mais de 6 h não abre advertência (reprocessamento não pune de novo);
  o mesmo log nunca gera duas (`UNIQUE (log_message_id, origem)`). Cargo primeiro, registro
  depois: se o Discord recusar, nada é gravado. Coberto por `test/advertenciaAutomatica.test.js`.

## Advertência automática de recrutador (inteligência de recrutadores → advertência)

- Varredura a cada 3 h (módulo `advertenciaRecrutadorAuto`), cruzando o painel de
  recrutadores (recrutamentos, tempo jogado, retenção), o placar do manto e as fichas.
  Recusa rodar com a fonte de logs parada (`fonteParadaDias`): sem log recente não dá para
  separar "não recrutou" de "o jogo parou de mandar log". Só mede recrutador com ID no apelido.
- Regras (cada advertência grava a justificativa em `advertencias_recrutador` e no canal
  `historicoAdvRec`):
  1. **Jogou e não recrutou**: ≥ 30 min jogados e 0 recrutamentos em 5 dias → advertência.
  2. **Inatividade**: 0 jogado, 0 recrutamentos e fora do jogo em 7 dias → perde o cargo de
     recrutador, sem advertência (`regra = inatividade`, nível 0).
  3. **Manto errado**: 3 mantos avaliados ERRADO em 7 dias na ficha que ele decidiu.
  4. **Retenção baixa**: < 50% com pelo menos 3 recrutados em 14 dias.
  5. **Ficha incompleta**: 3 fichas APROVADAS por ele em 7 dias sem nome, idade, ID ou telefone.
- Carência de 5/7 dias para quem recebeu o cargo há pouco (`recrutadores_cargo`). Mesma
  regra não advertem de novo dentro do próprio intervalo (5, 14, 7 e 7 dias).
- Escada igual à do sócio, pelo número de advertências **ativas**: 1ª aviso; 2ª aviso (na
  regra 1 ganha prazo de 2 dias para voltar a recrutar); 3ª remove o cargo de recrutador.
- Perdão: advertência da regra 1 sai sozinha após 3 recrutamentos desde que foi aplicada
  (status PERDOADA). Qualquer advertência ativa expira em 30 dias (EXPIRADA). 2ª da regra 1
  sem regularizar em 2 dias: perde o cargo (VENCIDA).
- **Carência** conta a partir da **promoção a Recrutador nos logs do jogo** (`promoveu_cargo`,
  "Sócio > Recrutador", casada pelo ID do apelido); sem log, cai na data do cargo no Discord
  (`recrutadores_cargo`). Ver `cargoDesdeComPromocao`.
- **Gestor** = quem promoveu a pessoa a recrutador no jogo (último movimento do ID). O
  `📋・quadro-de-recrutadores` traz, abaixo do quadro, "Gestores e seus recrutadores": **só quem
  tem o cargo hoje**, com data no cargo, recrutamentos em 30 dias, média semanal, retenção, fichas
  aprovadas e ADV. Cada gestor recebe uma avaliação do time (`utils/recrutamento/quadroGestores.js`):
  média semanal por recrutador contra a meta semanal (`recrutadores_meta_semanal`) → FLUXO BOM
  (≥ meta), ATENÇÃO (≥ metade), FLUXO FRACO; a 1ª semana de cargo não entra na média (EM CARÊNCIA
  se ninguém do time é mensurável). Segue a seção "Rebaixados de recrutador para sócio" (30 dias).
  Gestor/pessoa viram menção quando o ID do jogo bate com o apelido no Discord; recrutador sem
  promoção nos logs fica em "sem promoção registrada".
- Os cargos ADV de recrutador (`cargos.advRec`) só são ajustados se o tenant os configurou;
  sem eles, a fonte da verdade é a tabela. Remoção manual pelo botão da liderança mexe no
  cargo, não na tabela (a advertência da tabela expira sozinha). Coberto por
  `test/advertenciaRecrutadorAuto.test.js`.

## Painel de recrutadores: inteligência cruzada (`🦅・painel-recrutadores`)

Três tabelas de **uma linha por recrutador**, títulos completos, ≤ 56 colunas (limite do bloco de
código no desktop): DESEMPENHO (recrutamentos, retenção, tempo, rec/h), CONTROLE (último
recrutamento, última vez online, tendência, meta, ADV) e QUALIDADE (problemas, fantasmas, manto,
fichas). Alerta ATENÇÃO no topo, pódio e ficha por recrutador com horários. Só liderança.

Decisões tomadas sem resposta do usuário (padrões — mudar aqui e em `inteligenciaRecrutadores.js`):

- **Recrutado com problema**: `advertido`, `blacklist_adicionou`, `impedimento_adicionou` ou
  `suspensao_adicionou` do recrutado **depois** do recrutamento e em até 30 dias. Expulsão/saída
  ficam na retenção. **Só informa** (coluna PROBLEMAS e ATENÇÃO a partir de 3 casos): **não gera
  advertência automática** — punir por isso é decisão pendente do usuário.
- **Fantasma**: recrutado há 7+ dias sem nenhum log como ator depois do recrutamento (+10 min).
  É número **separado** da retenção; ATENÇÃO com 3+ casos e metade ou mais dos recrutados maduros.
- **Meta semanal**: **única para todos** (padrão 5 recrutamentos/semana, `bot_config`
  `recrutadores_meta_semanal`), editada pelo botão `🎯 META SEMANAL` (campo único: botão → modal,
  sem select). `0` desliga. Só informa (% = recrutamentos dos últimos 7 dias ÷ meta).
- **Tendência**: recrutamentos do período contra o período anterior de mesma duração (`▲ ▼ =`).
- **Aviso preventivo** (módulo `advertenciaRecrutadorAuto`, na varredura de 3 h): a até **2 dias**
  de a regra disparar (sem recrutar jogando, inatividade), retenção entre 50% e 60%, ou 2 de 3
  mantos/fichas — vai **para o canal do histórico e por DM ao recrutador** (DM fechada não falha
  nada). Cada (recrutador, regra) avisa 1×/2 dias (`bot_config` `adv_rec_avisos_preventivos`).
  Aviso **não é advertência** e não entra na escada. ATENÇÃO do painel mostra os riscos da última
  varredura (até 3 h de atraso).
- Colunas ADV/MANTO/FICHAS só existem com `advertenciaRecrutadorAuto` ligado (ele se registra em
  `inteligenciaRecrutadores.registrarEnriquecedor`); desligado, o painel omite as colunas.
- Coberto por `test/inteligenciaRecrutadores.test.js` e `test/advertenciaRecrutadorAuto.test.js`.

## Menções nos canais de advertência e decisão de recrutamento (2026-09-26)

- **Toda notificação nova** em `historicoAdv`, `advPendentes`, `historicoAdvRec` chama a liderança
  (`config.lideranca`: presidente, vice, velha guarda, diretoria) no `content` (menção em embed não
  notifica). Sócio: + recrutador que aprovou a ficha (`utils/advertencia/mencoes.js`). Recrutador: + o
  próprio advertido.
- **`validarSetagem` e `historicoNaoRecrutar`**: a cada registro novo (ficha, "pronto para validação",
  bloqueio, aviso de desbloqueio) chama liderança + cargo Recrutador (`mencoesDaEquipe()` em
  `utils/permissoes.js`). Editar mensagem antiga não notifica: por isso o desbloqueio posta aviso novo.
- **`advPendentes` cruza o contexto** (`utils/advertencia/contexto.js`): a 2ª ADV mostra restrições
  ativas no jogo, ID em não-recrutar, ADV de recrutador, histórico e outros pagamentos pendentes.
  Blacklist/suspensão nova para quem tem pagamento pendente gera alerta reativo no mesmo canal
  (impedimento já abre a ADV seguinte sozinho). Log com mais de 6 h não realerta.

## Inteligência cruzada (módulo `inteligencia`, 2026-09-26)

Regra-mãe: **cruzamento só informa.** Nenhum item abaixo pune, bloqueia ou concede sozinho; o
alerta vai para quem decide (decisão do usuário: "alerta avisa quem decide"). Código em
`utils/inteligencia/`; regras puras em `regras.js` (limites em `LIMITES`, mudar lá e aqui).

Decisões tomadas sem resposta do usuário (padrões; mudar aqui e no código):

- **Reincidência só avisa** (não abre ADV automática). Reincidente = 2+ ocorrências (ADV de sócio,
  blacklist, suspensão, impedimento) em 90 dias. Vai para `ocorrencias` (❌・ocorrências; `associadoEmAtencao` fica só com os registros de impedimento/restrição); a chave do debounce
  leva a contagem, então só avisa de novo se piorar.
- **Ficha parada na análise** (pendente > 12 h) vai só para `setagensPendentes` (🚨・setagens-pendentes, decisão
  do usuário 2026-09-26; canal exclusivo deste alerta). **Cada** registro novo menciona liderança + Recrutador
  (`mencoesDaEquipe()`), não só o primeiro do lote.
- **Saiu no jogo e continua sócio** vai para `saidasNoJogo` (decisão do usuário 2026-09-26), com menção + nome + ID do
  jogador (a menção sozinha nem sempre resolve). `node tools/migrar-reincidencia.js --tipo saiu_segue_socio` move os antigos.
- **Cargo de recrutador divergente (jogo × Discord)** vai para `cargoDivergente` (decisão do usuário 2026-09-26).
  `node tools/migrar-reincidencia.js --tipo cargo_divergente` move os antigos e apaga do canal de inteligência.
- **Nome parecido na ficha só avisa** (resposta na própria ficha, sem notificar): ≥ 80% de semelhança
  (`utils/nomes.js`, a mesma correlação de `idsSemSocio`) contra blacklist/suspensão/impedimento ativos,
  IDs em não recrutar e reprovados definitivos. Aprovar continua com o recrutador.
- **Consistência da liderança** (`/inteligencia lideranca`): só a **presidência** vê. Sinais: restrição
  desfeita em até 10 min pelo mesmo líder; 5+ promoções/rebaixamentos em 1 h. É pista para conversa.
- **"Não recrutar" ganhou espelho em tabela** (`nao_recrutar`), preenchido a cada leitura do canal. **O
  canal continua sendo a fonte** e a vitrine; a tabela existe para cruzar. Se o banco for eliminado no
  futuro (direção registrada), o espelho sai junto sem perda.

Regras:

- **`associado_resumo`** (uma linha por sócio, recalculada a cada 3 h): ADV ativas, restrições ativas,
  ocorrências em 90 dias, tempo jogado 7/28 dias, baú e banco (28 dias), lista não recrutar e **risco
  0–100** (ADV 20 cada até 3, restrição 25 cada até 2, reincidência 15, pagamento pendente 10, atividade
  em queda 10, não recrutar 20, 14+ dias sem aparecer 10; ≥ 30 MÉDIO, ≥ 60 ALTO).
- **Esfriando**: jogava ≥ 3 h/semana (média das 3 semanas anteriores) e caiu ≥ 60% nos últimos 7 dias.
- **Varredura de 3 h** (recusa rodar com fonte parada, igual à ADV de recrutador): reincidência;
  blacklist ativa sem bloqueio em `historicoNaoRecrutar` (30 dias sem repetir por ID); **recrutado no
  jogo sem ficha APROVADA** (só entre 2 h e 3 dias depois do recrutamento); fichas pendentes há 12 h+;
  **sede/portão destrancado há 30 min+ sem ninguém online** (volta o alerta removido em 2026-09-15, agora
  no canal `🧠・inteligência`, criado sozinho, ID em `bot_config` `canal_inteligencia`).
- **Debounce de alerta é persistente** (`alertas_enviados` via `utils/alertaPersistente.js`), não mais
  `Map` em memória: reiniciar o bot não repete aviso.
- **Confiança 2.0** (ainda só cosmético, sem conceder permissão): sinais de conduta lançados pela
  varredura, idempotentes por origem — `ADV_SOCIO` −15 (piso −45, 90 dias), `ADV_PAGA_EM_DIA` +10 (teto
  +20), `ADV_VENCIDA` −30, `RESTRICAO_JOGO` −20 (piso −40, 90 dias), `TEMPO_DE_CASA` +10 a cada 60 dias
  (até 3×). Teto negativo em `calcularScore` limita a **queda** (`limitar`).
- **Boletim semanal** no `🧠・inteligência` (7 dias, marca em `bot_config` `boletim_inteligencia_ultimo`):
  risco, esfriando, recrutamento (funil completo, tempo de análise, motivos de reprovação, **qualidade de
  quem aprova**: aprovados com ADV/restrição em 30 dias), contribuição baú/banco, farm (produtividade por
  hora jogada e concentração: top 3 ≥ 70% com mais de 3 pessoas), eventos (faltas e horários), território ×
  entradas por hora, tickets e saúde dos departamentos. Também sob demanda em `/inteligencia <seção>`
  (liderança; `boletim` publica na hora).
- **Contribuição** compara mesma unidade (peças no baú; dinheiro no banco): CONTRIBUINTE razão ≥ 1,5;
  CONSUMIDOR ≤ 0,5; amostra mínima 10. Retirar é normal para quem trabalha na área — é padrão, não culpa.
- **Território**: o jogo não publica "perdeu território". O cruzamento é *conquistar em hora de pouca
  gente* (defesa frágil), nunca "perdas por hora".
- **Tickets** agora têm tabela (`tickets_registro`): abertura, 1ª resposta da equipe (primeira mensagem de
  quem não é o dono nem bot) e fechamento. Só passa a medir a partir desta entrega.
- Ficha nova dispara o gancho `recrutamento/ganchos.js#aoFichaEnviada` (módulo `inteligencia` assina);
  módulo desligado não assina e o recrutamento segue igual.
- Coberto por `test/inteligencia.regras.test.js` e `test/inteligencia.fluxos.test.js`.

### Inteligência cruzada, 2ª rodada (2026-09-26): correções e novos cruzamentos

Correções de premissa (achadas nas amostras reais de `fontes/hoolibras/amostras.json`):

- **Funil parte da FICHA, não de `novato_entrou`.** `novato_entrou` só vinha do canal removido (outra
  comunidade); o funil antigo mediria dado morto. Agora: fichas → aprovadas → manto correto → recrutadas no
  jogo → jogando 7+ dias depois (esta última só contra os recrutados há 7+ dias).
- **Quem saiu em `saiu_torcida` é o ATOR** (`#2127 Fulano saiu da torcida`, sem alvo). `primeiraSaidaPorAlvo`
  só olhava o alvo e **não contava saída voluntária** na retenção do recrutador; agora conta. Efeito: a
  retenção medida cai (fica fiel à definição "sai, é expulso ou some") e a regra 4 da ADV automática
  (retenção < 50%) pode disparar mais que antes.
- **Nome do jogo carrega tag** (`Milgrau LHP`, `Mkzin RSJ`, `Jhow Sccp`). `nomesParecidos` também aceita o
  nome contido no outro quando o que sobra é tag (até 4 letras): nome de 2+ palavras ou 6+ letras, ou 5+
  letras com só tag sobrando. "Lucas" dentro de "Lucas Silva" não conta.
- **Sem inundação na 1ª varredura**: reincidência só alerta se a última ocorrência é da última semana;
  blacklist sem bloqueio só olha as dos últimos 30 dias (o ID troca por season); alertas com limite por
  mensagem (10–20) marcam como avisado **só o que foi listado**; o resto sai na varredura seguinte.

Novos cruzamentos (todos só informam):

- **Retenção** (`/inteligencia retencao`): coortes por mês de recrutamento (ficaram 7 e 30 dias, só sobre os
  maduros), saídas em 90 dias por tipo, quantas tiveram ADV/restrição nos 30 dias antes, tempo de casa na saída.
- **Cobertura do recrutamento**: hora com ficha chegando acima da média e recrutador entrando abaixo de
  metade da média (candidato esperando sem ninguém por perto).
- **A ADV funciona?** (`disciplina`): pagas no prazo, quem tomou ADV e saiu em 30 dias, quem tomou ADV e teve
  outra ADV/restrição em 60, e quem registrou.
- **Retirada fora do padrão da própria pessoa** (alerta): ≥ 20 unidades e ≥ 4× a mediana das retiradas dela
  do mesmo item nos 60 dias anteriores, com 5+ retiradas de histórico; liderança fica de fora. Complementa o
  limite fixo (que não vê quem "sempre tirou pouco e agora levou tudo").
- **Sócio com nome de quem está restrito** (alerta): nome ≥ 88% parecido com o de um ID **diferente** com
  restrição ativa (o ID troca por season). Pode ser coincidência: o texto do alerta diz isso.
- **Farm cargo × produção**: quem tem o cargo e não guardou nada em 28 dias, e quem produz sem o cargo.
- **Presença conferida pelo jogo** (eventos): presentes que estavam online 15 min depois do início, e sócios
  jogando que nem confirmaram. Presença fora do jogo (caravana) é normal; é pista, não acusação.
- **Gestor de departamento sem jogar há 14 dias** aparece com ⚠️ na saúde dos departamentos.
- **Patrimônio**: estado deduzido do último movimento de cada peça (`patrimonio_removeu` por último = fora do
  baú, com quem e desde quando) + empréstimo do Discord aberto há 7+ dias (alerta, some se o módulo
  `patrimonio` estiver desligado).
- **Finanças** (`financas`): livro-caixa 30 dias × 30 anteriores, atendimento da loja (pedido parado 24 h+),
  margem das rifas sorteadas e rifas que podem não fechar. Seções opcionais: sem o módulo, somem em silêncio.
  Consultas moram em `utils/{patrimonio,loja,rifas,financeiro}/inteligencia.js` (cada uma no módulo dono).

### Manto errado vira caso (motivo + canal por motivo)

- **MANTO ERRADO** não grava na hora: abre um select ephemeral com os motivos (fonte única:
  `utils/recrutamento/regrasManto.js` — IA, foto escura, fora dos requisitos; são os mesmos que o candidato lê no provar-manto). O `ERRADO` só entra em
  `mantos_avaliados` (e só conta contra o recrutador) **depois do motivo escolhido**.
- Cada motivo tem seu canal (`🧥・manto-<motivo>`, só liderança + gestor de recrutamento),
  criado sob demanda na categoria do provar-manto; ID em `bot_config` (`canal_manto_caso_<motivo>`).
- O card do caso leva a foto reenviada (o link do CDN expira), candidato, recrutador que
  decidiu a ficha, recrutador citado no formulário, avaliador, motivo e link da mensagem original.
- Ciclo: `ABERTO` → `RESOLVIDO` (botão, guardado no SQL: resolve uma vez só) ou `REVISTO`
  (manto reavaliado como CORRETO ou com outro motivo). O card antigo é fechado, não apagado.
- O candidato recebe DM com o motivo e as regras da provagem. Falha na DM ou no card não desfaz o erro; o avaliador é avisado.
- **Quem responde pelo erro:** só o recrutador que **aprovou** a ficha. Ficha reprovada não conta contra quem reprovou; ficha sem decisão fica em "sem recrutador" até ser aprovada. Coberto por `test/manto.test.js`.

## Sorteios (módulo `sorteios`, decisão do usuário, 2026-09-26)

- **Sorteio ≠ rifa.** A rifa (`rifas`) vende números com dinheiro do jogo; o sorteio (`sorteios`)
  sorteia brindes (soco inglês, veículo, arma, dinheiro…) entre quem colou no dia, sem compra.
- **Participantes = jogadores distintos do registro diário** do dia escolhido
  (`relatorios.montarDadosPresenca`, mesma fonte do canal registros-diarios), distintos **por ID**, numerados
  1..N em ordem alfabética. Alternativa: só números de 1 a N (sem lista de jogadores).
- **A lista é uma foto** gravada na criação (`sorteio_participantes`): o número de cada jogador não muda.
  "Atualizar lista" (relê o registro) só vale **antes do primeiro sorteio**.
- **Número nunca repete** dentro do sorteio: sorteio com trava de linha (`FOR UPDATE`) + índice único
  parcial em `sorteio_premios (sorteio_id, numero)`. Sorteio por `crypto.randomInt`, nunca `Math.random`.
  Logo, ninguém ganha duas vezes. Prêmios ≤ números (recusado na criação e ao adicionar prêmio).
- **Prêmios editáveis até serem sorteados** (adicionar em lote, um por linha; editar: botão → select → modal
  de 1 campo; remover). Prêmio já sorteado é definitivo. Máx. 25 prêmios por sorteio (limite do select do Discord).
- **Sortear**: um prêmio por vez (`🎲`) ou todos (`🎰`), na ordem cadastrada; cada resultado é anunciado no canal.
- **Concluir** só com todos os prêmios sorteados: anuncia (marca quem tem Discord ligado pelo apelido
  `... - <ID>`), manda DM (só marca `notificado` se a DM chegou; DM fechada é contada e informada),
  grava no **canal de histórico** e tira a mensagem viva do canal de sorteios. Se o histórico falhar, a
  mensagem viva fica (sem botões) e a gestão é avisada. **Cancelar** pede confirmação e não vai ao histórico.
- **Ganhador sem Discord ligado** sai só por nome e ID do jogo (o ID troca por season; o vínculo é atalho
  de aviso, não critério de sorteio).
- **Permissão**: presidência ou gestor de Social e Eventos (`rifas/permissoes#podeGerirRifas`), conferida em
  cada handler. Ver participantes é livre. O botão "NOVO SORTEIO" fica sempre como última mensagem do canal.
- Canais (`🎁・sorteios`, `📜・historico-sorteios`) criados por `/sorteio estrutura`; IDs em `bot_config`
  (`canal_sorteios`, `canal_sorteios_historico`).

### Fluxos que se conversam (3ª rodada, 2026-09-26)

Um fluxo **anuncia** o que aconteceu e outros **reagem**, sem se conhecerem: `utils/barramento.js`
(`assinar`/`emitir`; erro de um assinante não derruba o fluxo de origem). Eventos: `ficha.enviada`,
`ficha.decidida`, `adv.registrada`, `adv.removida`, `ticket.aberto`. Ponto de enriquecimento de embeds
existentes: `utils/enriquecedores.js` (`historico.resumo`, `adv.contexto`). Quem assina é o módulo
`inteligencia` (`utils/inteligencia/fluxos.js`); desligado, ninguém assina e os fluxos seguem iguais.

- **ADV manual passa a deixar registro** em `advertencias_socio` (`origem = 'manual'`, `registrado_por` =
  quem deu, sem `prazo_em`). Sem prazo, **não entra no fluxo de pagamento** (`pendentes` exige prazo) nem no
  reconhecimento de depósito. Remover a ADV pelo botão encerra a mais recente (`REMOVIDA`); o vencimento
  agendado leva `advId` e marca `VENCIDA`. Antes só existia o cargo, então reincidência, efetividade e
  confiança não enxergavam ADV manual. **O cargo ADV¹/²/³ continua sendo a fonte da verdade**: o resumo usa
  o maior entre a tabela e o cargo (ADV manual anterior a esta entrega só existe como cargo).
- **Triagem da ficha** (ao enviar): resposta na ficha com os avisos por nome (blacklist, não recrutar,
  reprovados) **e quem está com o jogo aberto agora** (recrutadores online). Não pinga ninguém (o cargo já
  foi chamado no envio).
- **Acompanhamento do recém-aprovado** (tarefas persistentes `inteligencia_acompanhamento`, agendadas
  quando a ficha é APROVADA; cada uma reconfere que a ficha ainda está APROVADA, então desfazer cancela):
  24 h → o jogo já registrou o recrutamento do ID? 72 h → apareceu no jogo? 7 dias → entrou nos últimos 3
  dias? Falhou = aviso no `🧠・inteligência` chamando **o aprovador** (só ele + a liderança lê); passou aos
  7 dias = sinal de confiança `NOVATO_ATIVO` (+10). Par do alerta "recrutado no jogo sem ficha".
- **ADV registrada** (manual ou do jogo): resumo do associado, sinal `ADV_SOCIO` e alerta de reincidência
  na hora (mesma chave de idempotência da varredura). ADV removida: resumo atualizado.
- **Ticket de recrutamento aberto**: o canal ganha o contexto da última ficha do candidato (status,
  motivo/definitiva, aprovador) e os avisos por nome. Outras categorias não mudam.
- **Ficha do associado e ADV pendente ganham o campo `🧯 INTELIGÊNCIA CRUZADA`** (risco, fatores, jogo 7/28
  dias, papel no baú/banco) quando o módulo está ligado.
- **Divergências jogo × Discord** (varredura de 3 h, só avisam):
  - saiu/expulso/removido no jogo (últimos 3 dias, sem novo recrutamento depois) e o Discord ainda tem o
    sócio com aquele ID;
  - cargo de recrutador: promovido no jogo sem o cargo no Discord, ou rebaixado no jogo com o cargo ainda
    (movimentos dos últimos 30 dias; o jogo é a referência);
  - **quem representa a torcida** (recrutador, gestor de área, diretoria) com 2+ ADV ativas ou restrição
    ativa no jogo;
  - carteirinha vencendo em 7 dias (ou vencida há até 3) de quem está com risco ≥ 30 ou esfriando.

### Casos: alerta rastreável, com ação e métrica (4ª rodada, 2026-09-26)

Cada alerta da inteligência (varredura e acompanhamento pós-aprovação) nasce como **caso** em
`inteligencia_casos` (`utils/inteligencia/casos.js`): `ABERTO` → `RESOLVIDO` (por alguém ou sozinho),
`IGNORADO` ou `EXPIRADO`. A mensagem do alerta guarda os botões; se o banco falhar, o alerta sai igual, sem
botões (avisar vale mais que rastrear).

- **Botões** (`customId intel:<acao>:<casoId>`, `utils/inteligencia/interacoes.js`): `RESOLVIDO` e `IGNORAR`
  em todo caso; ações por tipo — **remover cargo de sócio** (saiu no jogo, segue sócio; pede confirmação num
  2º clique), **ajustar cargo de recrutador** (alinha o Discord ao jogo, nos dois sentidos), **bloquear ID**
  (abre o `modal_bloquearid` que já existe, com o ID pronto; o bloqueio em si é o fluxo antigo).
  **Só a liderança** (conferido no handler). "Resolvido" só depois da ação ter funcionado: se o Discord
  recusa, o caso continua aberto e a resposta diz. Fechamento único (`WHERE status = 'ABERTO'`): dois
  cliques, ou clique + resolução automática, não fecham duas vezes. Ao fechar, os botões saem da mensagem e o
  rodapé diz por quem e como.
- **Um caso por pessoa** nos alertas com ação (blacklist sem bloqueio, saiu-segue-sócio, cargo divergente,
  ficha parada): até 8–10 mensagens por varredura, só a primeira chama a equipe (as outras não repetem o
  ping); o que não coube segue para a varredura seguinte (só é marcado como avisado o que foi enviado). Os
  alertas em lote (retirada atípica, nome de restrito, responsáveis, renovações, empréstimos, recrutou sem
  ficha, sede) são um caso por mensagem, com RESOLVIDO/IGNORAR.
- **Resolução automática** (a cada varredura): saiu-segue-sócio quando o cargo de sócio já saiu; cargo
  divergente quando o cargo bate com o jogo; blacklist quando o ID entra em não recrutar; ficha parada quando
  a ficha é decidida. Fica com `resolvido_por_id` nulo (ninguém assinou). Caso aberto há **30 dias** vira
  `EXPIRADO`, para a fila refletir o que ainda pede atenção.
- **Utilidade dos alertas** (`/inteligencia casos` e no boletim): por tipo, quantos abriram, como fecharam,
  quantos se resolveram sozinhos, mediana até resolver e fila aberta. `avaliarUtilidadeDosAlertas` sugere
  (só sugere): tipo com ≥ 10 casos fechados e ≥ 70% ignorados = limite frouxo; caso aberto há 7+ dias = falta
  dono; ≥ 50% expirados = ninguém é dono do alerta.

### Pendências de 2ª ADV: fila viva, lembrete e escalonamento (2026-09-26)

Tudo só informa; a liderança decide (regra-mãe da inteligência).

- **`⏳・pagamentos-pendentes`** (painel reativo, só liderança, nasce sozinho ao lado de `advPendentes`):
  quem deve, quanto falta e as últimas baixas. `advPendentes` continua sendo o histórico de eventos.
  Atualiza na hora quando a pendência nasce, recebe pagamento parcial, é paga, vence ou é removida
  (`utils/advertencia/pendencias.js`).
- **Lembrete 12 h antes do prazo** (tarefa persistente `adv_lembrete_prazo`): DM ao sócio com o que
  falta + aviso em `advPendentes` chamando a liderança e o recrutador responsável. Só sai se a ADV
  ainda estiver pendente; DM fechada não falha nada.
- **Restrição no jogo (blacklist/suspensão) para quem tem pagamento pendente**: com o módulo
  `inteligencia` ligado o alerta em `advPendentes` vira **caso** com botões (BLOQUEAR ID, REMOVER CARGO
  DE SÓCIO, RESOLVIDO, IGNORAR); desligado, mensagem simples. Fecha sozinho quando a pendência sai da
  fila (evento `adv.pendencia_encerrada` no barramento).
- **Escalonamento**: caso prioritário aberto há 24 h sem ninguém tocar ganha **um** lembrete,
  respondendo à própria mensagem e chamando a liderança (`dados.escalado`). Tipos: reincidência,
  blacklist sem bloqueio, restrição com pendência, responsável em risco, saiu e segue sócio.
- **Resumo diário** (a partir das 9 h de Brasília, no `🧠・inteligência`): pagamentos que vencem em 24 h,
  casos abertos há mais de 24 h e sócios com risco 60+. **Sem nada a dizer, não publica.**
- **Qualidade de quem aprova** no painel de recrutadores: aprovados dos últimos 60 dias que tomaram ADV
  ou restrição em 30 dias (mesmo limite do boletim: amostra 3+, taxa 30%+). Vira linha em ATENÇÃO;
  **não gera advertência de recrutador**.
- Coberto por `test/advertencia.pendencias.test.js`.

### Sorteios — camada de inteligência (2026-09-26)

- **Elegibilidade antes de numerar**: `minutos` (tempo mínimo online no dia, soma o maior tempo do jogador) e
  **excluir ganhadores recentes** (30 dias, sorteio CONCLUÍDO) tiram gente da lista *antes* da numeração:
  quem sai não ocupa número. Ganhador recente casa por ID, Discord **ou nome normalizado** (o ID troca por
  season). A mensagem mostra a regra e quantos ficaram de fora. Regras só mudam antes do 1º sorteio.
- **Selo da lista** (`sorteios.lista_hash`, SHA-256 de `numero:id`): muda se a lista muda; aparece no rodapé
  e na auditoria. É a prova de que a lista não foi mexida entre criar e sortear.
- **Trilha de auditoria** (`sorteio_sorteadas`): cada número que sai (quem sorteou, quando, quantos restavam,
  `SORTEIO` ou `RESSORTEIO`). Índice único `(sorteio_id, numero)`: garantia final de não repetir. Botão
  🧾 AUDITORIA é livre para qualquer um.
- **Ressorteio** (`🔁`): ganhador ausente na hora → o prêmio ganha outro número; o anterior **continua
  queimado** (não volta ao globo). Só com o sorteio aberto e prêmio não entregue. Gasta números: acabou o
  globo, nada muda e a gestão é avisada.
- **Online agora** ao lado do ganhador (`🦅` online / `⚪` fora): apoio para decidir ressortear; nunca
  altera o resultado. Falha ao ler presença = ninguém marcado.
- **Entrega** fecha o ciclo: o registro no histórico traz `📦 MARCAR ENTREGA` (gestão → select do prêmio →
  grava `entregue_por/em` e reedita o registro). Prêmio sorteado e não entregue gera **até 3 lembretes
  diários** marcando a presidência (`sorteio_lembrar_entrega`, sobrevive a reinício); tudo entregue = silêncio.
- **Mensagem viva apagada** no canal é republicada na próxima ação; o botão de novo sorteio volta ao fim.
- `/sorteio ganhos [membro]`: cada um vê os próprios prêmios; ver os de outra pessoa é da gestão.

### Inteligência do manto

- **Erro recuperado:** ERRADO seguido, para o mesmo candidato, de uma foto CORRETO enviada
  depois. Não conta contra o recrutador (placar, advertência e relatório usam a mesma
  regra, em `mantoRepositorio`); aparece à parte como "recuperado".
- **Advertência "manto aprovado errado":** conta só ERRADO não recuperado de fichas que o
  recrutador **aprovou**, na janela do que veio por último (avaliação ou aprovação).
- **Aviso ao aprovar:** ao aprovar com manto errado, sem avaliação ou sem foto, o recrutador é
  avisado na própria ficha (com o prazo de desfazer). Só informa; não trava a aprovação
  (`mantoAvisos`, evento `ficha.decidida`).
- **Reincidência:** 2+ fotos reprovadas sem correta depois → campo REINCIDÊNCIA no caso e aviso
  na barreira de entrada quando o candidato manda nova ficha.
- **Lembretes** (agendador, sobrevivem a reinício): foto sem avaliação em 30 min e 2 h; caso
  aberto a cada 24 h (até 3x) enquanto não for resolvido; nenhum lembrete se a situação mudou.
- **Relatórios:** `/inteligencia manto` e seção no boletim semanal (acertos, motivos, recrutadores
  com mais erros, avaliadores e tempo até a avaliação). O placar mostra o motivo mais frequente
  por recrutador e os avaliadores dos últimos 30 dias.
- Coberto por `test/manto.inteligencia.test.js`.

## Mérito de recrutadores (módulo `meritoRecrutadores`)

Pedido do usuário (2026-09-26): motivar quem recruta com constância e indicar os melhores para crescer
na diretoria do departamento. Desenho: `fluxos/merito-recrutadores/fluxo.md`. Motor puro:
`utils/merito/regras.js`; testes: `test/merito.test.js`.

- **Ciclo** de 8 semanas (56 dias) a partir da âncora `bot_config.merito_ciclo_inicio`; ao fechar, o
  seguinte abre no mesmo instante. **Ciclo 0 é de calibração** (`sombra`): mede e publica a distribuição,
  sem indicação, votação nem lembretes. `meta` (padrão 10/semana) e `piso` de novatos ficam
  congelados no ciclo ao abrir; ajuste pela presidência vale só no **próximo** ciclo.
- **Recrutamento válido** (log `jogador_recrutou`): `valido` (≥ 14 dias, voltou ao jogo ou foi aprovado
  como sócio, sem saída cedo nem advertência/blacklist/impedimento/suspensão em 30 dias), `pendente`
  (< 14 dias, presumido válido e **conta**), `suspeito` (≥ 3 dias sem nenhuma atividade: não conta até
  voltar), `invalido`. Mesmo alvo no ciclo conta uma vez; ID que já estava em NÃO RECRUTAR não conta.
- **Pontos (100)**: constância 40 (semanas na meta ÷ semanas contáveis) + sequência 5, qualidade dos
  recrutas 25 (ficaram ÷ maduros), conversão 10 (aprovados ÷ maduros), manto certo 10, ficha completa 5,
  eventos 5; cada advertência no ciclo −10. Percentual com amostra pequena (< 5; < 3 para manto/ficha;
  < 2 eventos) vale **metade do peso**, nunca zero. **Bônus fora dos 100** (até +5): evolução (+3, ≥ 10%
  acima do ciclo anterior) e retorno de ADV (+2).
- **Semana contável**: já terminou, não é anterior ao cargo, não foi dispensada. **Semana fraca**: com
  menos novatos que o piso, a meta cai na proporção (mínimo 1); sem dado de novatos a meta não muda.
  **Semana dispensada**: 1 por ciclo, pedida pelo recrutador (modal de 1 campo) e **aprovada pela
  liderança**; sai da conta e não quebra a sequência.
- **Elegibilidade** (barra o ranking): ≥ 4 semanas de cargo, meta em ≥ 4 semanas, sem ADV ativa de
  2ª+, risco do sócio < 60 na inteligência cruzada, sem lote retido, sem perda do cargo. Desempate:
  mais recrutamentos efetivos, menos ADV, cargo mais antigo; empate no 3º lugar entra junto.
- **Fraude não pune, retém para revisão**: rajada (≥ 6 em 1 h com a maioria ruim) e círculo fechado
  (nome parecido ao do recrutador) viram pendência da liderança e o lote não conta até a decisão
  (liberar = volta à regra normal; descartar = inválido). Alvo bloqueado e semana > 3× a mediana
  só **avisam**. O ciclo **espera as pendências** por até 3 dias antes de fechar (depois do
  fechamento o ranking é congelado).
- **Fechamento** idempotente (`WHERE status = 'ABERTO'`); fonte de logs parada = não fecha e avisa
  a liderança (1×/dia). **Votação**: 7 dias, só liderança, um voto por pessoa (troca até o prazo),
  abstenção, **placar oculto** até o fim, quórum = maioria da liderança (prorroga 3 dias uma vez, depois
  encerra sem quórum), **veto motivado só da presidência**. **O bot não dá cargo**: a decisão final
  (PROMOVIDO/ADIADO) é registrada pela presidência. Selos: Constante (meta em ≥ 6 semanas) e Destaque
  (top 3), só registro.
- Lembretes por DM (só ciclo valendo): quinta-feira para quem está abaixo da meta e uma vez por semana
  para quem bateu (`alertaPersistente`). Canais criados pelo próprio bot: `🏆・mérito-recrutadores`
  (recrutadores + liderança leem) e `🗳️・votação-mérito` (só liderança). Seção "Mérito" no
  `📘・regras-recrutadores` via `registrarSecaoRegras`.

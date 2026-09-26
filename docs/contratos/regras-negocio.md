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
- **Gestor** = quem promoveu (ou rebaixou) a pessoa no jogo. `📋・quadro-de-recrutadores` traz,
  abaixo do quadro, "Promovidos a recrutador, por gestor" e "Rebaixados de recrutador para sócio,
  por gestor" (último movimento de cada ID; promovido e depois rebaixado aparece só como rebaixado).
  Gestor/pessoa viram menção quando o ID do jogo bate com o apelido no Discord.
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

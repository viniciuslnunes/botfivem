# Plano — módulos de torcida do BotPDE no Discord da Gaviões da Fiel FiveM

> Planejamento de 2026-09-11. Substitui `unidades-regras-negocio.md` (que tratava
> de hierarquia Sede → Subsede → PDE, fora do escopo).
> Fonte das regras: repositório `botpde` (`docs/data/modulo-*.md`,
> `packages/types/src/*.js`, `apps/bot/src` — o bot Discord legado).
> **Status (2026-09-11): plano concluído.** Todas as fases (0 a 7) foram
> implementadas e verificadas fora do Discord — ver §9 › Fechamento. O que resta
> depende da torcida (§8) e do teste no servidor real.

## 1. Premissa

O servidor Discord **é** a torcida: Gaviões da Fiel FiveM, uma só. Não existe
Sede, Subsede, PDE, multi-tenant, afiliação ou espelho de membro. O que se traz
do BotPDE são os **módulos que uma torcida opera** e as **regras de negócio** que
já foram aprendidas lá — adaptadas ao que o Discord oferece, sem recriar o que o
Discord ou o bot já fazem.

## 2. Princípios que valem para todos os módulos

Aprendidos no BotPDE e aplicáveis a qualquer módulo novo aqui:

1. **Permissão é cargo, conferido no handler.** Nunca pelo nome do cargo, nunca
   só escondendo botão: o handler do botão/modal checa o cargo de novo, porque
   qualquer um pode clicar num botão que está no canal.
2. **Liderança e responsável não concedem permissão.** "Responsável pela área",
   "líder da operação" e "dono do evento" são identidade e accountability. Quem
   pode agir é quem tem o cargo de gestão.
3. **Elegibilidade ≠ permissão** (`elegibilidade.js`). "Pode usar o benefício?"
   é outra pergunta. Vínculo inativo, desligado ou bloqueado **barra**;
   inadimplência e carteirinha vencida **avisam** e quem opera decide — exceto
   preço de sócio (barra) e crédito (barra).
4. **Preferência ≠ lotação.** O que a pessoa pede na admissão (ex.: área) só vira
   cargo depois de aprovada. Reprovado ou pendente nunca aparece na equipe.
5. **Toda mutação administrativa deixa rastro**: quem, o quê, em quem, quando,
   com detalhes. Aqui: embed num canal de log do módulo.
6. **Baixar, não apagar.** Item, rifa, pedido e advertência mudam de status;
   o histórico fica.
7. **Concorrência é do banco, não do JavaScript.** Dois cliques no mesmo número
   de rifa ou na mesma vaga se resolvem com restrição única, não com `if`.
8. **Derivar o que vence sozinho** (reserva, prazo, validade) em vez de gravar um
   contador que diverge.
9. **Estado que precisa sobreviver a reinício não mora em `setTimeout`.**

## 3. Mapa dos módulos

Legenda: **JÁ EXISTE** (não refazer) · **ADAPTAR** (evoluir o que existe) ·
**PORTAR** (existe no bot legado do BotPDE, trazer) · **NOVO** · **NATIVO**
(o Discord já resolve) · **N/A**.

| Módulo no BotPDE | Hoje no botfivem | Veredito | Resumo |
|---|---|---|---|
| Associação / admissão | Recrutamento com análise, aprovar/reprovar, cargo SÓCIO, nick | ADAPTAR | Reprovação com motivo; área pretendida; persistir o aprovado |
| Bloqueio de solicitação | Lista "não recrutar" por ID FiveM | ADAPTAR | Não bloquear sócio ativo; ler a lista inteira |
| Advertência | ADV¹/²/³ com prazo | ADAPTAR | Prazo que sobrevive a reinício; cargos de recrutador (§7) |
| Desligamento | Só por ADV não paga (remove SÓCIO) | ADAPTAR | Desligar revoga carteirinha e tira do mural |
| Carteirinha | Número sequencial, validade 1 ano | ADAPTAR | Vencendo/vencida, renovação, revogação |
| Hierarquia / governança | Embed de Presidente, Vice, Velha Guarda, Diretoria, Recrutamento | JÁ EXISTE | Reusar o padrão para o quadro de departamentos |
| Departamentos + áreas | — | NOVO | Cargos Membro/Gestor por área, canal da área, quadro |
| Agenda (eventos) | `/evento` com reação 🦅 | ADAPTAR | Botões, sócio ativo, lotação, lista de espera, presença |
| Escala da operação | — | NOVO | "Quem trabalha" separado de "quem vai" |
| Caravanas | — | NOVO (plugin de evento) | Vaga, embarque ida/volta, veículos |
| Bateria | — | NOVO (plugin de evento) | Ensaio com presença; instrumentos no patrimônio |
| Patrimônio | — | NOVO | Inventário + empréstimo com foto de saída e de volta |
| Bandeiras | — | NOVO (recorte do patrimônio) | Cargo que só vê/gere bandeiras |
| Loja | — (existe no bot legado) | PORTAR | Catálogo, estoque por tamanho, pedido em canal, logs de venda |
| Financeiro (livro-caixa) | — | NOVO | Receita/despesa, saldo, balanço; loja e rifa lançam sozinhas |
| Rifas | — | NOVO | Número único, reserva que expira, sorteio auditável |
| Confiança | Ranking público de recrutadores (outra coisa) | NOVO (opcional) | Nível por sinais caros; não concede permissão |
| Memória (linha do tempo) | — | NOVO (tardio) | Um tópico de fórum por dia marcante |
| Comunicados oficiais | — | NATIVO | Canal de anúncios do Discord + cargo que publica |
| Comunidade, grupos, DMs, salas | — | NATIVO | Canais, threads, voz e palco do Discord |
| Moderação de conteúdo | Ticket de denúncia | NATIVO + JÁ EXISTE | AutoMod do Discord; denúncia pelo ticket |
| Tickets de atendimento | Tickets com categorias e transcript | JÁ EXISTE | Loja portada reusa o transcript |
| Logs do jogo (webhook do FiveM) | Canal `logs-liderança` lido só para o alerta de novato | ADAPTAR | Ingerir todos os logs; filtros, estatísticas e alertas (§4.10) |
| Bar, PDV, comanda, portaria | — | N/A | Operação de sede física |
| Alianças, rivalidade, Comunidade Nacional, brechó entre torcidas | Comando `!parceiros` | N/A | Multi-torcida |

## 4. Módulos em detalhe

### 4.1 Associação e carteirinha (ADAPTAR)

Regras do BotPDE a trazer (`modulo-associacao.md`):

- **Reprovação com laudo**: categoria + motivo (15–1000 caracteres) + se pode
  reenviar. Hoje é um clique. No Discord: "Reprovar" abre select de categoria e
  modal de motivo; a pessoa recebe o motivo por DM. "Não pode reenviar" dá o
  cargo `REPROVADO RECRUTAMENTO` e o botão de recrutamento recusa quem o tem.
- **Área pretendida na admissão**: select antes do modal (o modal já está nos 5
  campos, o máximo do Discord — o bot legado fez o mesmo com o tipo). O cargo de
  área só entra na aprovação (princípio 4).
- **Persistir o aprovado**: o bot legado grava `membros` (nome, ID, telefone,
  quem aprovou, prova). Hoje o botfivem só conta a aprovação no ranking; o
  cadastro vive no embed do canal.
- **Número de sócio** ocupa enquanto aprovado; desligado libera. **Desligar
  revoga a carteirinha** e tira a pessoa do mural.
- **Carteirinha**: vigência pela validade; "vencendo" ≤ 30 dias e "vencida" como
  estados derivados; renovação pela diretoria; lembrete por DM.
- **Bloqueio** barra a pessoa, não a ficha; motivo obrigatório; **não bloqueia
  associado ativo** — desligar primeiro (atos e cargos separados).

### 4.2 Departamentos (NOVO)

Regras (`modulo-departamentos.md`, `matriz-cargos-permissoes.md`):

- Áreas canônicas da torcida: Diretoria, Financeiro, Social e eventos,
  Materiais/Loja, Comunicação, Patrimônio, Bandeiras, Bateria, Caravanas,
  Feminino, Carnaval. Ativar só as que o servidor usa.
- Dois papéis por área: **Membro** (colabora, vê) e **Gestor** (gere a área e as
  pessoas dela). O gestor de uma área **não** gere as outras.
- **Área não concede permissão sozinha**: o que abre um módulo é o cargo de gestão
  daquele módulo (ex.: `Gestor · Loja` confirma venda).
- **Diretoria enxerga tudo em leitura**; mutação só com cargo de gestão.
- Só **sócio aprovado** entra em área; desligar tira os cargos de área.

No Discord: um par de cargos por área (`MEMBRO • BATERIA`, `GESTOR • BATERIA`),
um canal privado por área, e o quadro de departamentos no mesmo padrão do embed
de hierarquia (`utils/hierarquiaEmbed.js`, atualizado por `guildMemberUpdate`).
O gestor ganha um botão "Incluir / remover da área" restrito à própria área.

### 4.3 Agenda, escala, caravanas e bateria (ADAPTAR + NOVO)

Regras (`modulo-eventos.md`, `modulo-caravanas.md`, `modulo-bateria.md`):

- **Um hub, três tipos**: `GERAL`, `CARAVANA`, `ENSAIO`. Caravana e bateria são
  modos do evento, não sistemas paralelos.
- **Só sócio ativo confirma** (elegibilidade).
- **Confirmação ≠ presença**: confirmar é intenção; presença é marcada no dia
  por quem opera. Taxa de presença = presentes / confirmados.
- **Capacidade + lista de espera FIFO**: lotou, entra na espera; saiu um
  confirmado, sobe o primeiro da fila automaticamente, com aviso por DM.
- **Recorrência** semanal (ensaio): editar "só este" ou "este e os próximos".
- **Lembrete** antes do evento.
- **Escala** ("quem trabalha"): coordenação, condução, bandeira, bateria,
  acolhimento… Uma pessoa, um posto por operação; a pessoa aceita ou recusa;
  pendência se não houver coordenação ou se ninguém respondeu a ≤ 48h.
- **Caravana**: vaga com capacidade; embarque **ida e volta** separados (quem
  apareceu na volta sem ter ido é buraco para o gestor ver); veículos com
  capacidade própria e uma pessoa por veículo; lista nominal por veículo.
- **Bateria**: ensaio com presença; instrumentos ficam no patrimônio.

No Discord: substituir as reações por **botões** (`Confirmar`, `Desistir`) — com
reação não dá para barrar quem não é sócio antes de contar. O embed mostra
confirmados, vagas e fila. Presença e embarque por botão restrito a quem opera o
evento. Hoje a lista é lida da reação a cada clique (`utils/eventoDebounce.js`)
e se perde se a mensagem for apagada.

### 4.4 Patrimônio e bandeiras (NOVO)

Regras (`modulo-patrimonio.md`, `modulo-bandeiras.md`):

- Item com categoria, status, quantidade, onde fica guardado, responsável e foto.
- **Empréstimo exige foto na saída e foto na devolução**; o gestor pode marcar
  "devolvido com dano".
- Empréstimo pode sair **para um evento**; o que não voltou de evento já passado
  vira pendência.
- **Baixa preserva histórico**; exclusão só para correção.
- **Bandeiras é recorte**: o cargo de Bandeiras vê e gere **só** bandeira, faixa e
  mastro; o gestor de Patrimônio gere tudo, inclusive bandeira. Na edição, confere
  categoria de origem **e** de destino.

No Discord: fórum `🗃️・acervo` com um tópico por item (foto de capa, ficha no
primeiro embed); botões "Retirar" e "Devolver" pedem o anexo da foto no próprio
tópico.

### 4.5 Loja (PORTAR do bot legado)

O `botpde/apps/bot` já tem a loja funcionando no Discord: catálogo com estoque
por tamanho, carrossel de fotos, pedido que abre canal privado na categoria da
loja, chave Pix, confirmação por `RESPONSÁVEL LOJA`, baixa de estoque só na
confirmação, log de venda, resumo de vendas e transcript. **Portar, não
reescrever.**

**Dinheiro do jogo:** a chave Pix do legado sai. O pedido mostra o valor na
moeda do jogo e o responsável confere o pagamento — ou o log da transferência,
se o webhook registrar (§4.10).

Regras do módulo web que o legado não tem e valem trazer (`modulo-loja.md`):
cancelamento restaura estoque; teto de unidades por item; nome do produto
gravado no pedido (snapshot); pedido confirmado lança receita no financeiro, uma
vez só.

### 4.6 Financeiro (NOVO)

Regras (`modulo-financeiro.md`):

- Lançamento com tipo (receita/despesa), categoria fixa (mensalidade, loja,
  evento, caravana, patrimônio, doação, rifa, outros), valor **sempre positivo**
  (o sinal vem do tipo), data e descrição.
- **Saldo é derivado**, nunca digitado.
- Ser do departamento Financeiro **não** basta para ver o caixa.
- Rateio opcional por evento: é o que responde "a caravana fechou no azul?".
- **Balanço público** com nível escolhido pela presidência: só totais, por
  categoria ou completo.
- Loja e rifa lançam receita sozinhas.
- **Moeda do jogo.** Movimentação de dinheiro que já chega pelo webhook vira
  lançamento automático (§4.10); digitação manual só para o que o jogo não registra.

### 4.7 Rifas (NOVO)

Regras (`modulo-rifas.md`):

- O **número é a chave**; "rifa de nomes" é só a forma de exibir.
- Reserva expira (15 min) e é **retomada**, não apagada; pago nunca cede.
- Limite de números por pessoa; comprar é vínculo ativo, não permissão.
- **Sorteio auditável**, escolhido na criação: sistema com commit-reveal (hash da
  semente publicado antes da venda), Loteria Federal ou manual com evidência.
  Regra de número não vendido definida na criação.
- Data do sorteio só é divulgada ao atingir 70% vendidos, dizendo quanto falta
  **em números**.
- Resultado = arrecadado − prêmio. Dinheiro do jogo: sem taxa de gateway e sem a
  restrição da Lei 5.768/1971, que só vale para dinheiro real. Sorteio pelo
  sistema (commit-reveal) ou manual com evidência — Loteria Federal não se aplica.

### 4.8 Confiança (NOVO, opcional)

Regras (`modulo-confianca.md`): sinais caros (presença em evento, mensalidade,
aprovação; reprovação desconta); post e reação não contam; queda rápida, subida
lenta; níveis Novato · Conhecido · De casa · Referência; **não concede
permissão** e **sem ranking público**. No Discord: nível como cargo cosmético.
Obs.: o ranking público de recrutadores que já existe mede outra coisa e fica.

### 4.9 Memória (NOVO, tardio)

Linha do tempo por dia: jogo, evento, foto. Fato registrado depois do dia passa
por aprovação. No Discord: fórum `📜・memória`, um tópico por data, com o bot
anexando os eventos daquele dia.

### 4.10 Inteligência de logs do jogo (ADAPTAR)

Hoje o FiveM publica "Registro de Atividade" por webhook no canal
`logs-liderança` (`1461544673825783929`), e o bot lê só para o alerta de novato
(`events/messageCreate.js:19-54`). **Os logs ficam como estão**: webhook e canais
não mudam. O bot passa a ler, estruturar e responder perguntas sobre eles.

Regras (aprendidas dos insights do BotPDE — `eventos-insights`, evolução do
financeiro, `ListagemSpec`):

- **Ingestão idempotente.** Cada mensagem do webhook vira uma linha em
  `logs_jogo` com `message_id` único (reprocessar não duplica): canal, categoria
  (lida do rodapé `Categoria: …`), ação, nome e ID FiveM de quem agiu, alvo,
  valor, data e o embed bruto. O que o parser não reconhece é gravado como
  `desconhecido` — nunca descartado.
- **Backfill paginado** do histórico inteiro do canal (a falha 4 da §7 é
  justamente ler só 100 mensagens).
- **Vínculo ID FiveM ↔ Discord** pelo nick padrão `S GDF | nome - ID`
  (`utils/formatarNick.js`) e pela ficha de recrutamento. É o que liga log a sócio.
- **Filtros** (`/logs`): ID ou membro, categoria, ação, período (hoje · 7d · 30d ·
  intervalo); paginação por botão; resposta privada; só liderança consulta.
- **Estatísticas** (`/estatisticas`): por membro, por categoria e da torcida;
  agrupamento por dia no fuso de São Paulo; período atual × anterior com
  variação; top N. Sem projeção sobre dado vazio — "parado" em vez de inventar
  tendência.
- **Painel fixo** num canal próprio, embed editado periodicamente (mesmo padrão
  da hierarquia).
- **Alertas por regra.** O alerta de novato vira a primeira regra de um conjunto:
  ID da lista "não recrutar" apareceu no jogo; novato no jogo sem recrutamento no
  Discord após N dias; sócio sem atividade há N dias; movimentação de dinheiro
  fora do padrão.
- **Cruzamentos com os módulos:** funil de recrutamento (entrou no jogo → pediu
  recrutamento → aprovado); presença em evento; financeiro alimentado por log de
  dinheiro; patrimônio por log de baú/item, quando existir.
- Estatística **não concede permissão nem pune sozinha**: o alerta avisa quem
  decide (princípio 3).

## 5. Fundação técnica (antes de qualquer módulo)

1. **Config centralizada.** IDs de canal e cargo estão espalhados em
   `events/interactionCreate.js`, `utils/*.js` e `commands/*.js`. Levar tudo para
   `config/index.js`, como o bot legado já fez.
2. **Roteador de interações por módulo.** `interactionCreate.js` tem ~1100 linhas
   de `if` em sequência. Cada módulo novo ganha seu arquivo de handlers
   (`modulos/eventos.js`, `modulos/loja.js`…) registrado por prefixo de
   `customId`.
3. **Utilitários comuns**: log de gestão (`utils/logGestao.js`), gates por cargo
   (`utils/permissoes.js`, `utils/departamentos/acesso.js`) e transação
   (`utils/transacao.js`). A elegibilidade do BotPDE não virou módulo genérico:
   cada gate aplica a regra que usa (sócio ativo para confirmar, comprar e assumir
   posto; desligado sai de área).
4. **Agendador persistente** para prazos (ADV, lembrete de evento, reserva de
   rifa, carteirinha vencendo): tabela de tarefas + varredura periódica, em vez
   de `setTimeout`.
5. **Persistência:** Postgres do bot para o que é relacional (logs ingeridos,
   financeiro, rifas, patrimônio, lista de espera). Canais do Discord seguem como
   exibição e log — os logs do webhook continuam onde estão.

## 6. Fases

| Fase | Entrega | Por quê primeiro |
|---|---|---|
| 0 | Fundação (§5) + falhas 3–6 da §7 | Tudo depois depende disso |
| 1 | Inteligência de logs (4.10) | Os dados já chegam hoje; o vínculo ID FiveM ↔ Discord é base de presença, financeiro e recrutamento |
| 2 | Associação e carteirinha (4.1) + Departamentos (4.2) | Quem é sócio e quem gere o quê é base de todo gate |
| 3 | Agenda com botões, lista de espera e presença (4.3) | Módulo mais usado; já existe e está frágil |
| 4 | Loja portada (4.5) + Financeiro (4.6) | Loja já pronta no legado; alimenta o caixa |
| 5 | Escala, caravanas, bateria (4.3) + Patrimônio/Bandeiras (4.4) | Operação de dia de jogo |
| 6 | Rifas (4.7) | Depende do financeiro e do agendador |
| 7 | Confiança (4.8) e Memória (4.9) | Dependem de presença e eventos |

Todas as fases acima foram entregues (a 6 numa sessão paralela) — detalhe em §9.

## 7. Falhas atuais do botfivem

1. ~~Advertência de recrutador usava os cargos ADV¹/²/³ de sócio~~ — corrigido
   (2026-09-11): lê `config.cargos.advRec`; bloqueado até os 3 IDs serem preenchidos.
2. ~~Carteirinha emitida sem conferir o cargo SÓCIO~~ — corrigido (2026-09-11).
3. ~~Vencimento da advertência dependia de `setTimeout`~~ — corrigido: tarefa em
   `tarefas_agendadas`, executada por `utils/agendador.js` (também a remoção do
   cargo PROVAR MANTO). ADV registrada **antes** deste deploy não tem tarefa e
   precisa ser acompanhada à mão.
4. ~~"Não recrutar" só lia as 100 últimas mensagens~~ — corrigido:
   `utils/naoRecrutar.js` pagina o histórico inteiro (cache de 5 min, invalidado
   ao bloquear/desbloquear). Se a leitura falhar, a aprovação **não** acontece.
5. ~~Aprovação sem trava contra clique duplo~~ — corrigido: trava por ficha em
   memória + ficha sem botões é recusada.
6. ~~Desligar não revogava a carteirinha~~ — corrigido: perder o cargo SÓCIO grava
   `socios.revogada_em` e tira do mural; recuperar restaura com o mesmo número.
   No start, `reconciliarCarteirinhas` acerta quem mudou com o bot desligado.

## 8. Decisões

Fechadas em 2026-09-11:

1. **Dinheiro do jogo.** Sem Pix, sem taxa de gateway; rifa sem a restrição legal
   de dinheiro real.
2. **Logs do webhook ficam como estão.** O bot ingere e gera filtros, estatísticas
   e alertas (§4.10). Dados relacionais no Postgres do bot.
3. **Todos os módulos** (caravana, bateria, bandeiras, patrimônio, social…) e
   **todas as 11 áreas** canônicas.

Em aberto:

1. **Formato dos logs do webhook.** O bot só conhece um hoje: título
   `Registro de Atividade: {nome}`, descrição "O Novato **X** (ID: **Y**) entrou na
   sua torcida **Novato**." e rodapé `Time: Gaviões da Fiel | Categoria: lideranca`.
   O parser precisa de: quais canais recebem webhook, quais categorias existem e
   um exemplo de cada tipo de registro. Destrava: nome das ações nos filtros, alerta
   de dinheiro fora do padrão e lançamento automático no financeiro a partir do log.
2. **IDs dos cargos ADV¹/²/³ de recrutador** (`config.cargos.advRec`). Até lá a
   advertência de recrutador fica bloqueada com aviso.
3. **Canal do painel fixo de estatísticas** (`config.logsJogo.canalPainel`).
4. **Cargos cosméticos de nível de confiança** (`config.confianca.cargosNivel`) —
   opcional.

## 9. Estado da implementação

### Fase 0 — fundação (entregue em 2026-09-11)

| Peça | Onde |
|---|---|
| Config centralizada (nenhum ID solto no código) | `config/index.js` |
| Estrutura do banco, só aditiva, a cada start | `utils/migracoes.js` |
| Agendador persistente + tipos de tarefa | `utils/agendador.js`, `utils/tarefas.js` |
| Roteador de interações por módulo (`<modulo>:<acao>:…`) | `utils/modulos.js` |
| Gate de liderança conferido no handler | `utils/permissoes.js` |
| Lista "não recrutar" completa | `utils/naoRecrutar.js` |
| Carteirinha acompanha o cargo SÓCIO | `utils/carteirinhaSocio.js`, `events/guildMemberUpdate.js` |

### Fase 1 — inteligência de logs (entregue em 2026-09-11)

| Peça | Onde |
|---|---|
| Parser (novato + genérico: categoria, IDs, valor) | `utils/logsJogo/parser.js` |
| Gravação idempotente e sincronização do histórico | `utils/logsJogo/ingestao.js`, `repositorio.js` |
| Alertas: novato (mesmo embed de antes) e ID da lista "não recrutar" ativo no jogo | `utils/logsJogo/alertas.js` |
| Estatísticas puras (dia de SP, janela anterior, série, sparkline) | `utils/logsJogo/estatisticas.js` |
| Embeds de estatística e painel fixo | `utils/logsJogo/relatorios.js`, `painel.js` |
| `/logs` com filtros e paginação | `commands/logs.js`, `utils/logsJogo/consultas.js` |
| `/estatisticas torcida · membro · categoria · inativos` | `commands/estatisticas.js` |
| `/logs-sincronizar [completo]` | `commands/logs-sincronizar.js` |
| Testes (`npm test`) | `test/` |

**Para ativar:** `npm run deploy` (registra os comandos novos) e reiniciar o bot.
No start ele cria as tabelas, lê o histórico do canal de logs e reconcilia as
carteirinhas. Painel fixo: preencher `logsJogo.canalPainel`. Advertência de
recrutador: preencher `cargos.advRec`.

### Fase 2 — associação, carteirinha e departamentos (entregue em 2026-09-11)

| Peça | Onde |
|---|---|
| Ficha de recrutamento no banco (pendente → aprovada/reprovada) | `utils/recrutamento/fichas.js`, tabela `fichas_recrutamento` |
| Solicitação barrada se já for sócio, se houver ficha pendente (até 7 dias) ou reprovação definitiva | `utils/recrutamento/regras.js` |
| Área pretendida escolhida antes do formulário; vira cargo **só na aprovação** | `utils/recrutamento/fluxo.js` |
| Botão "Aprovar sem área" quando a ficha tem área | `utils/recrutamentoButtons.js` |
| Reprovação com laudo: categoria + pode/não pode tentar de novo + justificativa (15–1000), enviada por DM | `utils/recrutamento/fluxo.js` |
| Carteirinha vigente · vencendo (≤ 30 dias) · vencida, derivada na leitura | `utils/carteirinha/regras.js` |
| `/carteirinhas situacao` e `/carteirinhas renovar` (liderança; renovar antes de vencer não perde dias) | `commands/carteirinhas.js` |
| DM 7 dias antes de vencer e no vencimento (uma vez por ciclo) | `utils/carteirinha/vencimentos.js` |
| 10 áreas (Diretoria fica no cargo `GDF • DIRETORIA` que já existe) com cargo MEMBRO/GESTOR e canal privado | `config/index.js` → `departamentos`, `utils/departamentos/setup.js` |
| `/departamentos incluir · remover · quadro · setup` — gestor gere membros da própria área; gestor só a presidência define | `commands/departamentos.js`, `utils/departamentos/regras.js` |
| Quadro automático de departamentos e canal de logs de gestão | `utils/departamentos/quadro.js`, `utils/logGestao.js` |
| Desligado (perdeu SÓCIO) sai de todas as áreas | `events/guildMemberUpdate.js` |

**Para ativar:** `npm run deploy` (comandos `/departamentos` e `/carteirinhas`),
reiniciar o bot e rodar **`/departamentos setup`** uma vez (administrador). Sem o
setup, o recrutamento segue sem a pergunta de área.

**Permissões nos canais das áreas:** membro e gestor escrevem; presidente e vice
escrevem em todas; velha guarda e diretoria acompanham todas em leitura. Canal que
já existe não tem as permissões reescritas ao rodar o setup de novo.

### Fase 3 — agenda (entregue em 2026-09-11)

| Peça | Onde |
|---|---|
| Eventos no banco com tipo (evento, caravana, ensaio), local, vagas e área dona | `utils/eventos/*`, tabelas `eventos`, `evento_inscricoes` |
| Botões CONFIRMAR / DESISTIR só para sócio; vaga serializada por evento (FOR UPDATE) | `utils/eventos/repositorio.js` |
| Lista de espera FIFO: quem desiste libera a vaga e o primeiro da fila é avisado por DM | idem |
| Presença ≠ confirmação: marcada por quem organiza; quem veio sem confirmar conta à parte | `utils/eventos/interacoes.js` |
| Série semanal (ensaios) publicada 7 dias antes; lembrete por DM 1h antes; inscrições fecham no início | `commands/evento.js`, `utils/tarefas.js` |
| `/evento criar · lista · cancelar · relatorio` (comparecimento, no-show, mais presentes) | `commands/evento.js` |

Mensagens antigas com reação 🦅 continuam funcionando; o `/evento` antigo (modal) saiu.

### Fase 4 — loja e financeiro (entregue em 2026-09-11)

| Peça | Onde |
|---|---|
| Livro-caixa: receita/despesa, categoria, saldo derivado, rateio por evento | `utils/financeiro/*`, tabela `financeiro_lancamentos` |
| `/financeiro lancar · extrato · balanco · publicar-balanco · excluir` — ver: liderança ou área Financeiro; lançar: presidência ou gestor | `commands/financeiro.js` |
| Lançamento automático idempotente por origem (loja, rifa) e só apagável no módulo de origem | índice `uq_financeiro_origem` |
| Loja: catálogo com estoque por tamanho, reserva no pedido (FOR UPDATE), cancelar devolve | `utils/loja/*`, tabelas `loja_produtos`, `loja_pedidos` |
| Pedido abre canal privado com a equipe de Materiais e Loja; confirmar lança a receita, arquiva o transcript e fecha | `utils/loja/interacoes.js` |
| `/loja produto-adicionar · produto-editar · produtos · vendas · setup` | `commands/loja.js` |
| Imagens reenviadas para um canal de arquivo (link de anexo do Discord expira) | `utils/arquivoMidia.js` |

### Fase 5 — dia de jogo (entregue em 2026-09-11)

| Peça | Onde |
|---|---|
| Escala por função com convite e aceite por DM; pendências (sem coordenação, silêncio ≤ 48h, recusas) | `utils/escala/*`, `commands/escala.js` |
| Caravana: veículos com capacidade (FOR UPDATE), alocação só de confirmado, embarque ida/volta | `utils/caravana/*`, `commands/caravana.js` |
| Embarque da ida conta como presença no evento (e na confiança); volta sem ida aparece no manifesto | `commands/caravana.js` |
| Manifesto por veículo com pendências e resultado financeiro (só para quem vê o caixa) | `utils/caravana/manifesto.js` |
| Patrimônio: acervo com foto, retirada/devolução com foto obrigatória, baixa preservando histórico, pendências | `utils/patrimonio/*`, `commands/patrimonio.js` |
| Recortes: Bandeiras só `BANDEIRA` (bandeira/faixa/mastro), Bateria só `INSTRUMENTO`; edição confere origem e destino | `utils/patrimonio/regras.js` |

### Fase 6 — rifas (entregue em 2026-09-11, em sessão paralela)

| Peça | Onde |
|---|---|
| Número é a chave: PK (rifa_id, numero); reserva de 15 min retomada (não apagada); pago nunca cede | `utils/rifas/repositorio.js`, tabelas `rifas`, `rifa_compras`, `rifa_bilhetes` |
| Compra só de sócio: números escolhidos ("7, 13, 20-22") ou aleatórios; limite por pessoa (padrão 10%) | `utils/rifas/interacoes.js` |
| Pagamento no jogo: comprador avisa "JÁ PAGUEI" (a reserva deixa de vencer) → equipe confirma ou recusa no canal privado | `utils/rifas/interacoes.js`, `/rifa setup` |
| Confirmação lança RECEITA `RIFA` (origem `RIFA` + id da compra); cancelar a rifa lança o estorno (origem `RIFA_ESTORNO`) | `financeiro/repositorio.lancar` |
| Data do sorteio só com 70% vendidos, dizendo quantos números faltam | `/rifa marcar-sorteio` |
| Sorteio auditável: pelo bot (commit-reveal: SHA-256 da semente publicado na criação, HMAC sobre a lista de pagos) ou ao vivo com evidência; regra de número não vendido fixada na criação | `utils/rifas/regras.js`, `/rifa sortear` |
| Gerir: presidência ou gestor do Social; conferir pagamento: também gestor do Financeiro; relatório: também a liderança | `utils/rifas/permissoes.js` |

**Para ativar:** `npm run deploy` e `/rifa setup` (cria `🎟️・rifas-pagamentos`, visível
só para presidência e gestores do Social e do Financeiro).

**Limites:** não há estorno de uma compra paga isolada (só cancelando a rifa); quem
tem acesso direto ao banco vê a semente antes do sorteio; sem prêmios múltiplos nem
talão físico.

### Fase 7 — confiança e memória (entregue em 2026-09-11)

| Peça | Onde |
|---|---|
| Ledger de sinais (presença +15 com teto de 45/30 dias, admissão +20, reprovação −40); não concede permissão | `utils/confianca/*`, tabela `confianca_eventos` |
| `/confianca`: nível visível para todos; score, progresso e sinais só para a própria pessoa; liderança com piso "De casa"; sem ranking | `commands/confianca.js` |
| Cargo cosmético por nível, opcional | `config.confianca.cargosNivel` |
| Memória em fórum, um tópico por dia; fato de dia passado vai para aprovação (liderança ou gestor de Comunicação) | `utils/memoria/*`, `commands/memoria.js` |
| Resumo automático do evento na memória 6h depois do início (se houve presença) | tarefa `evento_memoria` |

**Para ativar as Fases 3–7:** `npm run deploy`, reiniciar, e como administrador
`/loja setup`, `/rifa setup` e `/memoria setup` (depois do `/departamentos setup` da
Fase 2, para os canais já nascerem com os cargos das áreas).

### Fechamento do plano (2026-09-11)

Os dois itens do plano que ainda faltavam e não dependiam da torcida:

| Peça | Onde |
|---|---|
| Bloqueio "não recrutar" recusa ID de sócio ativo: desligar antes (atos separados) | `events/interactionCreate.js` (`modal_bloquearid`) |
| Funil de recrutamento a partir dos logs: novato no jogo → pediu no Discord → aprovado | `/estatisticas recrutamento`, `utils/recrutamento/funil*.js` |
| Alerta a cada 6h de novato que não pediu recrutamento em 3 dias (uma vez por ID) | `utils/recrutamento/alertaNovatos.js`, tabela `alertas_enviados` |

**Fora do escopo, de propósito:** comunicados, comunidade, grupos e salas (nativos
do Discord); bar, PDV, portaria e alianças (N/A); alerta de dinheiro fora do padrão
e financeiro alimentado por log (dependem de §8.1).

**Achado de auditoria (2026-09-12):** `config.js` na raiz era um arquivo legado
(pré-reestruturação, sem `guildId`/`departamentos`/`logsJogo`, cargos por **nome**
em vez de ID) e `index.js` fazia `require('./config')` — que o Node resolve para
`config.js` antes de tentar o diretório `config/`. Nenhum handler novo era afetado
(todos importam `../config/index.js` explicitamente), mas o objeto legado era
carregado à toa e passado como `_config` (não usado) para `interactionCreate.js`.
Removido `config.js`; `index.js` agora aponta explicitamente para
`./config/index.js`. `npm run lint` também está quebrado desde antes desta fase
(script chama `eslint`, nunca instalado como dependência) — fora do escopo deste
plano, registrado aqui para não se perder.

**Verificação feita fora do Discord:**

| Verificação | Resultado |
|---|---|
| Testes das regras puras (`npm test`) | 65/65 |
| Carregamento dos 28 comandos e 6 eventos com definição aceita pela API | ok |
| Integração contra Postgres (PGlite): migrações 2× e repositórios de logs, fichas, funil, departamentos, eventos, escala, caravana, financeiro, loja, patrimônio, confiança, memória, carteirinha e agendador (`npm run test:integracao`) | 16/16 |
| Integração das rifas (escrita na sessão da Fase 6, mesmo comando) | 16/16 |

**Não coberto:** o Discord real (permissões de canal, modais e selects no cliente,
DMs) e concorrência real — o PGlite tem uma conexão só, então as travas `FOR UPDATE`
foram validadas na lógica, não sob disputa.

**Ativação, nesta ordem:**

1. `npm install` e `npm run deploy` (registra os comandos na guild).
2. Reiniciar o bot: cria as tabelas, lê o histórico do canal de logs e reconcilia as carteirinhas.
3. Cargo do bot com Gerenciar Cargos e Gerenciar Canais, **acima** dos cargos novos.
4. Como administrador: `/departamentos setup` → `/loja setup` → `/rifa setup` → `/memoria setup`.
5. Presidência define os gestores: `/departamentos incluir membro:@x area:… papel:Gestor`.

**Roteiro de teste no servidor antes de anunciar:**

1. Recrutamento escolhendo área → aprovar → confere cargo SÓCIO, cargo MEMBRO da área e `/estatisticas recrutamento`. Reprovar outra ficha com laudo → candidato recebe a DM.
2. Bloquear o ID de um sócio ativo → deve recusar.
3. `/carteirinha` mostra a situação; `/carteirinhas renovar` estende a validade.
4. `/evento criar capacidade:1` → duas contas confirmam (a segunda vai para a espera) → a primeira desiste → a segunda recebe DM.
5. Caravana: `/caravana veiculo`, `alocar`, `embarque` na ida → a presença aparece no evento → `/caravana manifesto`.
6. Loja: produto com foto → pedido → confirmar → a receita aparece em `/financeiro extrato`.
7. Patrimônio: `/patrimonio retirar` com foto → `/patrimonio pendencias` → `devolver`.
8. Rifa: criar → comprar → JÁ PAGUEI → confirmar → sortear.
9. `/logs-sincronizar` → `/logs` e `/estatisticas torcida`.
10. `/confianca` depois de uma presença marcada; `/memoria registrar` com data passada → aprovar no canal da Comunicação.

**Limite atual:** só o log de novato é reconhecido pelo nome da ação; o resto
entra como `desconhecido`, com categoria, IDs e valor extraídos quando o texto
permite. Cada exemplo real de log vira uma regra em `parser.js`.

# Catálogo de reuso: o que já existe antes de construir

Consulte **antes** de escrever qualquer coisa nova. Se o que você precisa está aqui,
use; se descobrir algo reutilizável que não está, acrescente na mesma entrega.

## Visual
| Preciso de… | Use |
|---|---|
| cor / emoji / marca / imagem | `tema/` (contrato: `docs/contratos/tema.md`) — nunca literal |
| tabela, rodapé, lista em embed | `utils/logsJogo/painelFormato.js` |
| selects de período/jogador, botão, paginação | `utils/logsJogo/painelComponentesFixos.js` |
| canal com painel fixo + exploração ephemeral | `utils/logsJogo/painelCanal.js` |
| gráfico | `utils/logsJogo/graficoFarmPorDia.js` (modelo); canvas |
| canal por categoria criado sob demanda, só liderança (casos) | `utils/recrutamento/mantoCasos.js` (`garantirCanalCaso`) + `permissoesLideranca` de `painelCanal.js` |
| carteirinha (imagem) | `utils/gerarCarteirinha.js` |

## Fluxo
| Preciso de… | Use |
|---|---|
| editar número/dado manual | botão → select → modal de 1 campo (`docs/contratos/padroes-ui.md`) |
| roteamento de botão/select/modal | `registrarModulo('<prefixo>')` em `utils/modulos.js` |
| botão fixo que precisa ficar sempre por último no canal | `utils/sugestoes/painel.js#garantirPainelNoFim` (apaga o antigo e reposta no fim) |
| votação com um voto por pessoa (retira/troca) | `utils/sugestoes/repositorio.js#votar` |
| recrutador+ (sem o sócio comum) | `utils/permissoes.js#ehRecrutadorOuAcima` |
| botão de "desfazer" com prazo numa decisão (some sozinho) | `utils/recrutamento/desfazer.js` (`abrirJanelaDesfazer` + tarefa de expirar + `fichas.desfazerDecisao` em transação) |
| tarefa com data (vencimento, remoção de cargo) | `utils/agendador.js` (tabela `tarefas_agendadas`) |
| gravar várias tabelas juntas | `utils/transacao.js` |
| ler/gravar configuração do painel | `utils/botConfig.js` |
| permissão por cargo/área | `utils/permissoes.js` |
| novo módulo | manifesto em `modulos/` (`docs/contratos/modulos.md`) |
| nova fonte de log do jogo | adapter em `fontes/` (`docs/contratos/eventos-canonicos.md`) |
| novo tenant / onboarding | `docs/contratos/tenant.md`, `utils/setup/` |

## Ferramentas de verificação
| Preciso de… | Use |
|---|---|
| rodar fluxo real sem tocar em nada | `tools/banco-em-memoria.js` + `tools/discord-falso.js` (exemplo: `test/fluxos.gavioes.test.js`) |
| provar que cor/ID/marca não vazaram | `npm run conformidade` |
| provar que um require não quebrou | `test/requires.test.js` |
| testar em outra versão de Node | `npm run testar:node -- <versões>` |
| retrato do que sobe por tenant | `npm run modulos` |

## Inteligência de recrutadores
| Preciso de… | Use |
|---|---|
| tabela com colunas apertadas (1 espaço) para caber em uma linha | `painelFormato.js#tabela(colunas, linhas, { separador: ' ' })` |
| cruzar dados de OUTRO módulo no painel sem acoplar | `inteligenciaRecrutadores.js#registrarEnriquecedor` (o módulo dono dos dados se pluga em `carregar()`) |
| "há quanto tempo", tendência ▲▼, meta %, fração | `inteligenciaRecrutadores.js` (`tempoDesde`, `celulaTendencia`, `celulaMeta`, `celulaFracao`) |
| pares recrutador→recrutado com ocorrência depois / sem atividade depois | `logsJogo/repositorio.js#recrutadosComOcorrenciaDepois`, `#recrutadosSemAtividadeDepois` |
| risco de advertência (aviso preventivo) | `advertenciaRecrutadorAuto/regras.js#riscos` |
| membro/DM/interação em teste | `tools/discord-falso.js` (`membro.dms`, `criarInteracao({ tipo: 'select'\|'usuario' })`) |

## Inteligência cruzada
| Preciso de… | Use |
|---|---|
| não repetir um alerta (sobrevive a reinício) | `utils/alertaPersistente.js#jaAlertadoRecentemente(tipo, chave, janelaMs)` |
| comparar nome de jogador (ID troca por season) | `utils/nomes.js` (`similaridade`, `normalizarNome`, `nomeDoNick`) e `inteligencia/regras.js#nomesParecidos` |
| resumo/risco de um sócio sem refazer 6 consultas | `inteligencia/repositorio.js#resumoDe` (tabela `associado_resumo`) |
| sócios do Discord ligados ao ID do jogo | `inteligencia/pessoas.js#carregarSocios` |
| relatório pronto em embed (risco, recrutamento, baú, farm, eventos…) | `inteligencia/relatorios.js` |
| consultar a lista não recrutar sem reler o canal | `utils/naoRecrutarEspelho.js#ativos` (tabela `nao_recrutar`) |
| reagir a ficha enviada sem mexer no recrutamento | `utils/recrutamento/ganchos.js#aoFichaEnviada` |
| canal privado da liderança criado sob demanda | `inteligencia/canais.js#garantirCanalInteligencia` |
| tempo de atendimento de ticket | `utils/ticketRegistro.js` |
| saída de um jogador nos logs (ator OU alvo conforme a ação) | `logsJogo/analises.js#idQueSaiu` e `logsJogo/repositorio.js#primeiraSaidaPorAlvo` |
| estado atual de uma peça/fechadura a partir de eventos | último evento por chave (`patrimonioForaDoBau`, `analises.js`) — o jogo publica evento, não estado |
| seção opcional que depende de módulo que pode estar desligado | consulta na pasta do módulo dono + `relatorios.js#opcional` (tabela ausente = seção some) |
| limitar alerta por mensagem sem perder itens | parar o laço ao atingir o limite ANTES de marcar como avisado (`varredura.js`) |

## Sorteios
| Preciso de… | Use |
|---|---|
| número aleatório sem repetir dentro de um intervalo | `utils/sorteios/regras.js#escolherNumero` (`crypto.randomInt`) |
| jogadores distintos que colaram num dia, numerados e ligados ao Discord | `utils/sorteios/participantes.js#participantesDoDia` |
| sortear/gravar sem corrida entre dois cliques | `utils/sorteios/repositorio.js` (transação + `FOR UPDATE` + índice único parcial) |
| DM que só marca "avisado" se chegou | `utils/sorteios/interacoes.js#notificarGanhadores` (modelo) |
| criar canal público só-leitura na categoria dos registros diários | `utils/sorteios/estrutura.js#montarEstruturaSorteios` |
| botão fixo sempre por último em canal com posts do bot | `utils/sorteios/estrutura.js#garantirPainelNoFim` (mesmo padrão de sugestões) |
| um fluxo reagir a outro sem conhecê-lo (ficha decidida, ADV, ticket…) | `utils/barramento.js` (`assinar`/`emitir`) — módulo desligado não assina |
| acrescentar campo de outro módulo num embed que já existe | `utils/enriquecedores.js` (`registrar`/`coletar`) |
| algo que precisa acontecer daqui a horas/dias e sobreviver a reinício | `agendar` + `registrarTipo` (`inteligencia/fluxos.js#acompanhar` é o modelo; a tarefa reconfere o estado ao rodar) |
| quem tem o jogo aberto agora entre os que têm um cargo | `inteligencia/pessoas.js#recrutadoresOnline` |
| alerta que a liderança precisa resolver, ignorar ou agir (com rastreio e métrica) | `inteligencia/casos.js#enviar` (caso + botões) e `interacoes.js` (`intel:<acao>:<id>`) |
| caso que se fecha sozinho quando a condição some | `varredura.js#resolverCasosAutomaticos` (um teste por tipo) |
| filtrar elegíveis (tempo mínimo, ganhadores recentes por ID/Discord/nome) e selar a lista | `sorteios/regras.js#filtrarElegiveis`, `#hashLista` |
| quem está com o jogo aberto agora (sessão viva) | `sorteios/participantes.js#idsOnlineAgora` |
| tarefa agendada que se reagenda até N vezes | `sorteios/tarefas.js#lembrarEntrega` (modelo) |
| reeditar/republicar mensagem viva que pode ter sido apagada | `sorteios/interacoes.js#atualizarMensagem` |

## Mérito de recrutadores
| Preciso de… | Use |
|---|---|
| seção extra no quadro `📘・regras-recrutadores` sem acoplar módulos | `advertenciaRecrutadorAuto/paineis.js#registrarSecaoRegras(fn)` |
| pontuar/ranquear recrutador, semana contável, fraude, votação (função pura) | `utils/merito/regras.js` |
| decisão de liderança com 2 passos (pendência → decidir) sem modal de vários campos | `utils/merito/interacoes.js` (botão → select → select/modal de 1 campo) |
| ranking, votação e pendências da liderança em canal-painel | `utils/merito/paineis.js` (`criarPainelCanal` + ação sempre por último) |
| recálculo em segundo plano que o teste pode aguardar | `utils/merito/servico.js#aguardarRecalculo` |
| debounce que não segura o processo | `painelCanal.js` (`timer.unref`) |

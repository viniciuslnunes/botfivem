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
| carteirinha (imagem) | `utils/gerarCarteirinha.js` |

## Fluxo
| Preciso de… | Use |
|---|---|
| editar número/dado manual | botão → select → modal de 1 campo (`docs/contratos/padroes-ui.md`) |
| roteamento de botão/select/modal | `registrarModulo('<prefixo>')` em `utils/modulos.js` |
| botão fixo que precisa ficar sempre por último no canal | `utils/sugestoes/painel.js#garantirPainelNoFim` (apaga o antigo e reposta no fim) |
| votação com um voto por pessoa (retira/troca) | `utils/sugestoes/repositorio.js#votar` |
| recrutador+ (sem o sócio comum) | `utils/permissoes.js#ehRecrutadorOuAcima` |
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

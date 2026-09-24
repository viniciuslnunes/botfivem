# Contrato: padrões de UI/fluxo

> Fonte do detalhe e da história de cada padrão: `docs/padroes.md` § 1. Este
> arquivo é o resumo operacional: **antes de desenhar tela ou fluxo novo,
> encaixe-o em um destes**; só invente padrão novo se nenhum servir (e então
> registre em `docs/padroes.md`).

| Preciso de… | Use | Onde |
|---|---|---|
| canal com estado atual sempre visível | **canal-painel interativo**: 1–2 mensagens fixas editadas no lugar + bloco de componentes no fim; resposta ephemeral | `utils/logsJogo/painelCanal.js#criarPainelCanal`; módulo via `modulos/_painelDeLog.js` |
| número que a liderança corrige à mão | **botão EDITAR → select do campo → modal de 1 campo**, valor em `bot_config` com `jsonb_set` | `presencaInteracoes.js`, `painelCaixaInteracoes.js` |
| número que se corrige sozinho a cada log | **ajuste automático sobre valor manual** (só se já há baseline) | `incrementarSociosManual`, `incrementarSaldoCaixaManual` |
| teto que alerta ao ser passado | **limite editável + alerta só na transição + atalho para o fluxo manual** | `farmLimites.js`, `alertas.js#montarAlertaLimiteDiarioFarm` |
| ranking com várias colunas | **tabela em texto por item + gráfico por DIA** | `painelFormato.js#tabela`, `graficoTerritoriosPorDia.js` |
| roteamento de botão/select/modal | **`registrarModulo('<prefixo>')`**, customId `<prefixo>:<acao>:…` | `utils/modulos.js` |
| cor, emoji de estado, marca, imagem | **tema** | `docs/contratos/tema.md` |

Regras de forma que valem em todos:

- Componentes fixos (`selectPeriodo`, `selectBuscarJogador`, `linhaBotao`,
  `linhaPaginacao`) e formatação (`painelFormato.js`: `rodape`, `nomeSeguro`,
  `campoLista`, `embedComLista`, `embedsDeLista`, `tabela`) já existem — não reescrever.
- Todo painel mostra de onde vem o dado (`rodape('canal logs-registros')`) e,
  quando o número é "desde o primeiro log", diz "desde <data>", nunca "estoque".
- Erro que o usuário pode causar volta como resposta ephemeral clara; erro
  inesperado é logado e o handler global responde "ocorreu um erro" (a
  interação nunca fica "pensando").

# Contrato: módulos

> Quem manda: `plataforma/` (contrato, resolvedor, hooks) e `modulos/*.js` (um
> manifesto por módulo). Um módulo é uma fatia que a torcida liga ou desliga em
> `tenant.modulos`. Módulo desligado **não carrega código, não registra comando,
> handler nem painel e não cria tabela**.

## Manifesto (`modulos/<id>.js`)

```js
module.exports = {
  id: 'rifas',                       // camelCase; igual ao nome do arquivo
  descricao: 'Rifas: …',
  padrao: true,                      // ligado quando o tenant não diz nada
  obrigatorio: false,                // true: não pode ser desligado (nucleo, setup)
  instalacao: false,                 // true: também sobe em modo instalação (só o setup)
  requer: ['financeiro'],            // outros módulos que precisam estar ligados
  exige: { canais: [], cargos: [], categorias: [], links: [], marca: [], tenant: [] },
  comandos: ['rifa'],                // arquivos de commands/ (sem .js)
  carregar() { require('../utils/rifas/interacoes'); },   // registra handlers
  aoIniciar(client, ctx) {},
  aoMensagem(message, client, ctx) {},          // devolver true = consumiu
  aoMembroAtualizado(antes, depois, client, ctx) {},
  aoReacaoAdicionada(reaction, user, client, ctx) {},
  aoReacaoRemovida(reaction, user, client, ctx) {},
  painelLog: { iniciar(client), aoRegistros(novos, client) },
};
```

Regras:

- **`require` preguiçoso**: dentro de `carregar()`/hooks, nunca no topo do
  manifesto — senão módulo desligado carrega código.
- **`requer` = dependência de dado/runtime** (tabela, canal, tarefa), não import
  de função pura. Testes em `test/migracoes.test.js` conferem que quem consulta
  uma tabela `requer` o módulo que a cria.
- **`exige`** lista o que o tenant precisa definir para o módulo ligado
  (`canais.recrutamento`, `marca.elenco.logo`, `tenant.parceiros`…). Falta = o
  bot não sobe e diz o que falta.
- **Ordem de `modulos/index.js` = ordem dos hooks.** `logsJogo` vem antes de
  `antiSpam`, antes de `sociais`, antes de `bloqueioId` (mensagem de log é
  consumida primeiro).
- Erro num hook é logado com `[modulo:hook]` e **não derruba os outros**.
- Tabelas do módulo: marque `modulo: '<id>'` em `utils/migracoes.js`.
- Handler de botão/select/modal: `registrarModulo('<prefixo>', fn)` e
  `customId` no formato `<prefixo>:<acao>:…`.

## Painéis de log

Canal-painel de inteligência (padrão de `docs/padroes.md` § 1.1) = manifesto via
`modulos/_painelDeLog.js#manifestoDePainel` (`iniciar`, `agendar`, categorias e
ações de log que o acordam). Não edite `utils/logsJogo/pipeline.js` para um
painel novo.

## Módulos

| id | o que é | padrão | requer |
|---|---|---|---|
| nucleo | permissões, status, tarefas agendadas, botões de configuração | obrigatório | — |
| setup | onboarding (`/setup`) | obrigatório | — |
| departamentos | áreas da torcida, cargos e quadro | sim | — |
| bloqueioId | não recrutar: validar/bloquear/desbloquear ID | sim | — |
| logsJogo | ingestão do webhook, alertas, presença, registros diários | sim | departamentos, bloqueioId |
| antiSpam | conta hackeada espalhando golpe | sim | departamentos |
| sociais | `!ping`, `!sociais`, `!parceiros` | sim | — |
| painelBau | 📦 estoque do baú | sim | logsJogo |
| painelCaixa | 🏦 caixa do jogo | sim | logsJogo |
| painelDisciplina | ⚖️ disciplina | sim | logsJogo |
| painelRestricoes | ⛔ banidos e impedidos | sim | logsJogo |
| painelFechaduras | 🔐 fechaduras | sim | logsJogo |
| painelTags | 🏷️ tags | sim | logsJogo |
| painelTerritorio | 🗺️ territórios | sim | logsJogo |
| painelRecrutadores | 🦅 inteligência de recrutadores | sim | logsJogo |
| painelFarm | 🌾 inteligência de farm | sim | logsJogo, departamentos |
| painelHistorico | 📜 histórico do associado | sim | logsJogo |
| eventos | eventos, presença, reações | sim | departamentos |
| confianca | nível de confiança | sim | eventos |
| escala | escala de funções | sim | departamentos, eventos |
| financeiro | livro-caixa | sim | departamentos |
| caravana | caravanas | sim | departamentos, eventos, escala, financeiro |
| loja | loja | sim | departamentos, financeiro |
| rifas | rifas | sim | departamentos, eventos, financeiro |
| sorteios | 🎁 sorteio de brindes entre quem colou no dia (registro diário) ou números 1..N; canais criados por `/sorteio estrutura` | sim | departamentos, logsJogo |
| patrimonio | patrimônio | sim | departamentos, eventos |
| memoria | memória da torcida | sim | departamentos, eventos |
| carteirinha | carteirinha e mural | sim | — |
| hierarquia | quadro de hierarquia | sim | — |
| elenco | sub-marca do elenco | **não** | — |
| ticket | tickets | sim | — |
| advertencia | advertência de sócio | sim | logsJogo |
| advertenciaRecrutador | advertência de recrutador | sim | — |
| advertenciaRecrutadorAuto | advertência automática de recrutador (inatividade, retenção, manto, ficha) | sim | advertenciaRecrutador, recrutamento, logsJogo |
| recrutamento | recrutamento e quadros de recrutadores | sim | departamentos, confianca, logsJogo, bloqueioId |
| sugestoes | 💡 sugestões de melhoria: recrutador+ envia, sócio+ vota (`canais.sugestoes`, null = sem painel) | sim | — |
| meritoRecrutadores | 🏆 mérito de recrutadores: ciclos de 8 semanas, ranking por constância e qualidade, indicação ao departamento e votação da liderança | sim | recrutamento, logsJogo, advertenciaRecrutadorAuto |
| inteligencia | inteligência cruzada: risco do associado, reincidência, barreira de entrada, boletim semanal, `/inteligencia` | sim | logsJogo, advertencia, recrutamento, bloqueioId, eventos, confianca, departamentos, ticket |
| atualizacoes | 🤖 canal de atualizações: novidades e mudanças de regra postadas sozinhas, só as dos módulos ligados (`canais.atualizacoes`, null = sem canal; catálogo em `atualizacoes/`) | sim | — |
| testes | comandos de teste da liderança | **não** | — |

## Como criar um módulo

1. `modulos/<id>.js` com o manifesto acima.
2. Registrar em `modulos/index.js` na posição certa (ordem de hooks).
3. Comandos: arquivo em `commands/` listado em `comandos` (todo arquivo tem
   exatamente um dono — `test/paridade.test.js`).
4. Tabelas: `utils/migracoes.js` com `modulo: '<id>'`.
5. Exigências do tenant em `exige`; se o tenant Gaviões não tem, acrescentar ao
   `tenants/gavioes/tenant.js`.
6. Linha na tabela acima (o `test/docs.test.js` confere que todo módulo está
   aqui).
7. `npm run modulos` mostra o efeito por tenant (`TENANT=<slug>`).

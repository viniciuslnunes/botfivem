# Contrato: filtros, períodos e busca

> Reaproveite estes blocos; não recrie "período" ou "busca de jogador" em
> painel novo. Tudo em `utils/logsJogo/estatisticas.js` salvo indicação.

## Períodos

`PERIODO_CHOICES`: `hoje`, `ontem`, `7d`, `30d`, `90d`, `180d`, `365d`, `tudo`
(além de períodos fechados como `semana_passada` e `mes_passado`, usados nas
fichas). `resolverPeriodo(chave)` devolve `{ chave, rotulo, inicio, fim,
anteriorInicio, anteriorFim }` no **fuso de São Paulo** (chave inválida cai em
`7d`); `tudo` não tem `inicio` fixo (séries usam o dia mais antigo dos dados) e
período fechado não tem "anterior".
`selectPeriodo()` (`painelComponentesFixos.js`) é o select pronto. Séries diárias
sempre com **zero-fill** (`serieDiaria`) — dia sem log aparece como zero, não
some do eixo. Chaves de tempo: `chaveDia`, `chaveHora`, `inicioDoDiaSP`.

## Busca de jogador

- Por Discord: `selectBuscarJogador()` (select de usuário nativo).
- Por nome/ID do jogo: `consultas.resolverIdFivem` + `autocompletarFiltro`.
- Normalização de busca: `normalizarBusca` (sem acento/caixa/pontuação).
- Extrair o ID do apelido: `idFivemDoNick` (padrão `<prefixo>Nome - 1234`, com o
  prefixo do tenant em `tema.marca.nickPrefixo`); escrever: `formatarNick`.

## Correlação sem ID

O ID do jogo não é identidade estável. Para ligar log ↔ membro do Discord use
o **nome** (as funções internas de `idsSemSocio.js`: `normalizarNome`,
`similaridade`, `encontrarSugestao`),
mostrando o ID só como detalhe. Sugestão fraca não vira associação automática:
a liderança confirma (e "resolvido" só depois de gravar, ver
`regras-negocio.md`).

## Listas longas

`painelFormato.js` já fatia para os limites do Discord: `embedsDeLista` e
`agruparPorOrcamento` quebram em páginas dentro de `LIMITE_DESCRICAO` (3900, margem
abaixo dos 4096 da description); `campoLista` transforma a lista em `fields`,
quebrando quando um `value` passaria de 1024; `tabela` monta o bloco de código
com colunas alinhadas; `blocosDeEmbeds` põe cada embed numa mensagem própria
(é assim que o `painelCanal` reedita no lugar). `linhaPaginacao` navega.
Nunca concatene lista sem passar por eles.

## Formatação

`formatarNumero`, `formatarDinheiro` (`$ 1.500`), `formatarDuracao`,
`formatarDataHora`, `formatarDiaCurto`, `truncar`, `variacao`, `sparkline` — todas
em pt-BR.

const { escapeMarkdown } = require('discord.js');
const config = require('../../config/index.js');
const E = require('./estatisticas');
const repo = require('./repositorio');
const tema = require('../../tema');

// Formatação compartilhada pelos canais-painel de log. Existe pra que cada
// painel novo seja só "que dado mostrar", nunca "como quebrar a lista".

const COR = tema.cor.primaria;
const LIMITE_DESCRICAO = 3900; // margem abaixo dos 4096 da description do Discord

function rodape(origem) {
  return `Com base nos logs do jogo recebidos pelo webhook${origem ? ` · ${origem}` : ''}`;
}

// Nome do canal de log como está no Discord (config.logsJogo.nomesCanais), pra
// origem do dado nunca ser um ID cru nem um nome chutado.
function nomeCanal(id) {
  return config.logsJogo.nomesCanais?.[id] ?? id;
}

// Aviso de fonte parada: sem log deste tipo há mais de `fonteParadaDias`, o
// painel diz isso em cima em vez de mostrar zero como se nada tivesse acontecido.
// Existe por um caso real: o canal logs-liderança parou em 2026-07-26 e o dado de
// advertência, banco em R$ e fechaduras da sede ficou congelado sem ninguém ver.
function avisoFonteParada(ultima, agora = new Date()) {
  if (!ultima) return null;
  const limiteMs = config.logsJogo.fonteParadaDias * E.DIA_MS;
  if (new Date(agora) - new Date(ultima) <= limiteMs) return null;
  return `⚠️ **Nenhum log deste tipo desde ${E.formatarDataHora(ultima)}** — a fonte pode ter parado `
    + '(canal de log trocado ou desligado no jogo). O que aparece abaixo é histórico.';
}

// Apelido vem cru do jogo (webhook), sem sanitização nenhuma: um nome com "**"
// ou "||" solto quebra a formatação e um "||" sem par vira spoiler que engole as
// linhas seguintes, sem erro nenhum no log. Mesma razão de registrosDiarios.js.
function nomeSeguro(texto) {
  return escapeMarkdown(E.corrigirMojibake(texto ?? '') || '?');
}

// "Fulano (1234)" — id sozinho quando o log não trouxe nome (caso do baú).
function pessoa({ nome, id }) {
  if (nome) return `**${nomeSeguro(nome)}**${id ? ` \`${id}\`` : ''}`;
  return id ? `\`${id}\`` : '*?*';
}

// Completa o nome de quem só veio com ID. Os logs do baú e do banco mandam só o
// ID do jogador; o nome é emprestado do último apelido visto nos outros canais
// (repo.nomesPorIds). Linha que já tem nome não é tocada.
async function comNomes(linhas, { id = 'id', nome = 'nome' } = {}) {
  const ids = [...new Set(linhas.filter(l => !l[nome]).map(l => l[id]).filter(Boolean))];
  if (!ids.length) return linhas;
  const nomes = await repo.nomesPorIds(ids);
  return linhas.map(l => (l[nome] ? l : { ...l, [nome]: nomes.get(l[id]) ?? null }));
}

// "há 3h20min" — quanto tempo uma fechadura está destrancada, uma restrição
// está valendo, um jogador está com advertência aberta.
function haQuantoTempo(data, agora = new Date()) {
  return `há ${E.formatarDuracao(new Date(agora) - new Date(data))}`;
}

// Quebra uma lista de linhas em descriptions que caibam no limite do Discord. O
// primeiro pedaço tem orçamento menor porque a description dele também carrega o
// cabeçalho. Description (texto corrido) e não `fields`: um field sempre reserva
// a linha do nome, o que abre um respiro estranho no meio de lista numerada.
function agruparPorOrcamento(linhas, orcamentoPrimeiro, orcamentoDemais) {
  const grupos = [];
  let atual = [];
  let tamanho = 0;
  let orcamento = orcamentoPrimeiro;
  for (const linha of linhas) {
    const acrescimo = linha.length + 1;
    if (atual.length && tamanho + acrescimo > orcamento) {
      grupos.push(atual);
      atual = [];
      tamanho = 0;
      orcamento = orcamentoDemais;
    }
    atual.push(linha);
    tamanho += acrescimo;
  }
  grupos.push(atual);
  return grupos;
}

// Um painel = um título, um cabeçalho de resumo e uma lista que pode ser longa.
// Devolve os embeds já paginados (o 1º com título e resumo, os seguintes marcados
// como continuação), prontos pra virar uma mensagem cada.
// `fonte` substitui o rodapé inteiro, pra painel cujo dado não vem dos logs do jogo.
function embedsDeLista({ titulo, cabecalho, linhas, vazio, origem, fields = [], fonte = null }) {
  const cabecalhoTexto = cabecalho ? `${cabecalho}\n\n` : '';
  const orcamentoPrimeira = Math.max(500, LIMITE_DESCRICAO - cabecalhoTexto.length);
  const grupos = linhas.length ? agruparPorOrcamento(linhas, orcamentoPrimeira, LIMITE_DESCRICAO) : [[]];

  return grupos.map((grupo, i) => ({
    color: COR,
    title: i === 0 ? titulo : null,
    description: i === 0
      ? `${cabecalhoTexto}${grupo.join('\n') || `*${vazio}*`}`
      : `*(continuação)*\n\n${grupo.join('\n')}`,
    fields: i === 0 ? fields : [],
    footer: { text: (fonte ?? rodape(origem)) + (grupos.length > 1 ? ` · Página ${i + 1}/${grupos.length}` : '') },
    timestamp: new Date().toISOString(),
  }));
}

// Cada embed numa mensagem própria (é assim que o painelCanal reedita no lugar).
function blocosDeEmbeds(embeds) {
  return embeds.map(embed => ({ embeds: [embed] }));
}

const LIMITE_FIELD = 1024; // limite do Discord pro `value` de um field

// Uma lista vira `fields`, não texto dentro de `description` — é a diferença
// entre o painel de jogadores (informação respirada, cada bloco separado) e
// colar tudo num parágrafo só. Um field do Discord reserva margem de verdade
// acima e abaixo (nome em negrito, depois o valor), e vários fields empilhados
// vêm com espaço entre si — description concatenada com "\n" não tem nada
// disso, e foi o que deixava as listas (fechaduras, itens do baú, restrições)
// parecerem uma parede de texto. Quebra em mais de um field só se passar do
// limite de 1024 caracteres (25 fields cabem num embed, bem mais que qualquer
// lista destes painéis precisa).
// `numerar: false` mantém o mesmo `nome` em todo grupo, sem "(1/4)" etc. —
// pra lista que já é uma sequência única (ex.: histórico cronológico), onde a
// numeração sugere blocos separados que não existem de verdade.
function campoLista(nome, linhas, vazio, { numerar = true } = {}) {
  if (!linhas.length) return [{ name: nome, value: `*${vazio}*` }];
  const grupos = [];
  let atual = [];
  let tamanho = 0;
  for (const linha of linhas) {
    const acrescimo = linha.length + 1;
    if (atual.length && tamanho + acrescimo > LIMITE_FIELD) {
      grupos.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(linha);
    tamanho += acrescimo;
  }
  if (atual.length) grupos.push(atual);
  return grupos.map((grupo, i) => ({
    name: numerar && grupos.length > 1 ? `${nome} (${i + 1}/${grupos.length})` : nome,
    value: grupo.join('\n'),
  }));
}

// Bloco de código monoespaçado (```...```) com colunas alinhadas — é o mais
// perto de tabela de verdade que o Discord tem; markdown normal não alinha
// número nenhum lado a lado. Pensado pra ranking com várias colunas
// numéricas (ex.: território: domínio, conquistas, coins) — feio como lista
// numerada de texto corrido (ver painelTerritorioInteracoes.js, pedido do
// usuário em 2026-09-14). Cabe na `description` do embed (LIMITE_DESCRICAO),
// não num field: um field de 1024 estoura rápido com nome + 3 números por
// linha; description tem quase 4x isso.
//
// `colunas`: `{ titulo, valor: (linha, indice) => texto, alinhar: 'esq'|'dir',
// larguraMax? }`. Célula nunca quebra o bloco de fora: crase (```` ` ````)
// vira aspa simples — nome de território/jogador vem cru do jogo, pode trazer
// qualquer coisa.
function celulaTabela(texto) {
  return String(texto ?? '').replace(/`/g, "'");
}

function tabela(colunas, linhas) {
  if (!linhas.length) return null;
  const grade = linhas.map((linha, i) => colunas.map(c => {
    const bruta = celulaTabela(c.valor(linha, i));
    return c.larguraMax ? E.truncar(bruta, c.larguraMax) : bruta;
  }));
  const larguras = colunas.map((c, i) => Math.max(c.titulo.length, ...grade.map(l => l[i].length)));
  const linhaTexto = celulas => celulas
    .map((v, i) => (colunas[i].alinhar === 'dir' ? v.padStart(larguras[i]) : v.padEnd(larguras[i])))
    .join('  ')
    .trimEnd();
  return ['```', linhaTexto(colunas.map(c => c.titulo)), ...grade.map(linhaTexto), '```'].join('\n');
}

// Embed padrão dos canais-painel interativos: description curta (2-4 linhas de
// contexto, nunca a lista) + a lista sempre em field(s) via campoLista. Um
// título e um rodapé prontos, pra cada painel só decidir o QUE mostrar.
function embedComLista({ titulo, descricao = [], nomeLista, linhas, vazio, origem, fields = [] }) {
  return {
    color: COR,
    title: titulo,
    description: (Array.isArray(descricao) ? descricao.filter(Boolean) : [descricao]).join('\n') || undefined,
    fields: [...campoLista(nomeLista, linhas, vazio), ...fields],
    footer: { text: rodape(origem) },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  COR,
  LIMITE_DESCRICAO,
  rodape,
  nomeSeguro,
  pessoa,
  comNomes,
  nomeCanal,
  avisoFonteParada,
  haQuantoTempo,
  agruparPorOrcamento,
  embedsDeLista,
  blocosDeEmbeds,
  campoLista,
  embedComLista,
  tabela,
};

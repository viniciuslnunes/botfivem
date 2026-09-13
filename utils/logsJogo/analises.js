// Reduções puras sobre eventos já lidos do banco (sem Discord nem SQL), pra ser
// testável do mesmo jeito que parser.js e presenca.js.
//
// A ideia comum a quase tudo aqui: o jogo não publica ESTADO, publica EVENTO
// ("adicionou blacklist", "removeu impedimento", "trancou a arena"). O estado
// atual é sempre o ÚLTIMO evento de cada chave — quem está banido hoje é quem
// tem um "adicionou" como evento mais recente. Por isso todas as funções abaixo
// esperam os eventos em ordem DECRESCENTE (mais recente primeiro, que é como o
// repositório devolve) e ficam com a primeira ocorrência de cada chave.

const E = require('./estatisticas');

// Primeira ocorrência de cada chave, preservando a ordem de entrada.
function ultimoPorChave(eventos, chaveFn) {
  const mapa = new Map();
  for (const evento of eventos) {
    const chave = chaveFn(evento);
    if (chave == null || mapa.has(chave)) continue;
    mapa.set(chave, evento);
  }
  return mapa;
}

function nome(evento, campo) {
  return E.corrigirMojibake(evento[campo] ?? '') || null;
}

// ── Restrições: blacklist, suspensão e impedimento ──────────────────────────
// Três listas independentes (um jogador pode estar impedido sem estar banido),
// por isso a chave inclui o tipo.
const TIPOS_RESTRICAO = {
  blacklist: { rotulo: 'BLACKLIST', adicionou: 'blacklist_adicionou', removeu: 'blacklist_removeu' },
  suspensao: { rotulo: 'SUSPENSÃO', adicionou: 'suspensao_adicionou', removeu: 'suspensao_removeu' },
  impedimento: { rotulo: 'IMPEDIMENTO', adicionou: 'impedimento_adicionou', removeu: 'impedimento_removeu' },
};

const ACOES_RESTRICAO = Object.values(TIPOS_RESTRICAO).flatMap(t => [t.adicionou, t.removeu]);

function tipoDaAcao(acao) {
  return Object.entries(TIPOS_RESTRICAO).find(([, t]) => t.adicionou === acao || t.removeu === acao)?.[0] ?? null;
}

// Devolve só quem ESTÁ restrito agora, mais recente primeiro. Eventos sem alvo
// resolvido pelo jogo ("#nil nil nil") não entram: sem saber de quem é, não dá
// pra dizer que alguém está banido.
function restricoesAtivas(eventos) {
  const tipos = new Map(Object.entries(TIPOS_RESTRICAO));
  const ultimos = ultimoPorChave(eventos, e =>
    (e.alvo_id_fivem && tipoDaAcao(e.acao) ? `${tipoDaAcao(e.acao)}|${e.alvo_id_fivem}` : null));

  return [...ultimos.values()]
    .filter(e => tipos.get(tipoDaAcao(e.acao))?.adicionou === e.acao)
    .map(e => ({
      tipo: tipoDaAcao(e.acao),
      rotulo: tipos.get(tipoDaAcao(e.acao)).rotulo,
      id: e.alvo_id_fivem,
      nome: nome(e, 'alvo_nome'),
      porNome: nome(e, 'ator_nome'),
      porId: e.ator_id_fivem,
      em: e.ocorrido_em,
    }))
    .sort((a, b) => new Date(b.em) - new Date(a.em));
}

// ── Disciplina: advertência e serviços ──────────────────────────────────────
// O jogador punido é sempre o `alvo` nas três ações (ver parser.js), então a
// chave é ele. Ativa = o último evento dele foi 'advertido'; 'adv_finalizou'
// (cumpriu) e 'adv_removida' (a liderança perdoou) encerram.
const ACOES_ADVERTENCIA = ['advertido', 'adv_finalizou', 'adv_removida'];

function advertenciasAtivas(eventos) {
  const ultimos = ultimoPorChave(eventos, e => (e.alvo_id_fivem ? e.alvo_id_fivem : null));
  return [...ultimos.values()]
    .filter(e => e.acao === 'advertido')
    .map(e => ({
      id: e.alvo_id_fivem,
      nome: nome(e, 'alvo_nome'),
      porNome: nome(e, 'ator_nome'),
      motivo: E.extrairMotivo(e.descricao),
      servicos: E.extrairServicos(e.descricao),
      em: e.ocorrido_em,
    }))
    .sort((a, b) => new Date(b.em) - new Date(a.em));
}

// ── Tags (funções internas do jogo) ─────────────────────────────────────────
// Chave = jogador + tag: a mesma pessoa pode ter várias tags ao mesmo tempo, e
// perder uma não mexe nas outras. A tag vem entre parênteses na descrição.
//
// Duas correções que só apareceram com os dados reais (2026-09-13):
//   • A mesma tag com grafias diferentes ao longo do tempo ("R.S.J." virou
//     "RSJ") eram duas tags, com a antiga cheia de gente que já saiu. A chave usa
//     a tag sem pontos/espaços/caixa; o nome exibido é a grafia mais recente.
//   • Quem sai ou é expulso da torcida some da torcida no jogo, mas o jogo não
//     publica um "removeu tag" pra isso — a lista antiga tinha gente na
//     blacklist. Tag recebida ANTES da última saída da pessoa não vale; se ela
//     voltou e ganhou tag de novo, a tag nova vale.
const ACOES_TAG = ['tag_adicionou', 'tag_removeu'];
const ACOES_SAIDA = ['expulso_torcida', 'saiu_torcida', 'removido_torcida_automatico'];

function normalizarTag(tag) {
  return String(tag).toUpperCase().replace(/[.\s]/g, '');
}

// Quem saiu: em "saiu da torcida" a pessoa é quem agiu; nas outras, é o alvo.
function idQueSaiu(e) {
  return e.acao === 'saiu_torcida' ? e.ator_id_fivem : e.alvo_id_fivem;
}

function tagsAtivas(eventos) {
  const saidaMaisRecente = new Map();
  const grafiaMaisRecente = new Map();
  for (const e of eventos) {
    if (ACOES_SAIDA.includes(e.acao)) {
      const id = idQueSaiu(e);
      if (id && !saidaMaisRecente.has(id)) saidaMaisRecente.set(id, new Date(e.ocorrido_em));
      continue;
    }
    const tag = E.extrairEntreParenteses(e.descricao);
    if (tag && !grafiaMaisRecente.has(normalizarTag(tag))) grafiaMaisRecente.set(normalizarTag(tag), tag);
  }

  const ultimos = ultimoPorChave(eventos.filter(e => ACOES_TAG.includes(e.acao)), e => {
    const tag = E.extrairEntreParenteses(e.descricao);
    return e.alvo_id_fivem && tag ? `${e.alvo_id_fivem}|${normalizarTag(tag)}` : null;
  });

  const porTag = new Map();
  for (const e of ultimos.values()) {
    if (e.acao !== 'tag_adicionou') continue;
    const saiu = saidaMaisRecente.get(e.alvo_id_fivem);
    if (saiu && saiu > new Date(e.ocorrido_em)) continue;
    const chave = normalizarTag(E.extrairEntreParenteses(e.descricao));
    if (!porTag.has(chave)) porTag.set(chave, []);
    porTag.get(chave).push({ id: e.alvo_id_fivem, nome: nome(e, 'alvo_nome'), em: e.ocorrido_em, porNome: nome(e, 'ator_nome') });
  }
  return [...porTag.entries()]
    .map(([chave, membros]) => ({
      tag: grafiaMaisRecente.get(chave),
      membros: membros.sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')),
    }))
    .sort((a, b) => b.membros.length - a.membros.length || a.tag.localeCompare(b.tag, 'pt-BR'));
}

// ── Fechaduras ──────────────────────────────────────────────────────────────
// Sede e portão têm ações próprias (as antigas, que o módulo de segurança já
// vigiava); o resto vem como fechadura_trancou/destrancou com o nome em
// `alvo_nome`. Aqui as duas formas viram uma lista só, e o nome é normalizado
// porque o jogo escreve sem acento ("vestiario", "entrada automatica").
const ACOES_FECHADURA = [
  'sede_trancou', 'sede_destrancou',
  'portao_trancou', 'portao_destrancou',
  'fechadura_trancou', 'fechadura_destrancou',
];

const NOMES_FECHADURA = {
  vestiario: 'vestiário',
  protecao: 'proteção',
  bau: 'baú',
  'entrada automatica': 'entrada automática',
};

function fechaduraDoEvento(e) {
  if (e.acao.startsWith('sede_')) return 'sede';
  if (e.acao.startsWith('portao_')) return 'portão';
  const bruto = E.corrigirMojibake(e.alvo_nome ?? '').trim().toLowerCase();
  if (!bruto) return null;
  return NOMES_FECHADURA[bruto] ?? bruto;
}

function estaDestrancada(acao) {
  return acao.endsWith('destrancou');
}

// Estado de cada fechadura conhecida: destrancadas primeiro (é o que pede ação)
// e, dentro disso, a mais tempo assim.
//
// `semLogRecente`: o último evento é mais velho que `limiteMs`. Aí o estado NÃO é
// o atual, é só o último conhecido — e não pode contar como "destrancada agora".
// Caso real: arena, vestiário, proteção, baú, novato e entrada automática só
// vinham do canal logs-liderança, que parou em 2026-07; sem isso o painel
// gritava "5 destrancadas" com base em evento de janeiro.
function estadoFechaduras(eventos, { agora = new Date(), limiteMs = Infinity } = {}) {
  const ultimos = ultimoPorChave(eventos, fechaduraDoEvento);
  return [...ultimos.entries()]
    .map(([fechadura, e]) => ({
      fechadura,
      destrancada: estaDestrancada(e.acao),
      semLogRecente: new Date(agora) - new Date(e.ocorrido_em) > limiteMs,
      porNome: nome(e, 'ator_nome'),
      porId: e.ator_id_fivem,
      em: e.ocorrido_em,
    }))
    .sort((a, b) => (Number(a.semLogRecente) - Number(b.semLogRecente))
      || (Number(b.destrancada) - Number(a.destrancada))
      || (new Date(a.em) - new Date(b.em)));
}

module.exports = {
  ultimoPorChave,
  TIPOS_RESTRICAO,
  ACOES_RESTRICAO,
  restricoesAtivas,
  ACOES_ADVERTENCIA,
  advertenciasAtivas,
  ACOES_TAG,
  ACOES_SAIDA,
  tagsAtivas,
  ACOES_FECHADURA,
  estadoFechaduras,
};

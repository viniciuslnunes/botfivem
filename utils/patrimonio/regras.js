// Regras puras do patrimônio (sem Discord nem banco).
// Três níveis: ver, movimentar (retirar/devolver com foto) e gerir (cadastrar, editar, baixar).
// Bandeiras e Bateria são RECORTES do mesmo acervo, não inventários paralelos.

const CATEGORIAS_PATRIMONIO = {
  BANDEIRA: { rotulo: 'Bandeiras, faixas e mastros', emoji: '🚩' },
  INSTRUMENTO: { rotulo: 'Instrumentos', emoji: '🥁' },
  MATERIAL: { rotulo: 'Material de jogo', emoji: '🎒' },
  ELETRONICO: { rotulo: 'Eletrônicos', emoji: '🔊' },
  MOBILIARIO: { rotulo: 'Mobiliário', emoji: '🪑' },
  OUTROS: { rotulo: 'Outros', emoji: '📦' },
};
const CATEGORIA_PATRIMONIO_CHOICES = Object.entries(CATEGORIAS_PATRIMONIO).map(([value, c]) => ({ name: c.rotulo, value }));

// Só dentro de BANDEIRA: o trapo se guarda junto mas se comporta diferente na arquibancada
const SUBTIPOS_TRAPO = { BANDEIRA: 'Bandeira', FAIXA: 'Faixa', MASTRO: 'Mastro' };
const SUBTIPO_CHOICES = Object.entries(SUBTIPOS_TRAPO).map(([value, name]) => ({ name, value }));

const TODAS = '*';
const DIAS_FORA_ALERTA = 7;

function resolverEscopoPatrimonio({ presidencia, lideranca, papelPatrimonio, papelBandeiras, papelBateria }) {
  const ver = new Set();
  const movimentar = new Set();
  const gerir = new Set();
  if (presidencia || papelPatrimonio === 'gestor') [ver, movimentar, gerir].forEach(s => s.add(TODAS));
  if (lideranca) ver.add(TODAS);
  if (papelPatrimonio === 'membro') { ver.add(TODAS); movimentar.add(TODAS); }
  for (const [papel, categoria] of [[papelBandeiras, 'BANDEIRA'], [papelBateria, 'INSTRUMENTO']]) {
    if (papel) { ver.add(categoria); movimentar.add(categoria); }
    if (papel === 'gestor') gerir.add(categoria);
  }
  return { ver: [...ver], movimentar: [...movimentar], gerir: [...gerir] };
}

function permite(lista, categoria) {
  return lista.includes(TODAS) || lista.includes(categoria);
}

// null = todas as categorias; lista vazia = nenhuma
function categoriasPermitidas(lista) {
  return lista.includes(TODAS) ? null : lista;
}

// Editar confere origem E destino: sem isso o recorte reclassificaria um item para fora do próprio escopo
function podeMudarCategoria(escopo, origem, destino) {
  return permite(escopo.gerir, origem) && permite(escopo.gerir, destino);
}

function validarSubtipo(categoria, subtipo) {
  if (categoria === 'BANDEIRA') {
    return SUBTIPOS_TRAPO[subtipo] ? { ok: true } : { ok: false, mensagem: '❌ INFORME O TIPO DA PEÇA: BANDEIRA, FAIXA OU MASTRO.' };
  }
  return subtipo ? { ok: false, mensagem: '❌ O TIPO (BANDEIRA/FAIXA/MASTRO) SÓ VALE PARA A CATEGORIA BANDEIRAS.' } : { ok: true };
}

// emprestimos abertos: [{ saiu_em, evento_inicio_em }]
function pendenciaDoEmprestimo(emprestimo, agora = new Date()) {
  if (emprestimo.evento_inicio_em && new Date(emprestimo.evento_inicio_em).getTime() + 12 * 3600000 < agora.getTime()) {
    return 'não voltou do evento';
  }
  const dias = (agora.getTime() - new Date(emprestimo.saiu_em).getTime()) / 86400000;
  return dias > DIAS_FORA_ALERTA ? `fora há ${Math.floor(dias)} dias` : null;
}

function rotuloItem(item) {
  const categoria = CATEGORIAS_PATRIMONIO[item.categoria] ?? CATEGORIAS_PATRIMONIO.OUTROS;
  const subtipo = item.subtipo ? ` · ${SUBTIPOS_TRAPO[item.subtipo] ?? item.subtipo}` : '';
  return `${categoria.emoji} #${item.id} ${item.nome}${subtipo}${item.quantidade > 1 ? ` (×${item.quantidade})` : ''}`;
}

module.exports = {
  CATEGORIAS_PATRIMONIO,
  CATEGORIA_PATRIMONIO_CHOICES,
  SUBTIPOS_TRAPO,
  SUBTIPO_CHOICES,
  resolverEscopoPatrimonio,
  permite,
  categoriasPermitidas,
  podeMudarCategoria,
  validarSubtipo,
  pendenciaDoEmprestimo,
  rotuloItem,
};

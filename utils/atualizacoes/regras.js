// Regras puras do canal de atualizações (sem Discord nem banco).
//
// Cada atualização é uma entrada do catálogo `atualizacoes/` (um arquivo por entrega).
// O bot posta, ao subir, só o que (1) ainda não foi postado e (2) diz respeito a algum
// módulo ligado naquela torcida. Entrada vazia de módulos vale para todas.

// Tipo → como aparece. Cor vem do tema (nunca literal; nada verde).
const TIPOS = Object.freeze({
  novo: { emoji: '🆕', rotulo: 'NOVIDADE', cor: 'destaque' },
  melhoria: { emoji: '✨', rotulo: 'MELHORIA', cor: 'primaria' },
  correcao: { emoji: '🔧', rotulo: 'CORREÇÃO', cor: 'aviso' },
  regra: { emoji: '📜', rotulo: 'REGRA', cor: 'perigo' },
});

const DIA_MS = 24 * 60 * 60 * 1000;
// Primeira vez num servidor: só posta o que é recente, senão o canal nasce com o histórico inteiro
const DIAS_BASELINE = 7;

const LIMITES = Object.freeze({ titulo: 100, resumo: 500, itens: 8, item: 220, quem: 200 });

// Devolve a lista de problemas da entrada (vazia = válida)
function validarEntrada(e, { modulosConhecidos = null, origem = 'entrada' } = {}) {
  const erros = [];
  const erro = msg => erros.push(`${origem}: ${msg}`);
  if (e === null || typeof e !== 'object') return [`${origem}: deve exportar um objeto`];

  if (typeof e.id !== 'string' || !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(e.id)) erro('id deve ser AAAA-MM-DD-slug (igual ao nome do arquivo)');
  if (typeof e.data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.data) || Number.isNaN(Date.parse(e.data))) erro('data deve ser AAAA-MM-DD válida');
  else if (typeof e.id === 'string' && !e.id.startsWith(e.data)) erro('id deve começar pela data');
  if (!TIPOS[e.tipo]) erro(`tipo inválido: ${JSON.stringify(e.tipo)} (use ${Object.keys(TIPOS).join(', ')})`);
  if (typeof e.titulo !== 'string' || !e.titulo.trim() || e.titulo.length > LIMITES.titulo) erro(`titulo obrigatório, até ${LIMITES.titulo} caracteres`);
  if (typeof e.resumo !== 'string' || !e.resumo.trim() || e.resumo.length > LIMITES.resumo) erro(`resumo obrigatório, até ${LIMITES.resumo} caracteres`);
  if (!Array.isArray(e.itens) || !e.itens.length || e.itens.length > LIMITES.itens
    || e.itens.some(i => typeof i !== 'string' || !i.trim() || i.length > LIMITES.item)) {
    erro(`itens: 1 a ${LIMITES.itens} textos de até ${LIMITES.item} caracteres`);
  }
  if (e.quem !== undefined && (typeof e.quem !== 'string' || !e.quem.trim() || e.quem.length > LIMITES.quem)) erro(`quem: texto de até ${LIMITES.quem} caracteres`);
  if (!Array.isArray(e.modulos) || e.modulos.some(m => typeof m !== 'string')) erro('modulos: lista de ids (vazia = todos)');
  else if (modulosConhecidos) {
    for (const m of e.modulos) if (!modulosConhecidos.has(m)) erro(`módulo "${m}" não existe`);
  }
  return erros;
}

// Só o que interessa a esta torcida
function doTenant(entradas, moduloAtivo) {
  return entradas.filter(e => !e.modulos.length || e.modulos.some(moduloAtivo));
}

// `postadas`: Set de ids já postados, ou null se este servidor nunca recebeu nada.
// Primeira vez: publica só o recente e dá o resto como postado, em silêncio.
function separarPendentes(entradas, postadas, agora = new Date()) {
  const ordenadas = [...entradas].sort((a, b) => a.id.localeCompare(b.id));
  if (postadas) {
    return { publicar: ordenadas.filter(e => !postadas.has(e.id)), silenciar: [] };
  }
  const corte = agora.getTime() - DIAS_BASELINE * DIA_MS;
  const recente = e => Date.parse(`${e.data}T12:00:00Z`) >= corte;
  return { publicar: ordenadas.filter(recente), silenciar: ordenadas.filter(e => !recente(e)) };
}

const dataBr = data => data.split('-').reverse().join('/');

// `tema`: cor e marca da torcida. Devolve o payload de embed do Discord.
function montarEmbed(e, tema) {
  const tipo = TIPOS[e.tipo];
  const fields = [{ name: e.tipo === 'regra' ? 'O QUE VALE A PARTIR DE AGORA' : 'O QUE MUDA', value: e.itens.map(i => `• ${i}`).join('\n') }];
  if (e.quem) fields.push({ name: 'QUEM É AFETADO', value: e.quem });
  return {
    color: tema.cor[tipo.cor],
    title: tema.titulo(`${tipo.emoji} ${e.titulo}`),
    description: `**${tipo.rotulo}** · ${e.resumo}`,
    fields,
    footer: { text: `Atualização de ${dataBr(e.data)}` },
  };
}

module.exports = { TIPOS, DIAS_BASELINE, LIMITES, validarEntrada, doTenant, separarPendentes, montarEmbed };

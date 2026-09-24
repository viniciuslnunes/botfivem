// Schema do tenant: valida forma e tipo do que tenants/<slug>/tenant.js exporta.
// Sem dependência externa. Devolve TODOS os problemas de uma vez (a torcida
// nova conserta tudo numa passada só). Requisitos por módulo (ex.: "rifas exige
// canal X") entram em utils/plataforma quando os módulos declaram o que exigem.

const SNOWFLAKE = /^\d{17,20}$/;

const ehSnowflake = v => typeof v === 'string' && SNOWFLAKE.test(v);
const ehObjeto = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const ehNumeroPositivo = v => typeof v === 'number' && Number.isFinite(v) && v > 0;

// Cargos que qualquer torcida precisa (hierarquia/permissões).
const CARGOS_OBRIGATORIOS = ['socio', 'presidente', 'vicePresidente', 'velhaGuarda', 'diretoria', 'recrutador', 'visitante', 'provarManto', 'reprovadoRecrutamento'];
// Cargo que só existe em alguns tenants (o elenco/sub-marca, p.ex.).
const CARGOS_OPCIONAIS = ['elenco'];

function validarTenant(t, slug) {
  const erros = [];
  const exige = (cond, msg) => { if (!cond) erros.push(msg); };
  const idOuNulo = (v, caminho) => exige(v == null || ehSnowflake(v), `${caminho}: esperado ID do Discord (17–20 dígitos) ou null, veio ${JSON.stringify(v)}`);
  const id = (v, caminho) => exige(ehSnowflake(v), `${caminho}: esperado ID do Discord (17–20 dígitos), veio ${JSON.stringify(v)}`);

  if (!ehObjeto(t)) return ['tenant.js deve exportar um objeto'];

  exige(t.slug === slug, `slug: "${t.slug}" difere da pasta "${slug}"`);
  // Quais módulos sobem (valores true/false; ids conferidos em plataforma/resolver.js)
  exige(t.modulos === undefined || (ehObjeto(t.modulos) && Object.values(t.modulos).every(v => typeof v === 'boolean')), 'modulos: esperado objeto { idDoModulo: true|false }');
  id(t.guildId, 'guildId');
  exige(t.instalacao === undefined || typeof t.instalacao === 'boolean', 'instalacao: esperado true/false');
  exige(ehObjeto(t.jogo) && typeof t.jogo.fonte === 'string' && t.jogo.fonte, 'jogo.fonte: obrigatório (id do adapter em fontes/, ex.: "hoolibras")');

  // Modo instalação: a torcida ainda vai mapear cargos e canais com o /setup.
  // Só o essencial (acima) é cobrado; o resto entra quando instalacao sair.
  if (t.instalacao === true) return erros;

  // Cargos
  if (!ehObjeto(t.cargos)) erros.push('cargos: objeto obrigatório');
  else {
    for (const k of CARGOS_OBRIGATORIOS) id(t.cargos[k], `cargos.${k}`);
    for (const k of CARGOS_OPCIONAIS) idOuNulo(t.cargos[k], `cargos.${k}`);
    exige(Array.isArray(t.cargos.adv) && t.cargos.adv.length === 3 && t.cargos.adv.every(ehSnowflake),
      'cargos.adv: esperado lista com 3 IDs (ADV¹, ADV², ADV³)');
    exige(Array.isArray(t.cargos.advRec) && t.cargos.advRec.every(ehSnowflake),
      'cargos.advRec: esperado lista de IDs (vazia = fluxo de advertência de recrutador bloqueado)');
  }

  exige(Array.isArray(t.lideranca) && t.lideranca.length > 0 && t.lideranca.every(ehSnowflake),
    'lideranca: esperado lista não vazia de IDs de cargo');

  // Canais e categorias: cada valor é ID ou null (canal ainda não criado).
  if (!ehObjeto(t.canais)) erros.push('canais: objeto obrigatório');
  else for (const [k, v] of Object.entries(t.canais)) idOuNulo(v, `canais.${k}`);
  if (!ehObjeto(t.categorias)) erros.push('categorias: objeto obrigatório');
  else for (const [k, v] of Object.entries(t.categorias)) idOuNulo(v, `categorias.${k}`);

  exige(ehObjeto(t.links), 'links: objeto obrigatório');
  // Botões de link do !parceiros: o Discord aceita no máximo 5 por linha
  exige(t.parceiros === undefined || (Array.isArray(t.parceiros) && t.parceiros.length <= 5 && t.parceiros.every(p => typeof p?.label === 'string' && p.label && /^https?:\/\//.test(p?.url))),
    'parceiros: lista de até 5 { label, url http(s) }');

  // Hierarquia exibida no embed
  if (!Array.isArray(t.hierarquia)) erros.push('hierarquia: lista obrigatória');
  else t.hierarquia.forEach((h, i) => {
    id(h?.id, `hierarquia[${i}].id`);
    exige(typeof h?.label === 'string' && h.label, `hierarquia[${i}].label: texto obrigatório`);
  });

  // Departamentos
  if (!Array.isArray(t.departamentos)) erros.push('departamentos: lista obrigatória');
  else {
    const vistos = new Set();
    t.departamentos.forEach((d, i) => {
      for (const k of ['slug', 'nome', 'emoji', 'descricao']) exige(typeof d?.[k] === 'string' && d[k], `departamentos[${i}].${k}: texto obrigatório`);
      idOuNulo(d?.canalId, `departamentos[${i}].canalId`);
      exige(!vistos.has(d?.slug), `departamentos[${i}].slug: "${d?.slug}" repetido`);
      vistos.add(d?.slug);
    });
  }

  // Logs do jogo
  const lj = t.logsJogo;
  if (!ehObjeto(lj)) erros.push('logsJogo: objeto obrigatório');
  else {
    exige(Array.isArray(lj.canais) && lj.canais.length > 0 && lj.canais.every(ehSnowflake), 'logsJogo.canais: lista não vazia de IDs de canal de log');
    id(lj.categoriaLogs, 'logsJogo.categoriaLogs');
    idOuNulo(lj.canalAlertas, 'logsJogo.canalAlertas');
    idOuNulo(lj.canalPainelJogadores, 'logsJogo.canalPainelJogadores');
    if (ehObjeto(lj.nomesCanais)) {
      for (const k of Object.keys(lj.nomesCanais)) exige(Array.isArray(lj.canais) && lj.canais.includes(k), `logsJogo.nomesCanais: "${k}" não está em logsJogo.canais`);
    } else erros.push('logsJogo.nomesCanais: objeto obrigatório');
    for (const k of ['fonteParadaDias', 'painelIntervaloMin', 'painelJogadoresIntervaloMin', 'presencaSessaoMaxHoras', 'presencaReconexaoFolgaMin', 'inatividadeDias', 'novatoSemRecrutamentoDias', 'retencaoRecrutamentoDias']) {
      exige(ehNumeroPositivo(lj[k]), `logsJogo.${k}: esperado número > 0, veio ${JSON.stringify(lj[k])}`);
    }
    exige(Array.isArray(lj.mencionarAlertas) && lj.mencionarAlertas.every(ehSnowflake), 'logsJogo.mencionarAlertas: lista de IDs de cargo');
    exige(ehObjeto(lj.bau) && ehNumeroPositivo(lj.bau.alertaRetiradaQtd), 'logsJogo.bau.alertaRetiradaQtd: número > 0');
    exige(ehObjeto(lj.caixa) && ehNumeroPositivo(lj.caixa.alertaSaqueValor), 'logsJogo.caixa.alertaSaqueValor: número > 0');
    const f = lj.farm;
    if (!ehObjeto(f)) erros.push('logsJogo.farm: objeto obrigatório');
    else {
      exige(Array.isArray(f.itens) && f.itens.every(i => typeof i === 'string'), 'logsJogo.farm.itens: lista de textos');
      exige(Array.isArray(f.baus) && f.baus.every(i => typeof i === 'string'), 'logsJogo.farm.baus: lista de textos');
      exige(Array.isArray(f.itensDroga) && f.itensDroga.every(i => Array.isArray(f.itens) && f.itens.includes(i)), 'logsJogo.farm.itensDroga: deve ser subconjunto de itens');
      exige(ehObjeto(f.limitePadraoDroga) && ehNumeroPositivo(f.limitePadraoDroga.default), 'logsJogo.farm.limitePadraoDroga.default: número > 0');
    }
  }

  // Anti-spam, eventos, carteirinha, confiança, memória: só o que precisa existir.
  exige(ehObjeto(t.antiSpam) && ['alerta', 'punir'].includes(t.antiSpam.modo), "antiSpam.modo: esperado 'alerta' ou 'punir'");
  exige(ehObjeto(t.eventos) && ehNumeroPositivo(t.eventos.lembreteMinutos) && ehNumeroPositivo(t.eventos.publicarDiasAntes) && ehNumeroPositivo(t.eventos.maxSemanasSerie), 'eventos: lembreteMinutos, publicarDiasAntes e maxSemanasSerie devem ser > 0');
  exige(ehObjeto(t.carteirinha) && ehNumeroPositivo(t.carteirinha.vencendoDias) && ehNumeroPositivo(t.carteirinha.avisoVencimentoDias), 'carteirinha: vencendoDias e avisoVencimentoDias devem ser > 0');
  exige(ehObjeto(t.confianca) && Array.isArray(t.confianca.cargosNivel), 'confianca.cargosNivel: lista (vazia = sem cargo cosmético)');
  exige(ehObjeto(t.memoria) && ehNumeroPositivo(t.memoria.anosMax) && ehNumeroPositivo(t.memoria.diasFuturoMax) && ehNumeroPositivo(t.memoria.resumoEventoHoras), 'memoria: anosMax, diasFuturoMax e resumoEventoHoras devem ser > 0');

  return erros;
}

module.exports = { validarTenant, SNOWFLAKE, ehSnowflake };

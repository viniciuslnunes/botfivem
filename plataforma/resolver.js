// Decide quais módulos sobem para um tenant. Puro: recebe manifestos, tenant
// (config) e tema; devolve os ativos NA ORDEM dada, os desligados e TODOS os
// problemas encontrados (a torcida nova conserta tudo numa passada só).
//
// A ordem do array é a ordem dos hooks (ex.: quem vê a mensagem primeiro). Não
// há regra "dependência antes": handlers são roteados por prefixo de customId
// e comandos por nome, então registrar em qualquer ordem dá o mesmo resultado.
const { validarManifesto } = require('./contrato');

// O tenant liga/desliga por id em tenant.modulos ({ farm: false, elenco: true }).
// Sem entrada, vale o `padrao` do manifesto.
function habilitado(m, tenant) {
  if (m.obrigatorio) return true;
  const escolha = tenant.modulos?.[m.id];
  return typeof escolha === 'boolean' ? escolha : m.padrao;
}

// Exigência do módulo satisfeita? canais/cargos/categorias/links vêm do tenant;
// marca vem do tema (aceita caminho "elenco.logo").
function faltando(m, tenant, tema) {
  const falta = [];
  const exige = m.exige || {};
  const naoVazio = v => (Array.isArray(v) ? v.length > 0 : Boolean(v));
  for (const bloco of ['canais', 'cargos', 'categorias', 'links']) {
    for (const k of exige[bloco] || []) {
      if (!naoVazio(tenant[bloco]?.[k])) falta.push(`${bloco}.${k}`);
    }
  }
  for (const caminho of exige.tenant || []) {
    const v = caminho.split('.').reduce((o, p) => (o == null ? o : o[p]), tenant);
    if (!naoVazio(v)) falta.push(caminho);
  }
  for (const caminho of exige.marca || []) {
    const v = caminho.split('.').reduce((o, p) => (o == null ? o : o[p]), tema?.marca);
    if (!naoVazio(v)) falta.push(`marca.${caminho}`);
  }
  return falta;
}

function resolverModulos(manifestos, { tenant, tema }) {
  const erros = [];
  const porId = new Map();

  for (const [i, m] of manifestos.entries()) {
    const problemas = validarManifesto(m, m?.id ? `módulo "${m.id}"` : `módulo #${i}`);
    erros.push(...problemas);
    if (m && typeof m.id === 'string') {
      if (porId.has(m.id)) erros.push(`módulo "${m.id}" declarado duas vezes`);
      else porId.set(m.id, m);
    }
  }

  // Tenant não pode ligar/desligar módulo que não existe (erro de digitação
  // silencioso seria uma torcida achando que desligou o farm).
  for (const [id, v] of Object.entries(tenant.modulos || {})) {
    if (!porId.has(id)) erros.push(`tenant.modulos: módulo desconhecido "${id}"`);
    else if (typeof v !== 'boolean') erros.push(`tenant.modulos.${id}: esperado true/false`);
    else if (porId.get(id).obrigatorio && v === false) erros.push(`tenant.modulos.${id}: módulo obrigatório não pode ser desligado`);
  }

  const ativos = [];
  const desligados = [];
  for (const m of manifestos) {
    if (!m || typeof m.id !== 'string') continue;
    (habilitado(m, tenant) ? ativos : desligados).push(m);
  }
  const idsAtivos = new Set(ativos.map(m => m.id));

  for (const m of ativos) {
    for (const dep of m.requer || []) {
      if (!porId.has(dep)) erros.push(`módulo "${m.id}" requer "${dep}", que não existe`);
      else if (!idsAtivos.has(dep)) erros.push(`módulo "${m.id}" requer "${dep}", que está desligado — ligue "${dep}" ou desligue "${m.id}"`);
    }
    const falta = faltando(m, tenant, tema);
    if (falta.length) erros.push(`módulo "${m.id}" está ligado mas o tenant não define: ${falta.join(', ')} — configure ou desligue o módulo`);
  }

  return { ativos, desligados, erros };
}

module.exports = { resolverModulos, habilitado, faltando };

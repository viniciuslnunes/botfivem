// Pontos de enriquecimento: um painel/embed existente ganha campos de outro módulo sem conhecê-lo.
// O módulo dono do dado registra uma função por ponto; quem monta o embed pede os campos.
// Sem módulo ligado, nenhum campo. Falha de um enriquecedor nunca derruba o embed.
//
// Pontos: 'historico.resumo' ({ idFivem, membro }) e 'adv.contexto' ({ client, membro, idFivem }).
const pontos = new Map();

function registrar(ponto, fn) {
  const lista = pontos.get(ponto) ?? [];
  if (!lista.includes(fn)) lista.push(fn);
  pontos.set(ponto, lista);
}

// Cada função devolve um campo de embed { name, value, inline? }, uma lista deles ou null
async function coletar(ponto, contexto) {
  const campos = [];
  for (const fn of pontos.get(ponto) ?? []) {
    try {
      const r = await fn(contexto);
      if (Array.isArray(r)) campos.push(...r);
      else if (r) campos.push(r);
    } catch (err) {
      console.error(`[enriquecedores] "${ponto}" falhou:`, err.message);
    }
  }
  return campos;
}

module.exports = { registrar, coletar };

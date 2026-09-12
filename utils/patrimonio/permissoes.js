const { ehLideranca, ehPresidencia } = require('../permissoes');
const { papelNaArea } = require('../departamentos/acesso');
const { resolverEscopoPatrimonio } = require('./regras');

async function escopoPatrimonioDe(member) {
  const [papelPatrimonio, papelBandeiras, papelBateria] = await Promise.all([
    papelNaArea(member, 'patrimonio'),
    papelNaArea(member, 'bandeiras'),
    papelNaArea(member, 'bateria'),
  ]);
  return resolverEscopoPatrimonio({
    presidencia: ehPresidencia(member),
    lideranca: ehLideranca(member),
    papelPatrimonio,
    papelBandeiras,
    papelBateria,
  });
}

module.exports = { escopoPatrimonioDe };

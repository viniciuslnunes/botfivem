// Regras puras do funil de recrutamento: entrou no jogo como novato → pediu
// recrutamento no Discord → foi aprovado. Cruza logs do jogo, fichas e apelidos.
const { idFivemDoNick } = require('../logsJogo/estatisticas');

const DIA_MS = 24 * 60 * 60 * 1000;

// Sócio ativo pelo ID FiveM do apelido padrão. Cobre quem foi aprovado antes das fichas irem para o banco.
function mapearSociosPorIdFivem(membros, cargoSocio) {
  const mapa = new Map();
  for (const membro of membros) {
    if (!membro.roles.cache.has(cargoSocio)) continue;
    const id = idFivemDoNick(membro.nickname ?? membro.displayName);
    if (id) mapa.set(id, membro);
  }
  return mapa;
}

// novatos: [{ id_fivem, ator_nome, ocorrido_em, pediu, aprovado }]
function resumirFunil(novatos, idsSocios = new Set()) {
  const etapas = novatos.map(n => ({
    ...n,
    aprovado: Boolean(n.aprovado) || idsSocios.has(n.id_fivem),
    pediu: Boolean(n.pediu) || Boolean(n.aprovado) || idsSocios.has(n.id_fivem),
  }));
  const pediram = etapas.filter(n => n.pediu).length;
  const aprovados = etapas.filter(n => n.aprovado).length;
  return {
    novatos: etapas.length,
    pediram,
    aprovados,
    taxaPedido: etapas.length ? pediram / etapas.length : null,
    taxaAprovacao: pediram ? aprovados / pediram : null,
    semPedido: etapas.filter(n => !n.pediu).sort((a, b) => new Date(a.ocorrido_em) - new Date(b.ocorrido_em)),
  };
}

// Novato que entrou há mais de N dias e não pediu recrutamento; janela limita o
// alerta a quem ainda é recrutável, e cada ID só é alertado uma vez
function novatosParaAlertar(novatos, { idsSocios = new Set(), jaAlertados = new Set(), agora = new Date(), dias = 3, janelaDias = 30 }) {
  const limite = agora.getTime() - dias * DIA_MS;
  const inicioJanela = agora.getTime() - janelaDias * DIA_MS;
  return novatos.filter(n => {
    const quando = new Date(n.ocorrido_em).getTime();
    return quando <= limite && quando >= inicioJanela && !n.pediu && !n.aprovado
      && !idsSocios.has(n.id_fivem) && !jaAlertados.has(n.id_fivem);
  });
}

module.exports = { mapearSociosPorIdFivem, resumirFunil, novatosParaAlertar };

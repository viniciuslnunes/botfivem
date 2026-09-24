const { listaLimitada } = require('../departamentos/regras');
const { formatarDinheiro } = require('../logsJogo/estatisticas');
const { resumirEmbarque, pendenciasCaravana } = require('./regras');
const { textoPendencias } = require('../escala/regras');
const tema = require('../../tema');

// Lista nominal por veículo com ida/volta: é o documento que vai para a porta do ônibus.
// Traz só nome e marcação de embarque — nunca dados da ficha.
function montarManifesto({ evento, veiculos, inscricoes, checkins, resultado = null, agora = new Date() }) {
  const confirmados = inscricoes.filter(i => i.status === 'CONFIRMADO');
  const embarque = resumirEmbarque(checkins);
  const marca = id => `${embarque.ida.has(id) ? tema.emoji.ativo : tema.emoji.inativo}${embarque.volta.has(id) ? tema.emoji.ativo : tema.emoji.inativo} <@${id}>`;

  const fields = veiculos.map(v => {
    const passageiros = confirmados.filter(i => String(i.veiculo_id) === String(v.id));
    const detalhes = [v.responsavel_id && `resp. <@${v.responsavel_id}>`, v.ponto, v.horario].filter(Boolean).join(' · ');
    return {
      name: `🚌 ${v.nome.toUpperCase()} (${passageiros.length}/${v.capacidade})`.slice(0, 256),
      value: listaLimitada([...(detalhes ? [detalhes] : []), ...passageiros.map(p => marca(p.discord_id))], 1000) || '*Vazio.*',
      inline: true,
    };
  });
  const semVeiculo = confirmados.filter(i => !i.veiculo_id);
  if (semVeiculo.length) {
    fields.push({ name: `❔ SEM VEÍCULO (${semVeiculo.length})`, value: listaLimitada(semVeiculo.map(p => marca(p.discord_id)), 1000), inline: true });
  }
  if (embarque.voltaSemIda.length) {
    fields.push({ name: '⚠️ NA VOLTA SEM TER EMBARCADO NA IDA', value: listaLimitada(embarque.voltaSemIda.map(id => `<@${id}>`), 1000), inline: false });
  }
  const pendencias = pendenciasCaravana({ veiculos, confirmados, inicioEm: evento.inicio_em, agora });
  if (pendencias.length) fields.push({ name: 'PRECISA DE ATENÇÃO', value: textoPendencias(pendencias), inline: false });
  if (resultado) {
    fields.push({
      name: '💰 RESULTADO DA CARAVANA',
      value: `➕ ${formatarDinheiro(resultado.receitas)} · ➖ ${formatarDinheiro(resultado.despesas)} · **${formatarDinheiro(resultado.saldo)}**`,
      inline: false,
    });
  }

  return {
    color: tema.cor.primaria,
    title: `🚌 MANIFESTO — ${evento.titulo.toUpperCase()}`.slice(0, 256),
    description: `<t:${Math.floor(new Date(evento.inicio_em).getTime() / 1000)}:F> · ${confirmados.length} confirmado${confirmados.length !== 1 ? 's' : ''} · ida ${embarque.ida.size} · volta ${embarque.volta.size}\n${tema.emoji.ativo}${tema.emoji.inativo} = embarcou na ida / na volta`,
    fields: fields.slice(0, 25),
  };
}

module.exports = { montarManifesto };

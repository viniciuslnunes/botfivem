const config = require('../../config/index.js');
const { listaLimitada } = require('../departamentos/regras');
const { formatarNumero } = require('../logsJogo/estatisticas');
const { formatarTaxa } = require('../eventos/regras');
const repo = require('./funilRepositorio');
const { mapearSociosPorIdFivem, resumirFunil } = require('./funil');

async function montarEmbedFunil(guild, periodo) {
  const [novatos] = await Promise.all([repo.novatosDoPeriodo(periodo.inicio, periodo.fim), guild.members.fetch()]);
  const idsSocios = new Set(mapearSociosPorIdFivem(guild.members.cache.values(), config.cargos.socio).keys());
  const f = resumirFunil(novatos, idsSocios);
  const semPedido = f.semPedido.slice(0, 20).map(n =>
    `🆔 **${n.id_fivem}** · ${n.ator_nome ?? 'sem nome'} · <t:${Math.floor(new Date(n.ocorrido_em).getTime() / 1000)}:R>`);

  return {
    color: 0x000000,
    title: `🔎 FUNIL DE RECRUTAMENTO — ${periodo.rotulo}`,
    description: [
      `🎮 **${formatarNumero(f.novatos)}** entraram na torcida no jogo`,
      `📋 **${formatarNumero(f.pediram)}** pediram recrutamento no Discord (${formatarTaxa(f.taxaPedido)})`,
      `🦅 **${formatarNumero(f.aprovados)}** aprovados (${formatarTaxa(f.taxaAprovacao)} de quem pediu)`,
    ].join('\n'),
    fields: [{
      name: `AINDA NÃO PEDIRAM (${f.semPedido.length})`,
      value: semPedido.length ? listaLimitada(semPedido, 1000) : '*Todos os novatos do período já pediram recrutamento.*',
      inline: false,
    }],
    footer: { text: 'Novatos vêm dos logs do jogo; pedido e aprovação, das fichas e dos apelidos de sócio' },
  };
}

module.exports = { montarEmbedFunil };

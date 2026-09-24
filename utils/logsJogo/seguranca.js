const { EmbedBuilder } = require('discord.js');
const repo = require('./repositorio');
const tema = require('../../tema');

// Segurança do patrimônio (sede/portão), a partir dos eventos que o parser
// já reconhece (sede_trancou/destrancou, portao_trancou/destrancou — ver
// parser.js). Sem tabela nova: o estado de cada fechadura é só "qual desses
// dois eventos aconteceu por último", recalculado a cada checagem.
//
// O alerta automático periódico (fechadura destrancada + ninguém online) foi
// removido em 2026-09-15: estava caindo no canal de novatos. O estado
// continua disponível sob demanda em /estatisticas seguranca e no painel de
// fechaduras — só o aviso automático saiu.

const FECHADURAS = [
  { chave: 'sede', rotulo: 'SEDE', artigo: 'a', trancou: 'sede_trancou', destrancou: 'sede_destrancou' },
  { chave: 'portao', rotulo: 'PORTÃO', artigo: 'o', trancou: 'portao_trancou', destrancou: 'portao_destrancou' },
];

async function estadoFechadura(f) {
  const ultimo = await repo.ultimoEvento([f.trancou, f.destrancou]);
  if (!ultimo) return { ...f, aberta: null, desde: null, por: null };
  return {
    ...f,
    aberta: ultimo.acao === f.destrancou,
    desde: new Date(ultimo.ocorrido_em),
    por: ultimo.ator_nome,
  };
}

// Estado das duas fechaduras agora — usado tanto pelo checador de alerta
// quanto por quem quiser exibir "sede destrancada desde tal hora" em algum
// painel/comando.
async function estadoFechaduras() {
  return Promise.all(FECHADURAS.map(estadoFechadura));
}

// Embed "estado atual", reaproveitável pelo comando sob demanda.
function embedEstadoAtual(fechaduras) {
  const linhas = fechaduras.map(f => {
    if (f.aberta === null) return `**${f.rotulo}**: sem registro nos logs ainda`;
    const status = f.aberta ? '🔓 destrancada' : '🔒 trancada';
    const desde = `<t:${Math.floor(f.desde.getTime() / 1000)}:R>`;
    return `**${f.rotulo}**: ${status} ${desde} — ${f.por ?? '?'}`;
  });
  return new EmbedBuilder()
    .setColor(tema.cor.primaria)
    .setTitle('🔐 SEGURANÇA DO PATRIMÔNIO')
    .setDescription(linhas.join('\n'))
    .setFooter({ text: 'Com base nos logs do jogo recebidos pelo webhook · canal logs-painel' })
    .setTimestamp();
}

module.exports = {
  estadoFechaduras,
  embedEstadoAtual,
};

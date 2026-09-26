// Barreira de entrada: ao chegar uma ficha, cruza o candidato com o que a torcida já sabe.
// O ID do jogo troca a cada season e a conta do Discord também, então a identidade é o NOME
// (mesma correlação de idsSemSocio). Só informa: a decisão de aprovar continua com o recrutador.
const tema = require('../../tema');
const F = require('../logsJogo/painelFormato');
const R = require('./regras');

// Puro. `dados` já lido: restricoesDoId (rótulos ativos), restricoes/bloqueados/reprovados com nome.
function montarAvisos({ nome, idFivem, restricoesDoId = [], restricoes = [], bloqueados = [], reprovados = [], mantos = null }) {
  const avisos = [];
  if (mantos?.reincidente) {
    avisos.push(`Esta pessoa já teve **${mantos.erradosEfetivos} fotos de manto reprovadas** sem uma correta depois (possível fraude ou uso de IA). Confira o manto com cuidado.`);
  }
  if (restricoesDoId.length) {
    avisos.push(`O ID **${idFivem}** tem **${restricoesDoId.join(' + ')}** ativa no jogo agora.`);
  }
  for (const r of R.nomesParecidos(nome, restricoes).filter(c => c.id_fivem !== idFivem).slice(0, 3)) {
    avisos.push(`Nome parecido com **${F.nomeSeguro(r.nome)}** (ID \`${r.id_fivem}\`), que está com **${r.rotulo}** no jogo — ${Math.round(r.score * 100)}% de semelhança. Pode ser a mesma pessoa com ID novo.`);
  }
  for (const b of R.nomesParecidos(nome, bloqueados).filter(c => c.id_fivem !== idFivem).slice(0, 3)) {
    avisos.push(`Nome parecido com **${F.nomeSeguro(b.nome)}**, ID \`${b.id_fivem}\` em **não recrutar** (${Math.round(b.score * 100)}%).`);
  }
  for (const r of R.nomesParecidos(nome, reprovados).slice(0, 3)) {
    avisos.push(`Nome parecido com <@${r.discord_id}> (${F.nomeSeguro(r.nome)}), **reprovado definitivamente** (${Math.round(r.score * 100)}%).`);
  }
  return avisos;
}

async function avaliarCandidato({ nome, idFivem, discordId = null }) {
  const logs = require('../logsJogo/repositorio');
  const A = require('../logsJogo/analises');
  const repo = require('./repositorio');
  const fichas = require('../recrutamento/fichas');
  const naoRecrutar = require('../naoRecrutarEspelho');

  const mantosRepo = require('../recrutamento/mantoRepositorio');
  const { resumirFotos } = require('../recrutamento/mantoRegras');
  const [eventosDoId, ativas, bloqueadosBrutos, reprovadosBrutos, fotos] = await Promise.all([
    logs.eventosDoAlvo(idFivem, A.ACOES_RESTRICAO, 50),
    repo.restricoesAtivasPorAlvo(),
    naoRecrutar.ativos().catch(() => []),
    fichas.listarReprovacoesDefinitivas().catch(() => []),
    discordId ? mantosRepo.fotosDoCandidato(discordId).catch(() => []) : [],
  ]);
  const restricoesDoId = A.statusRestricoesDoAlvo(eventosDoId).filter(s => s.ativo).map(s => A.TIPOS_RESTRICAO[s.tipo].rotulo);

  const nomes = await logs.nomesPorIds([...new Set([...ativas.map(a => a.id_fivem), ...bloqueadosBrutos.map(b => b.id_fivem)])]);
  const restricoes = ativas.map(a => ({
    id_fivem: a.id_fivem, nome: nomes.get(a.id_fivem) ?? '', rotulo: A.TIPOS_RESTRICAO[A.tipoDaAcao(a.acao)].rotulo,
  })).filter(r => r.nome);
  const bloqueados = bloqueadosBrutos.map(b => ({ id_fivem: b.id_fivem, nome: nomes.get(b.id_fivem) ?? '' })).filter(b => b.nome);
  const reprovados = reprovadosBrutos.filter(r => r.nome);

  return montarAvisos({ nome, idFivem, restricoesDoId, restricoes, bloqueados, reprovados, mantos: resumirFotos(fotos) });
}

// Gancho da ficha enviada: responde na própria ficha, sem notificar ninguém. Traz os avisos do
// cruzamento (se houver) e quem está com o jogo aberto agora: a ficha chega já com o contexto e com
// a pista de quem pode atender na hora (o ping do cargo já foi dado no envio).
async function avisarNaFicha({ mensagem, nome, idFivem, discordId, client }) {
  const [avisos, online] = await Promise.all([
    avaliarCandidato({ nome, idFivem, discordId }),
    client ? require('./pessoas').recrutadoresOnline(client).catch(() => null) : null,
  ]);
  const linhaOnline = online === null
    ? null
    : online.length
      ? `Recrutadores com o jogo aberto agora: ${online.slice(0, 10).map(r => `<@${r.discordId}>`).join(' ')}`
      : 'Nenhum recrutador com o jogo aberto agora — a análise pode demorar.';
  if (!avisos.length && !linhaOnline) return false;
  await mensagem.reply({
    embeds: [{
      color: avisos.length ? tema.cor.aviso : tema.cor.primaria,
      title: avisos.length ? '⚠️ ATENÇÃO ANTES DE ANALISAR' : '📋 TRIAGEM DA FICHA',
      description: [...avisos, linhaOnline].filter(Boolean).join('\n\n'),
      footer: { text: 'Cruzamento automático por nome (o ID do jogo troca a cada season) e presença. Só informa — quem decide é o recrutador.' },
    }],
    allowedMentions: { parse: [] },
  });
  return true;
}

module.exports = { montarAvisos, avaliarCandidato, avisarNaFicha };

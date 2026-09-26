// Mérito de recrutadores: os dois canais-painel.
//  🏆・mérito-recrutadores  ranking do ciclo (recrutadores e liderança leem; só o bot escreve)
//  🗳️・votação-mérito       indicados, votação, pendências e decisão (só liderança)
// Os painéis só LEEM o que servico.js já calculou e gravou: abrir o canal não
// recalcula nada. O bloco de botões é sempre a última mensagem (montarAcao).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config/index.js');
const tema = require('../../tema');
const F = require('../logsJogo/painelFormato');
const { criarPainelCanal } = require('../logsJogo/painelCanal');
const { lerConfig } = require('../botConfig');
const R = require('./regras');
const repo = require('./repositorio');
const X = require('./extrato');

const CHAVE_CANAL_VOTACAO = 'canal_merito_votacao';

// ── 🏆 Ranking ───────────────────────────────────────────────────────────────

async function cicloExibido() {
  return (await repo.cicloAberto()) ?? (await repo.cicloEmVotacao()) ?? (await repo.ultimoCiclo());
}

function tabelaRanking(linhas) {
  return F.tabela([
    { titulo: '#', valor: l => l.posicao ?? '-', alinhar: 'dir' },
    { titulo: 'RECRUTADOR', valor: l => l.detalhe?.nome ?? l.discord_id, larguraMax: 16 },
    { titulo: 'PTS', valor: l => X.pts(l.pontos + l.bonus), alinhar: 'dir' },
    { titulo: 'SEMANAS', valor: l => `${l.detalhe?.semanasBatidas ?? 0}/${l.detalhe?.semanasContaveis ?? 0}`, alinhar: 'dir' },
    { titulo: 'AGORA', valor: l => `${l.detalhe?.semanaAtual?.efetivos ?? 0}/${l.detalhe?.semanaAtual?.meta ?? 0}`, alinhar: 'dir' },
  ], linhas, { separador: ' ' });
}

async function montarBlocosMerito(agora = new Date()) {
  const ciclo = await cicloExibido();
  if (!ciclo) {
    return [{ embeds: [{ color: F.COR, title: tema.titulo(`${tema.emoji.marca} MÉRITO DE RECRUTADORES`), description: 'O primeiro ciclo abre na próxima varredura.' }] }];
  }
  const resultados = await repo.resultadosDoCiclo(ciclo.id);
  const semanaIdx = R.semanaDe(ciclo, agora);
  const cfg = ciclo.config ?? {};
  const situacao = ciclo.status === 'ABERTO'
    ? `Semana **${semanaIdx >= 0 ? semanaIdx + 1 : R.LIMITES.semanasCiclo}/${R.LIMITES.semanasCiclo}** · fecha <t:${X.seg(ciclo.fim)}:R>`
    : ciclo.status === 'EM_VOTACAO' ? `Ciclo fechado. Liderança votando até <t:${X.seg(ciclo.votacao_ate)}:R>` : 'Ciclo encerrado.';

  const cabecalho = {
    color: F.COR,
    title: tema.titulo(`${tema.emoji.marca} MÉRITO DE RECRUTADORES · CICLO ${ciclo.numero}`),
    description: [
      ciclo.sombra ? `${tema.emoji.pendente} **Ciclo de calibração:** vale só como medição, sem indicação nem votação.` : null,
      situacao,
      `Meta: **${cfg.meta ?? R.LIMITES.metaPadrao} recrutamentos/semana** · os **${R.LIMITES.indicados} primeiros** do ranking são indicados à diretoria do departamento.`,
      'Recrutamento só conta como confirmado depois de 14 dias (voltou ao jogo, não saiu cedo, sem problema). Veja seu extrato no botão abaixo.',
    ].filter(Boolean).join('\n'),
    footer: { text: F.rodape('Mérito de recrutadores') },
  };

  const elegiveis = resultados.filter(r => r.elegivel);
  const inelegiveis = resultados.filter(r => !r.elegivel);
  const rank = {
    color: F.COR,
    title: tema.titulo(`${tema.emoji.ativo} RANKING (ELEGÍVEIS)`),
    description: tabelaRanking(elegiveis) ?? 'Ninguém elegível ainda: é preciso bater a meta em 4 semanas do ciclo.',
  };
  const fora = {
    color: F.COR,
    title: tema.titulo(`${tema.emoji.pendente} AINDA FORA DO RANKING`),
    description: inelegiveis.length
      ? inelegiveis.slice(0, 15).map(r => `• **${F.nomeSeguro(r.detalhe?.nome ?? r.discord_id)}** (${X.pts(r.pontos)} pts): ${(r.motivos ?? []).join('; ')}`).join('\n').slice(0, 3800)
      : 'Todos os recrutadores medidos estão elegíveis.',
  };
  return [{ embeds: [cabecalho, rank, fora] }];
}

function acaoMerito() {
  return {
    content: '**AÇÕES DO RECRUTADOR**',
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('merito:extrato').setLabel('MEU EXTRATO').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('merito:dispensa').setLabel('PEDIR SEMANA DISPENSADA').setStyle(ButtonStyle.Secondary),
    )],
  };
}

const ranking = criarPainelCanal({
  slug: 'merito_recrutadores',
  nomeCanal: '🏆・mérito-recrutadores',
  razao: 'Ranking de mérito dos recrutadores',
  intervaloMin: 60,
  montarBlocos: () => montarBlocosMerito(),
  montarAcao: acaoMerito,
  canalVizinhoId: config.canais.quadroRecrutadores,
  cargosLeitura: [config.cargos.recrutador],
});

// ── 🗳️ Votação ───────────────────────────────────────────────────────────────

// Total de pessoas da liderança que podem votar (cargos de config.lideranca)
async function totalLideranca(guild) {
  const { garantirMembrosCarregados } = require('../membrosGuild');
  await garantirMembrosCarregados(guild);
  return guild.members.cache.filter(m => !m.user?.bot && config.lideranca.some(id => id && m.roles.cache.has(id))).size;
}

let clienteAtual = null;

async function montarBlocosVotacao(agora = new Date()) {
  const votacao = await repo.cicloEmVotacao();
  const aberto = await repo.cicloAberto();
  const ultimo = votacao ?? (await repo.ultimoCiclo());
  const blocos = [];

  const pendencias = aberto ? await repo.revisoesPendentes(aberto.id) : [];
  const informativas = aberto ? await repo.revisoesInformativas(aberto.id) : [];

  if (votacao) {
    const resultados = (await repo.resultadosDoCiclo(votacao.id)).filter(r => r.indicado);
    const [votos, vetos] = await Promise.all([repo.votosDoCiclo(votacao.id), repo.vetosDoCiclo(votacao.id)]);
    const guild = clienteAtual ? await clienteAtual.guilds.fetch(config.guildId).catch(() => null) : null;
    const total = guild ? await totalLideranca(guild) : 0;
    const quorum = Math.floor(total / 2) + 1;
    blocos.push({
      embeds: [{
        color: F.COR,
        title: tema.titulo(`${tema.emoji.marca} VOTAÇÃO DO MÉRITO · CICLO ${votacao.numero}`),
        description: [
          `Votação até <t:${X.seg(votacao.votacao_ate)}:F> (<t:${X.seg(votacao.votacao_ate)}:R>)${votacao.prorrogada ? ' · prorrogada' : ''}.`,
          `**${votos.length}** de ${total || '?'} da liderança votaram · quórum: **${quorum}**. O placar fica oculto até o encerramento.`,
          'Você pode trocar o voto até o prazo. A presidência pode **vetar** um indicado com motivo. O bot não dá cargo: a promoção é decisão da liderança.',
        ].join('\n'),
      }],
    });
    if (resultados.length) {
      blocos.push({ embeds: resultados.map(r => X.embedDossie({ resultado: r, posicao: r.posicao, vetado: vetos.find(v => v.indicadoId === r.discord_id) })) });
    }
  } else {
    const c = ultimo;
    blocos.push({
      embeds: [{
        color: F.COR,
        title: tema.titulo(`${tema.emoji.marca} VOTAÇÃO DO MÉRITO`),
        description: c
          ? `Nenhuma votação aberta. Ciclo **${c.numero}** ${c.status === 'ABERTO' ? `em andamento, fecha <t:${X.seg(c.fim)}:R>` : c.status === 'CONCLUIDO' ? 'concluído' : 'encerrado'}${c.sombra ? ' (calibração, sem votação)' : ''}.`
          : 'Nenhum ciclo ainda.',
      }],
    });
  }

  const encerrado = await repo.ultimoCiclo();
  if (encerrado?.status === 'CONCLUIDO') {
    const indicados = (await repo.resultadosDoCiclo(encerrado.id)).filter(r => r.indicado);
    if (indicados.length) {
      blocos.push({
        embeds: [{
          color: F.COR,
          title: tema.titulo(`${tema.emoji.pendente} ÚLTIMO RESULTADO · CICLO ${encerrado.numero}`),
          description: indicados.map(r => `• **${F.nomeSeguro(r.detalhe?.nome ?? r.discord_id)}** · ${X.pts(r.pontos + r.bonus)} pts · ${r.decisao ? `decisão: **${r.decisao}**` : 'decisão pendente'}`).join('\n'),
        }],
      });
    }
  }

  const linhasPend = pendencias.map(p => `• #${p.id} · ${rotuloRevisao(p)} · <@${p.discord_id}>`);
  const linhasInfo = informativas.map(p => `• ${rotuloRevisao(p)} · <@${p.discord_id}>`);
  blocos.push({
    embeds: [{
      color: F.COR,
      title: tema.titulo(`${tema.emoji.aviso} PENDÊNCIAS DA LIDERANÇA (${pendencias.length})`),
      description: linhasPend.length ? linhasPend.slice(0, 15).join('\n') : 'Nada esperando decisão.',
      fields: linhasInfo.length ? [{ name: 'AVISOS (SÓ INFORMATIVOS)', value: linhasInfo.slice(0, 8).join('\n').slice(0, 1000) }] : [],
    }],
  });
  return blocos;
}

const ROTULOS_REVISAO = {
  rajada: 'rajada de recrutamentos suspeita', circulo: 'recrutado com nome parecido ao do recrutador',
  alvo_bloqueado: 'recrutou ID que estava em NÃO RECRUTAR', pico: 'semana muito acima do padrão', dispensa: 'pedido de semana dispensada',
};
function rotuloRevisao(p) {
  const base = ROTULOS_REVISAO[p.tipo] ?? p.tipo;
  return p.tipo === 'dispensa' ? `${base} (semana ${(p.semana ?? 0) + 1})` : base;
}

// Botões da liderança. Votar: um botão por indicado (até 4) + abster
async function acaoVotacao() {
  const votacao = await repo.cicloEmVotacao();
  const linhas = [];
  if (votacao) {
    const indicados = (await repo.resultadosDoCiclo(votacao.id)).filter(r => r.indicado).slice(0, 4);
    linhas.push(new ActionRowBuilder().addComponents(
      ...indicados.map(r => new ButtonBuilder().setCustomId(`merito:votar:${votacao.id}:${r.discord_id}`)
        .setLabel(`VOTAR: ${(r.detalhe?.nome ?? r.discord_id).slice(0, 60)}`).setStyle(ButtonStyle.Secondary)),
      new ButtonBuilder().setCustomId(`merito:votar:${votacao.id}:0`).setLabel('ABSTER-ME').setStyle(ButtonStyle.Secondary),
    ));
  }
  linhas.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('merito:pendencias').setLabel('ANALISAR PENDÊNCIAS').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('merito:vetar').setLabel('VETAR INDICADO').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('merito:decisao').setLabel('REGISTRAR DECISÃO').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('merito:config').setLabel('AJUSTAR REGRAS').setStyle(ButtonStyle.Secondary),
  ));
  return { content: '**AÇÕES DA LIDERANÇA**', components: linhas };
}

// montarAcao do painelCanal é síncrono: a versão assíncrona é resolvida antes, em montarBlocos
let acaoPronta = { content: '**AÇÕES DA LIDERANÇA**', components: [] };
const votacao = criarPainelCanal({
  slug: 'merito_votacao',
  nomeCanal: '🗳️・votação-mérito',
  razao: 'Votação e pendências do mérito de recrutadores (só liderança)',
  intervaloMin: 60,
  debounceMs: 5 * 1000,
  montarBlocos: async () => {
    acaoPronta = await acaoVotacao();
    return montarBlocosVotacao();
  },
  montarAcao: () => acaoPronta,
  canalVizinhoId: config.canais.quadroRecrutadores,
});

// Canal da votação (para avisos): cria o painel se ainda não existir
async function canalDaVotacao(client) {
  clienteAtual = client ?? clienteAtual;
  let id = await lerConfig(CHAVE_CANAL_VOTACAO);
  if (!id) {
    await votacao.atualizar(client);
    id = await lerConfig(CHAVE_CANAL_VOTACAO);
  }
  return id ? client.channels.fetch(id).catch(() => null) : null;
}

function iniciarPaineis(client) {
  clienteAtual = client;
  ranking.iniciar(client);
  votacao.iniciar(client);
}

function atualizarPaineis(client) {
  clienteAtual = client ?? clienteAtual;
  if (!clienteAtual) return;
  ranking.agendarAtualizacaoReativa(clienteAtual);
  votacao.agendarAtualizacaoReativa(clienteAtual);
}

module.exports = {
  iniciarPaineis, atualizarPaineis, canalDaVotacao, totalLideranca, montarBlocosMerito, montarBlocosVotacao,
  rotuloRevisao, CHAVE_CANAL_VOTACAO,
};

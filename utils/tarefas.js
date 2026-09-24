const config = require('../config/index.js');
const { registrarTipo } = require('./agendador');
const tema = require('../tema');

// Tipos de tarefa executados pelo agendador persistente.

async function buscarMembro(client, membroId) {
  const guild = await client.guilds.fetch(config.guildId);
  const membro = await guild.members.fetch(membroId).catch(() => null);
  return { guild, membro };
}

const VARIANTES_ADV = {
  socio: {
    cargoPerdido: () => config.cargos.socio,
    canal: () => config.canais.advPendentes,
    rotuloPessoa: 'MEMBRO',
    titulo: '❌ ADVERTÊNCIA NÃO PAGA — CARGO REMOVIDO',
    acao: 'CARGO DE SÓCIO REMOVIDO AUTOMATICAMENTE',
  },
  recrutador: {
    cargoPerdido: () => config.cargos.recrutador,
    canal: () => config.canais.historicoAdvRec,
    rotuloPessoa: 'RECRUTADOR',
    titulo: '❌ ADV. RECRUTAMENTO NÃO PAGA — CARGO REMOVIDO',
    acao: 'CARGO DE RECRUTADOR REMOVIDO AUTOMATICAMENTE',
  },
};

registrarTipo('adv_vencimento', async (client, p) => {
  const variante = VARIANTES_ADV[p.variante];
  if (!variante) throw new Error(`Variante de advertência desconhecida: ${p.variante}`);

  const { guild, membro } = await buscarMembro(client, p.membroId);
  if (!membro) return;
  // Cargo de advertência já saiu: pagou, ou a advertência foi removida/substituída
  if (!membro.roles.cache.has(p.cargoAdv)) return;

  await membro.roles.remove(variante.cargoPerdido()).catch(() => {});

  const canal = await guild.channels.fetch(variante.canal()).catch(() => null);
  if (!canal) return;
  await canal.send({
    embeds: [{
      color: tema.cor.perigo,
      title: variante.titulo,
      fields: [
        { name: variante.rotuloPessoa, value: `<@${p.membroId}>`, inline: true },
        { name: 'ADVERTÊNCIA', value: `${p.numAdv}ª`, inline: true },
        { name: 'MOTIVO', value: p.motivo, inline: false },
        { name: 'PUNIÇÃO', value: p.punicao, inline: false },
        { name: 'PRAZO', value: `${p.prazoLabel} (VENCIDO)`, inline: false },
        { name: 'AÇÃO', value: variante.acao, inline: false },
        { name: 'DATA DE VENCIMENTO', value: `<t:${p.expiraEm}:F>`, inline: false },
      ],
    }],
  });
});

// ── Agenda ─────────────────────────────────────────────────────────────────
// Carregados sob demanda: eventos dependem de módulos que também usam o agendador
registrarTipo('evento_publicar', async (client, p) => {
  const repo = require('./eventos/repositorio');
  const { publicarEvento } = require('./eventos/mensagem');
  const evento = await repo.buscarEvento(p.eventoId);
  if (evento?.status === 'ATIVO' && !evento.message_id) await publicarEvento(client, evento);
});

registrarTipo('evento_lembrete', async (client, p) => {
  const repo = require('./eventos/repositorio');
  const { avisarPorDM } = require('./eventos/interacoes');
  const evento = await repo.buscarEvento(p.eventoId);
  if (evento?.status !== 'ATIVO') return;
  const confirmados = (await repo.listarInscricoes(evento.id)).filter(i => i.status === 'CONFIRMADO');
  const quando = Math.floor(new Date(evento.inicio_em).getTime() / 1000);
  for (const inscrito of confirmados) {
    await avisarPorDM(client, inscrito.discord_id, {
      content: `⏰ Lembrete: **${evento.titulo}** começa <t:${quando}:R> (<t:${quando}:t>)${evento.local ? ` · 📍 ${evento.local}` : ''}.`,
    });
  }
});

// No horário de início as inscrições fecham e a mensagem passa a mostrar a presença
registrarTipo('evento_iniciar', async (client, p) => {
  const { atualizarMensagemEvento } = require('./eventos/mensagem');
  await atualizarMensagemEvento(client, p.eventoId);
});

registrarTipo('remover_cargo', async (client, p) => {
  const { membro } = await buscarMembro(client, p.membroId);
  if (!membro || !membro.roles.cache.has(p.cargoId)) return;
  await membro.roles.remove(p.cargoId);
});

// Evento realizado entra na memória do dia (só se houve presença marcada e o fórum existe)
registrarTipo('evento_memoria', async (client, p) => {
  const repo = require('./eventos/repositorio');
  const { publicarResumoEvento } = require('./memoria/publicacao');
  const { lerConfig } = require('./botConfig');
  const evento = await repo.buscarEvento(p.eventoId);
  if (evento?.status !== 'ATIVO' || !(await lerConfig('canal_forum_memoria'))) return;
  await publicarResumoEvento(client, evento, await repo.listarInscricoes(evento.id));
});

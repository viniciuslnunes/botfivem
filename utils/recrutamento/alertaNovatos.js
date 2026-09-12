const config = require('../../config/index.js');
const { garantirMembrosCarregados } = require('../membrosGuild');
const { listaLimitada } = require('../departamentos/regras');
const repo = require('./funilRepositorio');
const { mapearSociosPorIdFivem, novatosParaAlertar } = require('./funil');

// Alerta periódico: novato que entrou na torcida no jogo e não pediu recrutamento
// no Discord depois de N dias. Um resumo por ciclo; cada ID é alertado uma vez.
const INTERVALO_MS = 6 * 60 * 60 * 1000;
const TIPO_ALERTA = 'novato_sem_recrutamento';

async function verificarNovatosNaoRecrutados(client) {
  const dias = config.logsJogo.novatoSemRecrutamentoDias;
  const agora = new Date();
  const novatos = await repo.novatosDoPeriodo(new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000), agora);
  if (!novatos.length) return 0;

  const guild = await client.guilds.fetch(config.guildId);
  await garantirMembrosCarregados(guild);
  const idsSocios = new Set(mapearSociosPorIdFivem(guild.members.cache.values(), config.cargos.socio).keys());
  const jaAlertados = await repo.alertasJaEnviados(TIPO_ALERTA, novatos.map(n => n.id_fivem));
  const alertar = novatosParaAlertar(novatos, { idsSocios, jaAlertados, agora, dias });
  if (!alertar.length) return 0;

  const canal = await client.channels.fetch(config.logsJogo.canalAlertas).catch(() => null);
  if (!canal) return 0;
  await canal.send({
    content: config.logsJogo.mencionarAlertas.map(id => `<@&${id}>`).join(' '),
    embeds: [{
      color: 0xFFCC00,
      title: `🔎 NOVATOS SEM RECRUTAMENTO HÁ MAIS DE ${dias} DIAS`,
      description: listaLimitada(alertar.map(n =>
        `🆔 **${n.id_fivem}** · ${n.ator_nome ?? 'sem nome'} · entrou <t:${Math.floor(new Date(n.ocorrido_em).getTime() / 1000)}:R>`), 3900),
      footer: { text: 'Entraram na torcida no jogo e ainda não pediram recrutamento no Discord' },
    }],
  });
  await repo.registrarAlertas(TIPO_ALERTA, alertar.map(n => n.id_fivem));
  return alertar.length;
}

function iniciarAlertaNovatos(client) {
  const verificar = () => verificarNovatosNaoRecrutados(client).catch(err => console.error('[recrutamento] Erro no alerta de novatos:', err));
  setTimeout(verificar, 2 * 60 * 1000);
  setInterval(verificar, INTERVALO_MS);
}

module.exports = { verificarNovatosNaoRecrutados, iniciarAlertaNovatos };

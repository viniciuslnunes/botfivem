// Canal da inteligência para a liderança: nasce sozinho na primeira vez (como o de alerta do baú),
// com as mesmas permissões do canal de "associado em atenção", e o ID fica em bot_config.
const { ChannelType } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');

const CHAVE = 'canal_inteligencia';
const NOME = '🧠・inteligência';

async function garantirCanalInteligencia(client) {
  const guild = await client.guilds.fetch(config.guildId);
  const salvoId = await lerConfig(CHAVE);
  const salvo = salvoId && await guild.channels.fetch(salvoId).catch(() => null);
  if (salvo) return salvo;

  const referencia = await guild.channels.fetch(config.canais.associadoEmAtencao ?? config.logsJogo.canalAlertas).catch(() => null);
  const canal = await guild.channels.create({
    name: NOME,
    type: ChannelType.GuildText,
    parent: referencia?.parentId ?? null,
    permissionOverwrites: referencia
      ? referencia.permissionOverwrites.cache.map(o => ({ id: o.id, allow: o.allow, deny: o.deny }))
      : [],
    reason: 'Inteligência cruzada: alertas e boletim semanal para a liderança',
  });
  await gravarConfig(CHAVE, canal.id);
  return canal;
}

const mencoesLideranca = () => config.lideranca.map(id => `<@&${id}>`).join(' ');

module.exports = { garantirCanalInteligencia, mencoesLideranca };

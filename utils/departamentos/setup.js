const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const { CHAVE_CANAL_LOGS_GESTAO } = require('../logGestao');
const { CHAVE_CANAL: CHAVE_CANAL_QUADRO } = require('./quadro');
const { listarDepartamentos, salvarDepartamento } = require('./repositorio');
const { nomesDosCargos, nomeDoCanal } = require('./regras');

// Cria o que falta da estrutura das áreas e reaproveita o que já existe.
// Pode rodar de novo a qualquer momento.
const CHAVE_CATEGORIA = 'categoria_departamentos';
const LER = [P.ViewChannel, P.ReadMessageHistory];
const ESCREVER = [...LER, P.SendMessages, P.EmbedLinks, P.AttachFiles];

async function garantirCargo(guild, idSalvo, nome) {
  const salvo = idSalvo && guild.roles.cache.get(idSalvo);
  if (salvo) return { cargo: salvo, criado: false };
  const mesmoNome = guild.roles.cache.find(r => r.name === nome);
  if (mesmoNome) return { cargo: mesmoNome, criado: false };
  return { cargo: await guild.roles.create({ name: nome, mentionable: true, reason: 'Departamentos da torcida' }), criado: true };
}

// Canal que já existe não tem as permissões reescritas: ajuste manual é preservado
async function garantirCanal(guild, idSalvo, opcoes) {
  const salvo = idSalvo && guild.channels.cache.get(idSalvo);
  if (salvo) return { canal: salvo, criado: false };
  return { canal: await guild.channels.create({ ...opcoes, reason: 'Departamentos da torcida' }), criado: true };
}

function permissoesDaArea(guild, cargoMembroId, cargoGestorId) {
  return [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
    { id: cargoMembroId, allow: ESCREVER },
    { id: cargoGestorId, allow: [...ESCREVER, P.ManageMessages] },
    { id: config.cargos.presidente, allow: ESCREVER },
    { id: config.cargos.vicePresidente, allow: ESCREVER },
    // Velha guarda e diretoria acompanham todas as áreas em leitura
    { id: config.cargos.velhaGuarda, allow: LER, deny: [P.SendMessages] },
    { id: config.cargos.diretoria, allow: LER, deny: [P.SendMessages] },
    { id: guild.members.me.id, allow: [...ESCREVER, P.ManageChannels] },
  ];
}

async function montarEstruturaDepartamentos(guild) {
  await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
  const botId = guild.members.me.id;
  const resumo = [];

  const categoria = await garantirCanal(guild, await lerConfig(CHAVE_CATEGORIA), {
    name: '🏛️ DEPARTAMENTOS',
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      { id: botId, allow: ESCREVER },
    ],
  });
  await gravarConfig(CHAVE_CATEGORIA, categoria.canal.id);
  if (categoria.criado) resumo.push('📁 Categoria DEPARTAMENTOS criada');

  for (const area of await listarDepartamentos()) {
    const nomes = nomesDosCargos(area.nome);
    const membro = await garantirCargo(guild, area.cargo_membro_id, nomes.membro);
    const gestor = await garantirCargo(guild, area.cargo_gestor_id, nomes.gestor);
    const canal = await garantirCanal(guild, area.canal_id, {
      name: nomeDoCanal(area),
      type: ChannelType.GuildText,
      parent: categoria.canal.id,
      permissionOverwrites: permissoesDaArea(guild, membro.cargo.id, gestor.cargo.id),
    });
    await salvarDepartamento({
      slug: area.slug,
      cargoMembroId: membro.cargo.id,
      cargoGestorId: gestor.cargo.id,
      canalId: canal.canal.id,
    });
    const criados = [membro.criado && 'cargo membro', gestor.criado && 'cargo gestor', canal.criado && 'canal'].filter(Boolean);
    resumo.push(`${area.emoji} ${area.nome}: ${criados.length ? `criado ${criados.join(', ')}` : 'já existia'}`);
  }

  const quadro = await garantirCanal(guild, await lerConfig(CHAVE_CANAL_QUADRO), {
    name: '📋・quadro-departamentos',
    type: ChannelType.GuildText,
    parent: categoria.canal.id,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      { id: config.cargos.socio, allow: LER, deny: [P.SendMessages] },
      { id: botId, allow: ESCREVER },
    ],
  });
  await gravarConfig(CHAVE_CANAL_QUADRO, quadro.canal.id);
  if (quadro.criado) resumo.push('📋 Canal do quadro criado');

  const logs = await garantirCanal(guild, await lerConfig(CHAVE_CANAL_LOGS_GESTAO), {
    name: '🛠️・logs-gestao',
    type: ChannelType.GuildText,
    parent: categoria.canal.id,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
      ...config.lideranca.map(id => ({ id, allow: LER, deny: [P.SendMessages] })),
      { id: botId, allow: ESCREVER },
    ],
  });
  await gravarConfig(CHAVE_CANAL_LOGS_GESTAO, logs.canal.id);
  if (logs.criado) resumo.push('🛠️ Canal de logs de gestão criado');

  return resumo;
}

module.exports = { montarEstruturaDepartamentos };

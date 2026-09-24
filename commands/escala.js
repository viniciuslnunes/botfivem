const { SlashCommandBuilder } = require('discord.js');
const config = require('../config/index.js');
const { registrarLogGestao } = require('../utils/logGestao');
const eventosRepo = require('../utils/eventos/repositorio');
const { podeGerirEvento } = require('../utils/eventos/permissoes');
const { listaLimitada } = require('../utils/departamentos/regras');
const repo = require('../utils/escala/repositorio');
const regras = require('../utils/escala/regras');
const { montarConviteEscala } = require('../utils/escala/interacoes');
const tema = require('../tema');

async function carregarEventoGerivel(interaction) {
  const evento = await eventosRepo.buscarEvento(interaction.options.getInteger('evento'));
  if (!evento || evento.status === 'CANCELADO') return { erro: '❌ EVENTO NÃO ENCONTRADO OU CANCELADO.' };
  if (!(await podeGerirEvento(interaction.member, evento))) return { erro: '❌ SÓ QUEM ORGANIZA ESTE EVENTO (LIDERANÇA, CRIADOR OU GESTOR DA ÁREA) MEXE NA ESCALA.' };
  return { evento };
}

async function convocar(interaction) {
  const { evento, erro } = await carregarEventoGerivel(interaction);
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  const usuario = interaction.options.getUser('membro');
  const alvo = await interaction.guild.members.fetch(usuario.id).catch(() => null);
  // Desligado ou fora do servidor não assume posto
  if (!alvo?.roles.cache.has(config.cargos.socio)) return interaction.reply({ content: '❌ SÓ SÓCIO ATIVO ASSUME POSTO NA ESCALA.', flags: 64 });

  await interaction.deferReply({ flags: 64 });
  const funcao = interaction.options.getString('funcao');
  const r = await repo.convocar(evento.id, usuario.id, funcao, interaction.user.id);
  if (r.erro) return interaction.editReply({ content: `⚠️ ${usuario} JÁ ESTÁ NA ESCALA COMO **${regras.rotuloFuncao(funcao)}** (${r.atual.status}).`, allowedMentions: { parse: [] } });

  let avisado = true;
  try {
    await usuario.send(montarConviteEscala(evento, funcao, interaction.user.id));
  } catch {
    avisado = false;
  }
  await registrarLogGestao(interaction.client, {
    titulo: `🎖️ ESCALA — ${evento.titulo.toUpperCase()}`,
    ator: interaction.user.id,
    campos: [
      { name: 'CONVOCADO', value: `<@${usuario.id}>`, inline: true },
      { name: 'FUNÇÃO', value: regras.rotuloFuncao(funcao), inline: true },
      { name: 'EVENTO', value: `#${evento.id}`, inline: true },
    ],
  });
  return interaction.editReply({
    content: `🎖️ ${usuario} ${r.trocouFuncao ? 'TROCOU PARA' : 'CONVOCADO COMO'} **${regras.rotuloFuncao(funcao)}**.${avisado ? ' O CONVITE FOI POR DM.' : ' ⚠️ DM FECHADA: AVISE A PESSOA E PEÇA PARA ABRIR AS MENSAGENS DIRETAS.'}`,
    allowedMentions: { parse: [] },
  });
}

async function ver(interaction) {
  const { evento, erro } = await carregarEventoGerivel(interaction);
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const escala = await repo.listarEscala(evento.id);
  const fields = Object.keys(regras.FUNCOES_ESCALA)
    .map(funcao => ({ funcao, pessoas: escala.filter(e => e.funcao === funcao) }))
    .filter(g => g.pessoas.length)
    .map(g => ({
      name: regras.rotuloFuncao(g.funcao),
      value: listaLimitada(g.pessoas.map(p => `${regras.ICONE_STATUS[p.status]} <@${p.discord_id}>`), 1000),
      inline: true,
    }));
  const pendencias = regras.pendenciasEscala({ escala, inicioEm: evento.inicio_em });
  if (pendencias.length) fields.push({ name: 'PRECISA DE ATENÇÃO', value: regras.textoPendencias(pendencias), inline: false });
  return interaction.editReply({
    embeds: [{
      color: tema.cor.primaria,
      title: `🎖️ ESCALA — ${evento.titulo.toUpperCase()}`,
      description: `<t:${Math.floor(new Date(evento.inicio_em).getTime() / 1000)}:F> · ${tema.emoji.ok} aceitou · ${tema.emoji.pendente} sem resposta · ${tema.emoji.recusado} recusou`,
      fields: fields.length ? fields : [{ name: 'ESCALA', value: '*Ninguém convocado ainda.*', inline: false }],
    }],
    allowedMentions: { parse: [] },
  });
}

async function remover(interaction) {
  const { evento, erro } = await carregarEventoGerivel(interaction);
  if (erro) return interaction.reply({ content: erro, flags: 64 });
  const usuario = interaction.options.getUser('membro');
  const removido = await repo.removerDaEscala(evento.id, usuario.id);
  return interaction.reply({
    content: removido ? `🦅 ${usuario} SAIU DA ESCALA DE **${evento.titulo}**.` : `⚠️ ${usuario} NÃO ESTÁ NA ESCALA DESTE EVENTO.`,
    flags: 64,
    allowedMentions: { parse: [] },
  });
}

const opcaoEvento = o => o.setName('evento').setDescription('Evento').setRequired(true).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('escala')
    .setDescription('Quem trabalha em cada evento (coordenação, bandeira, bateria…)')
    .addSubcommand(s => s.setName('convocar').setDescription('Convoca um sócio para uma função (convite por DM)')
      .addIntegerOption(opcaoEvento)
      .addUserOption(o => o.setName('membro').setDescription('Sócio').setRequired(true))
      .addStringOption(o => o.setName('funcao').setDescription('Função').setRequired(true).addChoices(...regras.FUNCAO_CHOICES)))
    .addSubcommand(s => s.setName('ver').setDescription('Cobertura da escala e pendências').addIntegerOption(opcaoEvento))
    .addSubcommand(s => s.setName('remover').setDescription('Tira alguém da escala')
      .addIntegerOption(opcaoEvento)
      .addUserOption(o => o.setName('membro').setDescription('Integrante da escala').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'convocar') return convocar(interaction);
    if (sub === 'ver') return ver(interaction);
    return remover(interaction);
  },

  async autocomplete(interaction) {
    const busca = String(interaction.options.getFocused() ?? '').toLowerCase();
    const eventos = await eventosRepo.listarProximos(25);
    return interaction.respond(eventos
      .filter(e => e.titulo.toLowerCase().includes(busca) || String(e.id).startsWith(busca))
      .map(e => ({ name: `#${e.id} ${e.titulo}`.slice(0, 100), value: Number(e.id) })));
  },
};

// /setup: onboarding de uma torcida nova (diagnosticar, mapear o que já existe
// no servidor, criar o que falta). Só administrador. Toda a lógica de decisão
// está em diagnostico.js, mapeamento.js e criar.js (puros); aqui é só Discord.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const tema = require('../../tema');
const config = require('../../config/index.js');
const { registrarModulo } = require('../modulos');
const { habilitado } = require('../../plataforma/resolver');
const { visaoDoServidor, montarDiagnostico } = require('./diagnostico');
const { sugerirMapeamento, chavesFaltando } = require('./mapeamento');
const { planejarCriacao, executarCriacao } = require('./criar');
const { gerarSnippet } = require('./snippet');

const MSG_SO_ADMIN = `${tema.emoji.recusado} APENAS ADMINISTRADORES PODEM USAR O /SETUP.`;
const LIMITE_DESCRICAO = 3900;

// O que o /setup consulta: o tenant, a plataforma e a lista de módulos. Injetável
// (nos testes entra um tenant incompleto e um servidor falso); em produção vem
// do bot em execução. Preguiçoso: o módulo do /setup é carregado pela própria
// plataforma, então ela só pode ser lida na hora de executar.
function contextoPadrao() {
  return { tenant: config, plataforma: require('../../plataforma'), manifestos: require('../../modulos') };
}

// Módulos que o tenant PRETENDE usar (ligados por padrão ou pelo tenant.modulos),
// mesmo em modo instalação, quando quase nenhum está de fato carregado.
function modulosPretendidos(ctx) {
  return ctx.manifestos.filter(m => habilitado(m, ctx.tenant));
}

function cortar(texto) {
  return texto.length > LIMITE_DESCRICAO ? `${texto.slice(0, LIMITE_DESCRICAO)}\n…` : texto;
}

function embed(titulo, descricao) {
  return { color: tema.cor.primaria, title: tema.titulo(titulo), description: cortar(descricao) };
}

function ehAdmin(interaction) {
  return Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.Administrator));
}

async function diagnostico(interaction, ctx) {
  const guild = interaction.guild;
  const me = guild.members.me;
  const relatorio = montarDiagnostico({
    tenant: ctx.tenant,
    plataforma: ctx.plataforma,
    servidor: visaoDoServidor(guild),
    permissoesDoBot: me.permissions,
    posicaoDoBot: me.roles.highest.position,
  });
  const resumo = relatorio.problemas === 0
    ? `${tema.emoji.ok} **TUDO CERTO.**`
    : `${tema.emoji.recusado} **${relatorio.problemas} PROBLEMA(S) A RESOLVER.**`;
  return interaction.editReply({ embeds: [embed('SETUP — DIAGNÓSTICO', [resumo, '', ...relatorio.linhas].join('\n'))] });
}

function formatarSugestao(grupo, chave, valor) {
  const alvo = Array.isArray(valor)
    ? valor.map(id => (grupo === 'cargos' ? `<@&${id}>` : `<#${id}>`)).join(' ')
    : (grupo === 'cargos' ? `<@&${valor}>` : `<#${valor}>`);
  return `• \`${grupo}.${chave}\` → ${alvo}`;
}

async function mapear(interaction, ctx) {
  const pedidas = chavesFaltando(modulosPretendidos(ctx), ctx.tenant);
  const sugestao = sugerirMapeamento(visaoDoServidor(interaction.guild), pedidas);

  const linhas = [];
  for (const grupo of ['cargos', 'canais', 'categorias']) {
    for (const [k, v] of Object.entries(sugestao[grupo])) linhas.push(formatarSugestao(grupo, k, v));
  }
  const encontrados = linhas.length;
  const partes = [`**ENCONTRADOS PELO NOME (${encontrados}):**`, encontrados ? linhas.join('\n') : '_nenhum_'];
  if (sugestao.ambiguos.length) {
    partes.push('', `**AMBÍGUOS (${sugestao.ambiguos.length}) — escolha na mão:**`,
      ...sugestao.ambiguos.map(a => `• \`${a.chave}\` — ${a.opcoes.map(o => `“${o}”`).join(' ou ')}`));
  }
  if (sugestao.semCorrespondencia.length) {
    partes.push('', `**NÃO ENCONTRADOS (${sugestao.semCorrespondencia.length}):**`,
      sugestao.semCorrespondencia.map(c => `\`${c}\``).join(', '),
      '', 'Use `/setup criar` para criar o que falta.');
  }
  partes.push('', 'O arquivo anexo tem o trecho para colar no `tenants/<slug>/tenant.js`. **Confira antes de colar**: a busca é por nome.');

  const arquivo = new AttachmentBuilder(Buffer.from(gerarSnippet(sugestao), 'utf8'), { name: 'tenant-sugerido.js' });
  return interaction.editReply({ embeds: [embed('SETUP — MAPEAMENTO', partes.join('\n'))], files: [arquivo] });
}

// Recalcula o que falta no servidor AGORA (sem estado guardado entre o comando
// e o clique de confirmação).
function planoAtual(guild, ctx) {
  const pedidas = chavesFaltando(modulosPretendidos(ctx), ctx.tenant);
  const sugestao = sugerirMapeamento(visaoDoServidor(guild), pedidas);
  return { plano: planejarCriacao(sugestao.semCorrespondencia), sugestao };
}

async function criar(interaction, ctx) {
  const { plano } = planoAtual(interaction.guild, ctx);
  if (!plano.length) {
    return interaction.editReply({ embeds: [embed('SETUP — CRIAR', `${tema.emoji.ok} **NADA A CRIAR.** Tudo que os módulos ligados precisam já existe (ou é ambíguo — veja \`/setup mapear\`).`)] });
  }
  const linhas = plano.map(p => `• ${p.tipo === 'cargo' ? 'cargo' : p.tipo === 'categoria' ? 'categoria' : p.publico ? 'canal público' : 'canal privado'} **${p.nome}**`);
  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('setup:criar:confirmar').setLabel('CRIAR AGORA').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('setup:criar:cancelar').setLabel('CANCELAR').setStyle(ButtonStyle.Secondary),
  );
  return interaction.editReply({
    embeds: [embed('SETUP — CRIAR', [`**SERÃO CRIADOS (${plano.length}):**`, ...linhas, '', 'Canais privados só a liderança e o bot enxergam. Nada existente é alterado ou apagado.'].join('\n'))],
    components: [botoes],
  });
}

async function confirmarCriacao(interaction, ctx) {
  await interaction.deferUpdate();
  const { plano } = planoAtual(interaction.guild, ctx);
  const { criados, falhas } = await executarCriacao(interaction.guild, plano, { lideranca: ctx.tenant.lideranca ?? [] });
  const total = Object.values(criados).reduce((s, o) => s + Object.keys(o).length, 0);
  const partes = [`${tema.emoji.ok} **${total} ITEM(NS) CRIADO(S).**`];
  if (falhas.length) partes.push('', `${tema.emoji.recusado} **FALHAS (${falhas.length}):**`, ...falhas.map(f => `• ${f}`), '', 'Confira as permissões do bot com `/setup diagnostico`.');
  partes.push('', 'Cole o trecho anexo no `tenant.js` e reinicie o bot.');
  const arquivo = new AttachmentBuilder(Buffer.from(gerarSnippet(criados), 'utf8'), { name: 'tenant-criado.js' });
  return interaction.editReply({ embeds: [embed('SETUP — CRIADO', partes.join('\n'))], components: [], files: [arquivo] });
}

const SUBCOMANDOS = { diagnostico, mapear, criar };

async function executar(interaction, ctx = contextoPadrao()) {
  if (!ehAdmin(interaction)) return interaction.reply({ content: MSG_SO_ADMIN, flags: 64 });
  await interaction.deferReply({ flags: 64 });
  const sub = SUBCOMANDOS[interaction.options.getSubcommand()];
  return sub(interaction, ctx);
}

registrarModulo('setup', async interaction => {
  if (!ehAdmin(interaction)) return interaction.reply({ content: MSG_SO_ADMIN, flags: 64 });
  const [, acao, decisao] = interaction.customId.split(':');
  if (acao !== 'criar') return undefined;
  if (decisao === 'cancelar') {
    return interaction.update({ embeds: [embed('SETUP — CRIAR', 'Cancelado. Nada foi criado.')], components: [] });
  }
  if (decisao === 'confirmar') return confirmarCriacao(interaction, contextoPadrao());
  return undefined;
});

module.exports = { executar, confirmarCriacao, SUBCOMANDOS, modulosPretendidos, planoAtual, contextoPadrao };

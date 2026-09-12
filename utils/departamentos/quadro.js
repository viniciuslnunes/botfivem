const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const { listarDepartamentos } = require('./repositorio');
const { listaLimitada } = require('./regras');

function linhaBotaoQuadro() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('dept:quadro-atualizar').setLabel('Atualizar').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
  );
}

// Quadro fixo de quem faz parte de cada área, no padrão do embed de hierarquia
const CHAVE_CANAL = 'canal_quadro_departamentos';
const CHAVE_MENSAGEM = 'quadro_departamentos_message_id';

function montarEmbed(guild, areas) {
  const fields = areas.map(area => {
    const gestores = guild.members.cache.filter(m => m.roles.cache.has(area.cargo_gestor_id));
    const membros = guild.members.cache.filter(m => m.roles.cache.has(area.cargo_membro_id) && !m.roles.cache.has(area.cargo_gestor_id));
    const linhas = [...gestores.map(m => `👑 <@${m.id}>`), ...membros.map(m => `<@${m.id}>`)];
    return {
      name: `${area.emoji} ${area.nome.toUpperCase()} (${gestores.size + membros.size})`,
      value: linhas.length ? listaLimitada(linhas) : '*Sem integrantes.*',
      inline: true,
    };
  });
  return {
    color: 0x000000,
    title: '🏛️ DEPARTAMENTOS — GAVIÕES DA FIEL FIVEM',
    description: '👑 = gestor da área',
    fields,
    footer: { text: 'Atualizado automaticamente' },
    timestamp: new Date().toISOString(),
  };
}

async function atualizarQuadroDepartamentos(client) {
  const canalId = await lerConfig(CHAVE_CANAL);
  const canal = canalId ? await client.channels.fetch(canalId).catch(() => null) : null;
  if (!canal) return;
  const areas = await listarDepartamentos({ apenasAtivos: true });
  if (!areas.length) return;

  await canal.guild.members.fetch();
  const embed = montarEmbed(canal.guild, areas);
  const mensagemId = await lerConfig(CHAVE_MENSAGEM);
  const componentes = [linhaBotaoQuadro()];
  if (mensagemId) {
    try {
      const msg = await canal.messages.fetch(mensagemId);
      await msg.edit({ embeds: [embed], components: componentes, allowedMentions: { parse: [] } });
      return;
    } catch {
      // mensagem apagada — recriar
    }
  }
  const nova = await canal.send({ embeds: [embed], components: componentes, allowedMentions: { parse: [] } });
  await gravarConfig(CHAVE_MENSAGEM, nova.id);
}

// Várias trocas de cargo em sequência viram uma atualização só
let pendente = null;
function agendarAtualizacaoQuadro(client) {
  if (pendente) return;
  pendente = setTimeout(() => {
    pendente = null;
    atualizarQuadroDepartamentos(client).catch(err => console.error('[departamentos] Erro ao atualizar quadro:', err));
  }, 5000);
}

module.exports = { atualizarQuadroDepartamentos, agendarAtualizacaoQuadro, CHAVE_CANAL };

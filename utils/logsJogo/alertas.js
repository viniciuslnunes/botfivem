const { EmbedBuilder } = require('discord.js');
const config = require('../../config/index.js');
const { buscarBloqueio } = require('../naoRecrutar');

// Regras avaliadas só para log que acabou de chegar — nunca na sincronização
// do histórico, senão cada registro antigo viraria um alerta.
// Alerta avisa quem decide; não pune nem concede nada sozinho.

const JANELA_REPETICAO_MS = 6 * 60 * 60 * 1000;
const ultimosAlertasBloqueio = new Map(); // idFivem -> timestamp

function mencoes() {
  return config.logsJogo.mencionarAlertas.map(id => `<@&${id}>`).join(' ');
}

const REGRAS = [
  {
    nome: 'novato',
    async montar(registro) {
      if (registro.acao !== 'novato_entrou') return null;
      const alerta = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🆕 NOVO NOVATO DETECTADO')
        .setDescription('Um novo jogador entrou na torcida como **Novato** no jogo.\nRecrute-o para o servidor do Discord!')
        .addFields(
          { name: '👤 Nome no Jogo', value: registro.atorNome ?? 'Desconhecido', inline: true },
          { name: '🆔 ID FiveM', value: registro.atorIdFivem ?? 'N/A', inline: true }
        )
        .setFooter({ text: 'Detectado automaticamente via logs-liderança' })
        .setTimestamp();
      return { content: mencoes(), embeds: [alerta] };
    },
  },
  {
    nome: 'id_bloqueado_no_jogo',
    async montar(registro, client) {
      for (const idFivem of [registro.atorIdFivem, registro.alvoIdFivem].filter(Boolean)) {
        const ultimo = ultimosAlertasBloqueio.get(idFivem);
        if (ultimo && Date.now() - ultimo < JANELA_REPETICAO_MS) continue;
        const bloqueio = await buscarBloqueio(client, idFivem);
        if (!bloqueio) continue;
        ultimosAlertasBloqueio.set(idFivem, Date.now());
        const alerta = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('🚫 ID DA LISTA "NÃO RECRUTAR" ATIVO NO JOGO')
          .setDescription(registro.descricao ? registro.descricao.slice(0, 1000) : 'Registro sem descrição.')
          .addFields(
            { name: '🆔 ID FiveM', value: idFivem, inline: true },
            { name: '📂 Categoria', value: registro.categoria ?? 'N/A', inline: true }
          )
          .setFooter({ text: 'Detectado automaticamente nos logs do jogo' })
          .setTimestamp();
        return { content: mencoes(), embeds: [alerta, bloqueio] };
      }
      return null;
    },
  },
];

async function avaliarAlertas(client, registros) {
  if (!registros.length) return;
  const canal = await client.channels.fetch(config.logsJogo.canalAlertas).catch(() => null);
  if (!canal) return;
  for (const registro of registros) {
    for (const regra of REGRAS) {
      try {
        const mensagem = await regra.montar(registro, client);
        if (mensagem) await canal.send(mensagem);
      } catch (err) {
        console.error(`[logs-jogo] Erro no alerta ${regra.nome}:`, err);
      }
    }
  }
}

module.exports = { avaliarAlertas };

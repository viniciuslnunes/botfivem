const { EmbedBuilder } = require('discord.js');
const config = require('../../config/index.js');
const { buscarBloqueio } = require('../naoRecrutar');
const repo = require('./repositorio');
const E = require('./estatisticas');

// Regras avaliadas só para log que acabou de chegar — nunca na sincronização
// do histórico, senão cada registro antigo viraria um alerta.
// Alerta avisa quem decide; não pune nem concede nada sozinho.

const JANELA_REPETICAO_MS = 6 * 60 * 60 * 1000;
const ultimosAlertasBloqueio = new Map(); // idFivem -> timestamp

function mencoes() {
  return config.logsJogo.mencionarAlertas.map(id => `<@&${id}>`).join(' ');
}

const REGRAS = [
  // Regra 'novato' removida em 2026-09-13: `novato_entrou` só era logado pelo
  // canal 1461544673825783929 ("logs-liderança"), que pertence à categoria
  // "LOGS FANÁTICOS/ARENA" — outra comunidade, não o Hoolibras. Sem fonte de
  // verdade pro Hoolibras, essa regra nunca mais dispara.
  {
    nome: 'id_bloqueado_no_jogo',
    // Vai para o histórico de não recrutar, não para novatos: o ID já é
    // bloqueado, não é candidato a recrutamento.
    canal: () => config.canais.historicoNaoRecrutar,
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
  {
    nome: 'retirada_grande_bau',
    // Retirada grande é o único evento do baú que precisa de alguém olhando na
    // hora: material do baú é da torcida, e o log não diz pra onde foi. O nome
    // do jogador é emprestado dos outros canais — o log do baú só manda o ID.
    async montar(registro) {
      if (registro.acao !== 'bau_removeu') return null;
      const quantidade = Number(registro.valor) || 0;
      if (quantidade < config.logsJogo.bau.alertaRetiradaQtd) return null;

      const nome = registro.atorIdFivem
        ? (await repo.nomesPorIds([registro.atorIdFivem])).get(registro.atorIdFivem)
        : null;
      const alerta = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('📦 RETIRADA GRANDE NO BAÚ DA TORCIDA')
        .setDescription(`Saiu uma quantidade acima do normal do baú de uma vez só.`)
        .addFields(
          { name: '📦 Item', value: `${E.formatarNumero(quantidade)}× ${registro.alvoNome ?? '?'}`, inline: true },
          { name: '🗄️ Baú', value: E.bauDoTitulo(registro.titulo) ?? 'N/A', inline: true },
          { name: '👤 Quem', value: nome ? `${nome} (${registro.atorIdFivem})` : (registro.atorIdFivem ?? 'N/A'), inline: true }
        )
        .setFooter({ text: `Alerta a partir de ${E.formatarNumero(config.logsJogo.bau.alertaRetiradaQtd)} unidades · canal logs-baú` })
        .setTimestamp();
      return { content: mencoes(), embeds: [alerta] };
    },
  },
  {
    nome: 'saque_grande_banco',
    // Saque do banco da torcida acima do limite: dinheiro coletivo saindo.
    async montar(registro) {
      if (registro.acao !== 'banco_sacou') return null;
      const valor = Number(registro.valor) || 0;
      if (valor < config.logsJogo.caixa.alertaSaqueValor) return null;

      const alerta = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🏦 SAQUE GRANDE NO BANCO DA TORCIDA')
        .setDescription(registro.descricao ? registro.descricao.slice(0, 1000) : 'Registro sem descrição.')
        .addFields(
          { name: '💰 Valor', value: E.formatarDinheiro(valor), inline: true },
          { name: '👤 Quem', value: registro.atorNome ?? registro.atorIdFivem ?? 'N/A', inline: true }
        )
        .setFooter({ text: `Alerta a partir de ${E.formatarDinheiro(config.logsJogo.caixa.alertaSaqueValor)} · canal logs-banco` })
        .setTimestamp();
      return { content: mencoes(), embeds: [alerta] };
    },
  },
];

const canaisAlerta = new Map(); // idCanal -> Channel (cache simples, uma leva por vez)

async function resolverCanal(client, idCanal) {
  if (!canaisAlerta.has(idCanal)) {
    canaisAlerta.set(idCanal, await client.channels.fetch(idCanal).catch(() => null));
  }
  return canaisAlerta.get(idCanal);
}

async function avaliarAlertas(client, registros) {
  if (!registros.length) return;
  canaisAlerta.clear();
  for (const registro of registros) {
    for (const regra of REGRAS) {
      try {
        const mensagem = await regra.montar(registro, client);
        if (!mensagem) continue;
        const idCanal = regra.canal ? regra.canal() : config.logsJogo.canalAlertas;
        const canal = await resolverCanal(client, idCanal);
        if (canal) await canal.send(mensagem);
      } catch (err) {
        console.error(`[logs-jogo] Erro no alerta ${regra.nome}:`, err);
      }
    }
  }
}

module.exports = { avaliarAlertas };

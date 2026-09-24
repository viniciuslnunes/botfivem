// Liga os eventos do Discord aos módulos ativos. É a única ponte entre o
// Discord e os módulos: cada evento vira um hook (aoIniciar, aoMensagem…) que
// só os módulos ligados recebem. Antes isso eram 6 arquivos em events/ que
// conheciam todos os domínios do bot.
const { Events } = require('discord.js');
const { despacharInteracao } = require('../utils/modulos');
const { executarEmSequencia, executarAteConsumir, dispararSemEsperar } = require('./executar');

function registrarEventos(client, { ativos, idsAtivos, contexto }, { executarMigracoes, iniciarAgendador }) {
  const opcoes = { contexto };

  // ── Bot pronto ────────────────────────────────────────────────────────────
  client.once('clientReady', async () => {
    console.log(`Bot online como ${client.user.tag}`);

    // Estrutura do banco (só as tabelas dos módulos ligados) antes de qualquer
    // rotina que dependa dela
    await executarMigracoes(idsAtivos);
    iniciarAgendador(client);

    // Cada módulo sobe por conta própria, sem esperar os outros
    dispararSemEsperar(ativos, 'aoIniciar', [client], opcoes);
  });

  // ── Interações (botões, selects, modais, comandos slash) ──────────────────
  client.on('interactionCreate', async interaction => {
    try {
      if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (command?.autocomplete) {
          await command.autocomplete(interaction).catch(err => console.error('[autocomplete] Erro:', err));
        }
        return;
      }

      // Botões, selects e modais: customId "<modulo>:..." (ou id legado) resolve aqui
      if (await despacharInteracao(interaction)) return;

      // Comando slash
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        try {
          await command.execute(interaction);
        } catch (err) {
          if (err.code === 10062 || err.code === 40060) return;
          console.error(err);
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'ERRO AO EXECUTAR COMANDO.', flags: 64 }).catch(() => {});
          } else {
            await interaction.reply({ content: 'ERRO AO EXECUTAR COMANDO.', flags: 64 }).catch(() => {});
          }
        }
      }
    } catch (err) {
      // Ignora interações expiradas (10062) ou já respondidas (40060)
      if (err.code === 10062 || err.code === 40060) return;
      console.error('[interactionCreate] Erro não tratado:', err);
      // Sem isso, um erro depois de deferReply/deferUpdate (ex.: select de
      // período em painel-jogadores) deixava a interação presa em "pensando..."
      // pra sempre — o catch só logava no console, nunca respondia ao Discord.
      if (typeof interaction.isRepliable === 'function' && interaction.isRepliable()) {
        const payload = { content: '❌ OCORREU UM ERRO AO PROCESSAR ESSA AÇÃO. TENTE NOVAMENTE.', flags: 64 };
        const acao = interaction.deferred || interaction.replied
          ? interaction.editReply(payload)
          : interaction.reply(payload);
        await acao.catch(() => {});
      }
    }
  });

  // ── Mensagens: o primeiro módulo que consumir encerra a cadeia ────────────
  client.on('messageCreate', async message => {
    await executarAteConsumir(ativos, 'aoMensagem', [message, client], opcoes);
  });

  // ── Membro mudou de cargo/apelido ─────────────────────────────────────────
  client.on(Events.GuildMemberUpdate, async (antes, depois) => {
    await executarEmSequencia(ativos, 'aoMembroAtualizado', [antes, depois, client], opcoes);
  });

  // ── Reações ───────────────────────────────────────────────────────────────
  client.on('messageReactionAdd', async (reaction, user) => {
    await executarEmSequencia(ativos, 'aoReacaoAdicionada', [reaction, user, client], opcoes);
  });
  client.on('messageReactionRemove', async (reaction, user) => {
    await executarEmSequencia(ativos, 'aoReacaoRemovida', [reaction, user, client], opcoes);
  });
}

module.exports = { registrarEventos };

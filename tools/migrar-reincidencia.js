// Migração única: move os alertas de SÓCIO REINCIDENTE do canal antigo (associadoEmAtencao) para o
// canal de ocorrências. Por padrão só LISTA (dry-run); com --executar reposta, atualiza o caso e apaga
// o original. Usa a API REST (não sobe o bot). Sem ping: allowed_mentions vazio na repostagem.
//   node tools/migrar-reincidencia.js             # lista o que seria movido
//   node tools/migrar-reincidencia.js --executar  # move de verdade
// Com --tipo ficha_parada move os alertas de FICHA PARADA do canal de inteligência para setagensPendentes.
require('dotenv').config({ quiet: true });
const { REST, Routes } = require('discord.js');
const config = require('../config');
const db = require('../utils/db');
const casos = require('../utils/inteligencia/casos');

const executar = process.argv.includes('--executar');
const tipo = process.argv.includes('--tipo') ? process.argv[process.argv.indexOf('--tipo') + 1] : 'reincidencia';
const ROTAS = {
  reincidencia: { origem: config.canais.associadoEmAtencao, destino: config.canais.ocorrencias },
  ficha_parada: { origem: null, destino: config.canais.setagensPendentes }, // origem: canal em que o caso foi postado
};
if (!ROTAS[tipo]) throw new Error(`--tipo deve ser um de: ${Object.keys(ROTAS).join(', ')}`);
const { origem, destino } = ROTAS[tipo];

async function main() {
  if (!destino || (tipo === 'reincidencia' && !origem)) throw new Error('o canal de origem e o de destino precisam estar no tenant.');
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const { rows } = await db.query(
    "SELECT * FROM inteligencia_casos WHERE tipo = $1 AND ($2::text IS NULL OR canal_id = $2) AND canal_id <> $3 AND message_id IS NOT NULL ORDER BY aberto_em", [tipo, origem, destino]);
  console.log(`${rows.length} alerta(s) de ${tipo} no canal antigo (${executar ? 'EXECUTANDO' : 'dry-run'}).`);
  let movidos = 0;
  for (const caso of rows) {
    let msg;
    try {
      msg = await rest.get(Routes.channelMessage(caso.canal_id, caso.message_id));
    } catch (err) {
      console.log(`  caso ${caso.id} (${caso.status}): mensagem ${caso.message_id} não existe mais (${err.status ?? err.message}); ignorado`);
      continue;
    }
    console.log(`  caso ${caso.id} (${caso.status}) alvo ${caso.alvo_discord_id}: mensagem ${caso.message_id}`);
    if (!executar) continue;
    const componentes = caso.status === 'ABERTO' ? [casos.botoes(caso.id).toJSON()] : [];
    const nova = await rest.post(Routes.channelMessages(destino), {
      body: { content: msg.content || undefined, embeds: msg.embeds, components: componentes, allowed_mentions: { parse: [] } },
    });
    await casos.registrarMensagem(caso.id, destino, nova.id); // só depois de repostar
    await rest.delete(Routes.channelMessage(caso.canal_id, caso.message_id)).catch(err => console.warn(`  não apaguei o original ${caso.message_id}: ${err.message}`));
    movidos++;
  }
  console.log(executar ? `${movidos} movido(s).` : 'Nada foi alterado. Rode com --executar para mover.');
}

main().catch(err => { console.error(err); process.exitCode = 1; }).finally(() => db.pool?.end?.());

// Escalonamento: alerta de caso prioritário que ninguém tocou em 24 h ganha UM lembrete, respondendo à
// própria mensagem e chamando a liderança de novo. Só uma vez por caso (marca em `dados.escalado`):
// insistir mais que isso vira ruído, e o caso expira sozinho em 30 dias.
const db = require('../db');
const config = require('../../config/index.js');
const casos = require('./casos');
const { mencoesLideranca } = require('./canais');

const HORAS = 24;
const LIMITE_POR_VARREDURA = 5;
const TIPOS_PRIORITARIOS = Object.freeze([
  'reincidencia', 'blacklist_sem_bloqueio', 'restricao_com_pendencia', 'responsavel_em_risco', 'saiu_segue_socio',
]);

async function candidatos() {
  const { rows } = await db.query(
    `SELECT * FROM inteligencia_casos
      WHERE status = 'ABERTO' AND tipo = ANY($1) AND canal_id IS NOT NULL AND message_id IS NOT NULL
        AND aberto_em < now() - ($2 || ' hours')::interval AND NOT (dados ? 'escalado')
      ORDER BY aberto_em LIMIT ${LIMITE_POR_VARREDURA}`,
    [TIPOS_PRIORITARIOS, String(HORAS)]
  );
  return rows;
}

// Marca antes de avisar: falha no meio não repete o lembrete em loop
async function marcar(id) {
  const { rows } = await db.query(
    `UPDATE inteligencia_casos SET dados = dados || '{"escalado": true}'::jsonb
      WHERE id = $1 AND status = 'ABERTO' AND NOT (dados ? 'escalado') RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

async function escalarCasosParados(client) {
  let escalados = 0;
  for (const caso of await candidatos()) {
    if (!(await marcar(caso.id))) continue;
    try {
      const canal = await client.channels.fetch(caso.canal_id);
      const texto = `⏰ **${casos.ROTULOS[caso.tipo] ?? caso.tipo}** segue sem ação há ${HORAS} h. ${mencoesLideranca()}`;
      const opcoes = { content: texto, allowedMentions: { roles: config.lideranca.filter(Boolean) } };
      const original = await canal.messages.fetch(caso.message_id).catch(() => null);
      await (original ? original.reply(opcoes) : canal.send(opcoes));
      escalados++;
    } catch (err) {
      console.error('[inteligencia] Escalonamento falhou:', err.message);
    }
  }
  return escalados;
}

module.exports = { escalarCasosParados, candidatos, TIPOS_PRIORITARIOS, HORAS };

const db = require('../db');
const config = require('../../config/index.js');
const { formatarDataBR, chaveDataValidade } = require('./regras');
const tema = require('../../tema');

// Aviso por DM antes de vencer e no dia em que vence. Os carimbos em `socios`
// garantem um aviso só por ciclo (renovar zera os carimbos).
const INTERVALO_MS = 6 * 60 * 60 * 1000;
const HOJE_SP = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
// Carteirinha vencida há mais tempo que isso não gera DM retroativa (evita avalanche no 1º deploy)
const JANELA_AVISO_VENCIDA_DIAS = 7;

async function enviarDM(client, discordId, embed) {
  try {
    const usuario = await client.users.fetch(discordId);
    await usuario.send({ embeds: [embed] });
  } catch {
    // DM fechada: o aviso é marcado mesmo assim, para não repetir a cada ciclo
  }
}

async function verificarVencimentos(client) {
  const aVencer = await db.query(
    `SELECT discord_id, numero_socio, validade FROM socios
      WHERE revogada_em IS NULL AND aviso_vencimento_em IS NULL
        AND validade::date >= ${HOJE_SP} AND validade::date <= ${HOJE_SP} + $1::int`,
    [config.carteirinha.avisoVencimentoDias]
  );
  for (const socio of aVencer.rows) {
    await enviarDM(client, socio.discord_id, {
      color: tema.cor.aviso,
      title: '🪪 SUA CARTEIRINHA ESTÁ PERTO DE VENCER',
      description: `A carteirinha de sócio nº **${String(socio.numero_socio).padStart(4, '0')}** vence em **${formatarDataBR(chaveDataValidade(socio.validade))}**.\nProcure a diretoria para renovar.`,
    });
    await db.query('UPDATE socios SET aviso_vencimento_em = now() WHERE discord_id = $1', [socio.discord_id]);
  }

  const vencidas = await db.query(
    `SELECT discord_id, numero_socio, validade, validade::date >= ${HOJE_SP} - $1::int AS recente FROM socios
      WHERE revogada_em IS NULL AND aviso_vencida_em IS NULL AND validade::date < ${HOJE_SP}`,
    [JANELA_AVISO_VENCIDA_DIAS]
  );
  for (const socio of vencidas.rows) {
    if (socio.recente) {
      await enviarDM(client, socio.discord_id, {
        color: tema.cor.perigo,
        title: '🪪 SUA CARTEIRINHA VENCEU',
        description: `A carteirinha de sócio nº **${String(socio.numero_socio).padStart(4, '0')}** venceu em **${formatarDataBR(chaveDataValidade(socio.validade))}**.\nProcure a diretoria para renovar.`,
      });
    }
    await db.query('UPDATE socios SET aviso_vencida_em = now() WHERE discord_id = $1', [socio.discord_id]);
  }
}

function iniciarVerificacaoVencimentos(client) {
  const verificar = () => verificarVencimentos(client).catch(err => console.error('[carteirinha] Erro ao verificar vencimentos:', err));
  setTimeout(verificar, 60 * 1000);
  setInterval(verificar, INTERVALO_MS);
}

module.exports = { verificarVencimentos, iniciarVerificacaoVencimentos };

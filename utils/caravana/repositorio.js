const db = require('../db');
const { transacao } = require('../transacao');
const { podeAlocarNoVeiculo } = require('./regras');

async function adicionarVeiculo(v) {
  const { rows } = await db.query(
    `INSERT INTO caravana_veiculos (evento_id, nome, capacidade, responsavel_id, ponto, horario)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [v.eventoId, v.nome, v.capacidade, v.responsavelId, v.ponto, v.horario]
  );
  return rows[0];
}

async function listarVeiculos(eventoId) {
  const { rows } = await db.query('SELECT * FROM caravana_veiculos WHERE evento_id = $1 ORDER BY id', [eventoId]);
  return rows;
}

// Veículo travado: dois recrutadores alocando ao mesmo tempo não passam da capacidade
async function alocar(eventoId, discordId, veiculoId) {
  return transacao(async c => {
    const { rows: [veiculo] } = await c.query(
      'SELECT * FROM caravana_veiculos WHERE id = $1 AND evento_id = $2 FOR UPDATE', [veiculoId, eventoId]);
    if (!veiculo) return { erro: '❌ VEÍCULO NÃO ENCONTRADO NESTA CARAVANA.' };
    const { rows: [inscricao] } = await c.query(
      'SELECT status, veiculo_id FROM evento_inscricoes WHERE evento_id = $1 AND discord_id = $2', [eventoId, discordId]);
    if (inscricao?.status !== 'CONFIRMADO') return { erro: '❌ SÓ QUEM ESTÁ CONFIRMADO NA CARAVANA RECEBE VEÍCULO.' };
    const { rows: [{ alocados }] } = await c.query(
      "SELECT COUNT(*)::int AS alocados FROM evento_inscricoes WHERE veiculo_id = $1 AND status = 'CONFIRMADO'", [veiculoId]);
    const decisao = podeAlocarNoVeiculo({
      capacidade: veiculo.capacidade,
      alocados,
      jaNesteVeiculo: String(inscricao.veiculo_id) === String(veiculoId),
    });
    if (!decisao.ok) return { erro: decisao.mensagem };
    await c.query('UPDATE evento_inscricoes SET veiculo_id = $3, atualizado_em = now() WHERE evento_id = $1 AND discord_id = $2',
      [eventoId, discordId, veiculoId]);
    return { veiculo, lugar: alocados + 1 };
  });
}

async function registrarEmbarque(eventoId, discordIds, trecho, porId) {
  const { rows } = await db.query(
    `INSERT INTO evento_checkins (evento_id, discord_id, trecho, registrado_por_id)
     SELECT $1, id, $3, $4 FROM unnest($2::text[]) AS id
     ON CONFLICT DO NOTHING RETURNING discord_id`,
    [eventoId, discordIds, trecho, porId]
  );
  return rows.map(r => r.discord_id);
}

async function listarCheckins(eventoId) {
  const { rows } = await db.query('SELECT discord_id, trecho FROM evento_checkins WHERE evento_id = $1', [eventoId]);
  return rows;
}

module.exports = { adicionarVeiculo, listarVeiculos, alocar, registrarEmbarque, listarCheckins };

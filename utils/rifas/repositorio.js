const db = require('../db');
const { transacao } = require('../transacao');
const financeiro = require('../financeiro/repositorio');
const { chaveDia } = require('../logsJogo/estatisticas');
const R = require('./regras');

// Número ocupado = pago, reservado sem prazo (o comprador avisou que pagou) ou reservado
// dentro do prazo. Reserva vencida e bilhete cancelado são retomáveis: a linha não é
// apagada, é tomada pelo próximo comprador com a condição no WHERE.
const OCUPADO = "(b.status = 'PAGO' OR (b.status = 'RESERVADO' AND (b.expira_em IS NULL OR b.expira_em > now())))";
const COMPRA_PENDENTE = "(c.status = 'AGUARDANDO' OR (c.status = 'PENDENTE' AND c.expira_em > now()))";

class NumerosIndisponiveis extends Error {
  constructor(numeros) {
    super('Números indisponíveis');
    this.numeros = numeros;
  }
}

const idValido = id => /^\d+$/.test(String(id));

async function criarRifa(r) {
  const { rows } = await db.query(
    `INSERT INTO rifas (titulo, descricao, premio, custo_premio, imagem_ref, preco, total_numeros, limite_por_pessoa,
       metodo_sorteio, regra_nao_vendido, compromisso_hash, semente, encerra_em, canal_id, criado_por_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [r.titulo, r.descricao, r.premio, r.custoPremio, r.imagemRef, r.preco, r.totalNumeros, r.limitePorPessoa,
      r.metodoSorteio, r.regraNaoVendido, r.compromissoHash, r.semente, r.encerraEm, r.canalId, r.criadoPorId]
  );
  return rows[0];
}

async function buscarRifa(id) {
  if (!idValido(id)) return null;
  const { rows } = await db.query('SELECT * FROM rifas WHERE id = $1', [id]);
  return rows[0] ?? null;
}

async function gravarMensagem(rifaId, messageId) {
  await db.query('UPDATE rifas SET message_id = $2 WHERE id = $1', [rifaId, messageId]);
}

async function listarRifas({ status = null, limite = 25 } = {}) {
  const { rows } = await db.query(
    `SELECT id, titulo, status, vendidos, total_numeros, canal_id, message_id, encerra_em FROM rifas
      WHERE ($1::text[] IS NULL OR status = ANY($1)) ORDER BY criado_em DESC LIMIT $2`,
    [status, limite]
  );
  return rows;
}

async function contarReservados(rifaId) {
  const { rows: [{ total }] } = await db.query(
    `SELECT COUNT(*)::int AS total FROM rifa_bilhetes b
      WHERE b.rifa_id = $1 AND b.status = 'RESERVADO' AND (b.expira_em IS NULL OR b.expira_em > now())`,
    [rifaId]
  );
  return total;
}

async function numerosOcupados(rifaId, conexao = db) {
  const { rows } = await conexao.query(`SELECT b.numero FROM rifa_bilhetes b WHERE b.rifa_id = $1 AND ${OCUPADO}`, [rifaId]);
  return rows.map(r => r.numero);
}

async function bilhetesDaPessoa(rifaId, discordId) {
  const { rows } = await db.query(
    `SELECT b.numero, b.status, b.expira_em, b.compra_id FROM rifa_bilhetes b
      WHERE b.rifa_id = $1 AND b.discord_id = $2 AND ${OCUPADO} ORDER BY b.numero`,
    [rifaId, discordId]
  );
  return rows;
}

// Reservas que ainda esperam o aviso de pagamento (para recuperar os botões)
async function comprasAbertasDaPessoa(rifaId, discordId) {
  const { rows } = await db.query(
    `SELECT * FROM rifa_compras
      WHERE rifa_id = $1 AND discord_id = $2 AND status = 'PENDENTE' AND expira_em > now()
      ORDER BY criado_em LIMIT 5`,
    [rifaId, discordId]
  );
  return rows;
}

async function buscarCompra(id) {
  if (!idValido(id)) return null;
  const { rows } = await db.query('SELECT * FROM rifa_compras WHERE id = $1', [id]);
  return rows[0] ?? null;
}

async function numerosDaCompra(compraId) {
  const { rows } = await db.query(
    "SELECT numero FROM rifa_bilhetes WHERE compra_id = $1 AND status IN ('RESERVADO', 'PAGO') ORDER BY numero",
    [compraId]
  );
  return rows.map(r => r.numero);
}

async function gravarMensagemEquipe(compraId, ref) {
  await db.query('UPDATE rifa_compras SET mensagem_equipe_ref = $2 WHERE id = $1', [compraId, ref]);
}

async function comprasPendentes(rifaId) {
  const { rows } = await db.query(
    `SELECT c.* FROM rifa_compras c WHERE c.rifa_id = $1 AND ${COMPRA_PENDENTE} ORDER BY c.criado_em`,
    [rifaId]
  );
  return rows;
}

async function maioresCompradores(rifaId, limite = 10) {
  const { rows } = await db.query(
    `SELECT discord_id, SUM(quantidade)::int AS numeros, SUM(total)::float AS total FROM rifa_compras
      WHERE rifa_id = $1 AND status = 'PAGA' GROUP BY discord_id ORDER BY numeros DESC LIMIT $2`,
    [rifaId, limite]
  );
  return rows;
}

// Sempre a rifa antes da compra: a mesma ordem de trava em todo o módulo, sem deadlock
async function travarCompra(c, compraId) {
  if (!idValido(compraId)) return {};
  const { rows: [ref] } = await c.query('SELECT rifa_id FROM rifa_compras WHERE id = $1', [compraId]);
  if (!ref) return {};
  const { rows: [rifa] } = await c.query('SELECT * FROM rifas WHERE id = $1 FOR UPDATE', [ref.rifa_id]);
  const { rows: [compra] } = await c.query('SELECT * FROM rifa_compras WHERE id = $1 FOR UPDATE', [compraId]);
  return { rifa, compra };
}

// A reserva continua inteira se nenhum número dela foi retomado por outra pessoa
async function reservaIntacta(c, compra) {
  const { rows: [{ n }] } = await c.query(
    "SELECT COUNT(*)::int AS n FROM rifa_bilhetes WHERE compra_id = $1 AND status = 'RESERVADO'", [compra.id]);
  return n === compra.quantidade;
}

async function expirarCompras(c, compraIds) {
  if (!compraIds.length) return [];
  const { rows } = await c.query(
    "UPDATE rifa_compras SET status = 'EXPIRADA' WHERE id = ANY($1) AND status = 'PENDENTE' AND expira_em <= now() RETURNING *",
    [compraIds]
  );
  if (rows.length) {
    await c.query(
      "UPDATE rifa_bilhetes SET status = 'CANCELADO', atualizado_em = now() WHERE compra_id = ANY($1) AND status = 'RESERVADO'",
      [rows.map(r => r.id)]
    );
  }
  return rows;
}

// Trava a rifa: limite por pessoa e sorteio de número livre sem corrida. A chave
// primária (rifa_id, numero) continua sendo a garantia final contra número duplicado.
async function reservar({ rifaId, discordId, numeros = null, quantidade = null }) {
  try {
    return await transacao(async c => {
      const { rows: [rifa] } = await c.query('SELECT * FROM rifas WHERE id = $1 FOR UPDATE', [rifaId]);
      if (!rifa) return { erro: 'nao_encontrada' };
      if (!R.aceitaVenda(rifa)) return { erro: 'fechada', rifa };

      const { rows: [{ ja_tem: jaTem }] } = await c.query(
        `SELECT COUNT(*)::int AS ja_tem FROM rifa_bilhetes b WHERE b.rifa_id = $1 AND b.discord_id = $2 AND ${OCUPADO}`,
        [rifaId, discordId]
      );
      const saldo = R.saldoLimite(rifa.limite_por_pessoa, jaTem);
      if (saldo !== null && (numeros ? numeros.length : quantidade) > saldo) return { erro: 'limite', saldo, rifa };

      let escolhidos = numeros;
      if (!escolhidos) {
        const ocupados = new Set(await numerosOcupados(rifaId, c));
        escolhidos = R.sortearNumerosLivres(rifa.total_numeros, ocupados, quantidade).sort((a, b) => a - b);
        if (escolhidos.length < quantidade) return { erro: 'sem_numeros', livres: escolhidos.length, rifa };
      }

      // Donos anteriores dos números (reserva vencida ou cancelada), lidos antes da retomada
      const { rows: anteriores } = await c.query(
        'SELECT DISTINCT compra_id FROM rifa_bilhetes WHERE rifa_id = $1 AND numero = ANY($2)',
        [rifaId, escolhidos]
      );

      const expiraEm = new Date(Date.now() + R.MINUTOS_RESERVA * 60 * 1000);
      const { rows: [compra] } = await c.query(
        `INSERT INTO rifa_compras (rifa_id, discord_id, quantidade, total, expira_em)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [rifaId, discordId, escolhidos.length, R.totalCompra(rifa.preco, escolhidos.length), expiraEm]
      );
      const { rows: tomados } = await c.query(
        `INSERT INTO rifa_bilhetes AS b (rifa_id, numero, compra_id, discord_id, status, expira_em)
         SELECT $1, n, $3, $4, 'RESERVADO', $5 FROM unnest($2::int[]) AS n
         ON CONFLICT (rifa_id, numero) DO UPDATE
           SET compra_id = EXCLUDED.compra_id, discord_id = EXCLUDED.discord_id, status = 'RESERVADO',
               expira_em = EXCLUDED.expira_em, atualizado_em = now()
           WHERE b.status = 'CANCELADO' OR (b.status = 'RESERVADO' AND b.expira_em IS NOT NULL AND b.expira_em <= now())
         RETURNING numero`,
        [rifaId, escolhidos, compra.id, discordId, expiraEm]
      );
      if (tomados.length < escolhidos.length) {
        const conseguidos = new Set(tomados.map(t => t.numero));
        throw new NumerosIndisponiveis(escolhidos.filter(n => !conseguidos.has(n)));
      }

      await expirarCompras(c, anteriores.map(a => a.compra_id));
      return { compra, rifa, numeros: escolhidos };
    });
  } catch (err) {
    if (err instanceof NumerosIndisponiveis) return { erro: 'indisponiveis', numeros: err.numeros };
    throw err;
  }
}

// O comprador avisa que pagou no jogo: a reserva deixa de vencer até a equipe conferir
async function avisarPagamento(compraId, discordId) {
  return transacao(async c => {
    const { rifa, compra } = await travarCompra(c, compraId);
    if (!compra) return { erro: 'nao_encontrada' };
    if (compra.discord_id !== discordId) return { erro: 'nao_dono' };
    if (compra.status === 'AGUARDANDO') return { erro: 'ja_avisado', compra, rifa };
    if (compra.status !== 'PENDENTE') return { erro: 'nao_pendente', compra, rifa };
    if (rifa.status !== 'ABERTA' && rifa.status !== 'ENCERRADA') return { erro: 'rifa_fechada', compra, rifa };
    if (!(await reservaIntacta(c, compra))) {
      await expirarCompras(c, [compra.id]);
      return { erro: 'expirada', compra, rifa };
    }
    await c.query(
      "UPDATE rifa_bilhetes SET expira_em = NULL, atualizado_em = now() WHERE compra_id = $1 AND status = 'RESERVADO'",
      [compra.id]
    );
    const { rows: [atualizada] } = await c.query(
      "UPDATE rifa_compras SET status = 'AGUARDANDO', expira_em = NULL, avisado_em = now() WHERE id = $1 RETURNING *",
      [compra.id]
    );
    return { compra: atualizada, rifa };
  });
}

// Pagamento conferido: bilhetes viram PAGO, contadores sobem e a receita entra no
// livro-caixa na mesma transação (uma vez só por compra: origem RIFA + id da compra)
async function confirmarPagamento(compraId, porId) {
  return transacao(async c => {
    const { rifa, compra } = await travarCompra(c, compraId);
    if (!compra) return { erro: 'nao_encontrada' };
    if (compra.status === 'PAGA') return { erro: 'ja_paga', compra, rifa };
    if (compra.status !== 'PENDENTE' && compra.status !== 'AGUARDANDO') return { erro: 'nao_pendente', compra, rifa };
    if (rifa.status !== 'ABERTA' && rifa.status !== 'ENCERRADA') return { erro: 'rifa_fechada', compra, rifa };
    if (!(await reservaIntacta(c, compra))) {
      await expirarCompras(c, [compra.id]);
      return { erro: 'numeros_perdidos', compra, rifa };
    }

    const { rows: bilhetes } = await c.query(
      `UPDATE rifa_bilhetes SET status = 'PAGO', expira_em = NULL, atualizado_em = now()
        WHERE compra_id = $1 AND status = 'RESERVADO' RETURNING numero`,
      [compra.id]
    );
    const { rows: [paga] } = await c.query(
      `UPDATE rifa_compras SET status = 'PAGA', expira_em = NULL, decidido_por_id = $2, decidido_em = now()
        WHERE id = $1 RETURNING *`,
      [compra.id, porId]
    );
    // Só crescem, e dentro da transação do pagamento: nunca divergem dos bilhetes
    const { rows: [atualizada] } = await c.query(
      'UPDATE rifas SET vendidos = vendidos + $2, arrecadado = arrecadado + $3 WHERE id = $1 RETURNING *',
      [rifa.id, compra.quantidade, compra.total]
    );
    await financeiro.lancar({
      tipo: 'RECEITA',
      categoria: 'RIFA',
      valor: Number(compra.total),
      descricao: `Rifa #${rifa.id} — ${rifa.titulo}: compra #${compra.id} (${compra.quantidade} número${compra.quantidade !== 1 ? 's' : ''})`,
      data: chaveDia(new Date()),
      areaSlug: 'social',
      origem: 'RIFA',
      origemId: String(compra.id),
      criadoPorId: porId,
    }, c);
    return { compra: paga, rifaAntes: rifa, rifa: atualizada, numeros: bilhetes.map(b => b.numero).sort((a, b) => a - b) };
  });
}

// Desistência do comprador (só antes de avisar que pagou) ou recusa da equipe.
// Pago não cede: devolver dinheiro confirmado é cancelar a rifa.
async function cancelarCompra(compraId, porId, { peloComprador }) {
  return transacao(async c => {
    const { rifa, compra } = await travarCompra(c, compraId);
    if (!compra) return { erro: 'nao_encontrada' };
    if (peloComprador && compra.discord_id !== porId) return { erro: 'nao_dono' };
    if (compra.status === 'PAGA') return { erro: 'paga', compra, rifa };
    if (peloComprador && compra.status === 'AGUARDANDO') return { erro: 'aguardando', compra, rifa };
    if (compra.status !== 'PENDENTE' && compra.status !== 'AGUARDANDO') return { erro: 'nao_pendente', compra, rifa };

    const { rows: bilhetes } = await c.query(
      `UPDATE rifa_bilhetes SET status = 'CANCELADO', atualizado_em = now()
        WHERE compra_id = $1 AND status = 'RESERVADO' RETURNING numero`,
      [compra.id]
    );
    const { rows: [cancelada] } = await c.query(
      `UPDATE rifa_compras SET status = 'CANCELADA', expira_em = NULL, decidido_por_id = $2, decidido_em = now()
        WHERE id = $1 RETURNING *`,
      [compra.id, porId]
    );
    return { compra: cancelada, rifa, numeros: bilhetes.map(b => b.numero).sort((a, b) => a - b) };
  });
}

async function expirarCompra(compraId) {
  return transacao(async c => {
    const { compra } = await travarCompra(c, compraId);
    if (!compra) return null;
    const [expirada] = await expirarCompras(c, [compra.id]);
    return expirada ?? null;
  });
}

async function encerrarRifa(rifaId, { automatico = false } = {}) {
  if (!idValido(rifaId)) return null;
  const { rows } = await db.query(
    `UPDATE rifas SET status = 'ENCERRADA'
      WHERE id = $1 AND status = 'ABERTA' ${automatico ? 'AND encerra_em IS NOT NULL AND encerra_em <= now()' : ''}
      RETURNING *`,
    [rifaId]
  );
  return rows[0] ?? null;
}

async function marcarSorteio(rifaId, data) {
  if (!idValido(rifaId)) return { erro: 'nao_encontrada' };
  return transacao(async c => {
    const { rows: [rifa] } = await c.query('SELECT * FROM rifas WHERE id = $1 FOR UPDATE', [rifaId]);
    if (!rifa) return { erro: 'nao_encontrada' };
    if (rifa.status !== 'ABERTA' && rifa.status !== 'ENCERRADA') return { erro: 'fechada', rifa };
    const limiar = R.progressoLimiar({ totalNumeros: rifa.total_numeros, vendidos: rifa.vendidos, pct: rifa.limiar_sorteio_pct });
    if (!limiar.atingido) return { erro: 'limiar', faltam: limiar.faltam, pct: limiar.pct, rifa };
    const { rows: [atualizada] } = await c.query('UPDATE rifas SET sorteio_em = $2 WHERE id = $1 RETURNING *', [rifa.id, data]);
    return { rifa: atualizada };
  });
}

// Congela a rifa: grava o hash da lista de pagos, o número e o vencedor numa só transação
async function sortear(rifaId, { numeroManual = null, evidencia = null, evidenciaRef = null, porId }) {
  if (!idValido(rifaId)) return { erro: 'nao_encontrada' };
  return transacao(async c => {
    const { rows: [rifa] } = await c.query('SELECT * FROM rifas WHERE id = $1 FOR UPDATE', [rifaId]);
    if (!rifa) return { erro: 'nao_encontrada' };
    const { rows: [{ pendentes }] } = await c.query(
      `SELECT COUNT(*)::int AS pendentes FROM rifa_compras c WHERE c.rifa_id = $1 AND ${COMPRA_PENDENTE}`, [rifa.id]);
    const { rows: pagos } = await c.query(
      "SELECT numero, discord_id FROM rifa_bilhetes WHERE rifa_id = $1 AND status = 'PAGO' ORDER BY numero", [rifa.id]);

    const bloqueios = R.bloqueiosParaSortear({
      status: rifa.status, metodo: rifa.metodo_sorteio, compromissoHash: rifa.compromisso_hash, vendidos: pagos.length, pendentes,
    });
    if (rifa.metodo_sorteio === 'MANUAL') {
      if (!Number.isInteger(numeroManual) || numeroManual < 1 || numeroManual > rifa.total_numeros) {
        bloqueios.push(`Informe o número sorteado ao vivo (1 a ${rifa.total_numeros}).`);
      }
      if (!evidencia && !evidenciaRef) bloqueios.push('Anexe a evidência do sorteio (foto ou link da live).');
    }
    if (bloqueios.length) return { bloqueios, rifa };

    const numeros = pagos.map(p => p.numero);
    let numeroSorteado;
    let numeroVencedor;
    if (rifa.metodo_sorteio === 'SISTEMA') {
      numeroSorteado = R.sorteioSistema({ semente: rifa.semente, rifaId: rifa.id, pagos: numeros }).numero;
      numeroVencedor = numeroSorteado;
    } else {
      numeroSorteado = numeroManual;
      numeroVencedor = R.resolverVencedorManual(numeroManual, numeros, rifa.total_numeros, rifa.regra_nao_vendido);
      if (numeroVencedor == null) return { erro: 'repetir', numeroSorteado, rifa };
    }
    const vencedorId = pagos.find(p => p.numero === numeroVencedor).discord_id;

    const { rows: [sorteada] } = await c.query(
      `UPDATE rifas SET status = 'SORTEADA', numero_sorteado = $2, numero_vencedor = $3, vencedor_id = $4,
         hash_lista_final = $5, evidencia = $6, evidencia_ref = $7, sorteada_em = now(), sorteada_por_id = $8
        WHERE id = $1 RETURNING *`,
      [rifa.id, numeroSorteado, numeroVencedor, vencedorId, R.hashListaPagos(numeros), evidencia, evidenciaRef, porId]
    );
    return { rifa: sorteada, pagos: numeros };
  });
}

// Cancelar não apaga nada: compras pendentes caem, pagos continuam registrados e o
// dinheiro a devolver no jogo entra no livro-caixa como despesa, uma vez só por rifa
async function cancelarRifa(rifaId, motivo, porId) {
  if (!idValido(rifaId)) return { erro: 'nao_encontrada' };
  return transacao(async c => {
    const { rows: [rifa] } = await c.query('SELECT * FROM rifas WHERE id = $1 FOR UPDATE', [rifaId]);
    if (!rifa) return { erro: 'nao_encontrada' };
    if (!R.podeTransicionar(rifa.status, 'CANCELADA')) return { erro: 'fechada', rifa };

    const { rows: pendentes } = await c.query(
      "SELECT * FROM rifa_compras WHERE rifa_id = $1 AND status IN ('PENDENTE', 'AGUARDANDO') FOR UPDATE", [rifa.id]);
    if (pendentes.length) {
      const ids = pendentes.map(p => p.id);
      await c.query(
        `UPDATE rifa_compras SET status = 'CANCELADA', expira_em = NULL, decidido_por_id = $2, decidido_em = now()
          WHERE id = ANY($1)`,
        [ids, porId]
      );
      await c.query(
        "UPDATE rifa_bilhetes SET status = 'CANCELADO', atualizado_em = now() WHERE compra_id = ANY($1) AND status = 'RESERVADO'",
        [ids]
      );
    }
    const { rows: pagantes } = await c.query(
      `SELECT discord_id, SUM(total)::float AS total FROM rifa_compras
        WHERE rifa_id = $1 AND status = 'PAGA' GROUP BY discord_id ORDER BY total DESC`,
      [rifa.id]
    );
    const { rows: [cancelada] } = await c.query(
      "UPDATE rifas SET status = 'CANCELADA', cancelada_motivo = $2 WHERE id = $1 RETURNING *", [rifa.id, motivo]);

    if (Number(rifa.arrecadado) > 0) {
      await financeiro.lancar({
        tipo: 'DESPESA',
        categoria: 'RIFA',
        valor: Number(rifa.arrecadado),
        descricao: `Rifa #${rifa.id} — ${rifa.titulo}: cancelada, devolução aos compradores`,
        data: chaveDia(new Date()),
        areaSlug: 'social',
        origem: 'RIFA_ESTORNO',
        origemId: String(rifa.id),
        criadoPorId: porId,
      }, c);
    }
    return { rifa: cancelada, pendentes, pagantes };
  });
}

module.exports = {
  criarRifa,
  buscarRifa,
  gravarMensagem,
  listarRifas,
  contarReservados,
  numerosOcupados,
  bilhetesDaPessoa,
  comprasAbertasDaPessoa,
  buscarCompra,
  numerosDaCompra,
  gravarMensagemEquipe,
  comprasPendentes,
  maioresCompradores,
  reservar,
  avisarPagamento,
  confirmarPagamento,
  cancelarCompra,
  expirarCompra,
  encerrarRifa,
  marcarSorteio,
  sortear,
  cancelarRifa,
};

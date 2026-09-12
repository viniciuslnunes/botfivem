const db = require('./db');

// Prazos que precisam sobreviver a reinício (vencimento de advertência, remoção
// de cargo temporário). A tarefa mora no banco; uma varredura periódica executa
// as vencidas. `setTimeout` perdia tudo a cada deploy.
const INTERVALO_MS = 15 * 1000;
const MAX_TENTATIVAS = 5;
// Tarefa presa em 'executando' (bot caiu no meio) volta para a fila depois disso
const TRAVA_EXPIRADA = "interval '10 minutes'";

const tipos = new Map();

function registrarTipo(tipo, handler) {
  tipos.set(tipo, handler);
}

async function agendar(tipo, executarEm, payload = {}) {
  const res = await db.query(
    'INSERT INTO tarefas_agendadas (tipo, executar_em, payload) VALUES ($1, $2, $3) RETURNING id',
    [tipo, executarEm, payload]
  );
  return res.rows[0].id;
}

async function reivindicarVencidas() {
  const res = await db.query(`
    UPDATE tarefas_agendadas
       SET status = 'executando', tentativas = tentativas + 1, atualizado_em = now()
     WHERE id IN (
       SELECT id FROM tarefas_agendadas
        WHERE executar_em <= now()
          AND (status = 'pendente' OR (status = 'executando' AND atualizado_em < now() - ${TRAVA_EXPIRADA}))
        ORDER BY executar_em
        LIMIT 20
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, tipo, payload, tentativas
  `);
  return res.rows;
}

async function executarTarefa(client, tarefa) {
  const handler = tipos.get(tarefa.tipo);
  try {
    if (!handler) throw new Error(`Tipo de tarefa sem handler: ${tarefa.tipo}`);
    await handler(client, tarefa.payload);
    await db.query("UPDATE tarefas_agendadas SET status = 'feita', atualizado_em = now() WHERE id = $1", [tarefa.id]);
  } catch (err) {
    console.error(`[agendador] Tarefa ${tarefa.id} (${tarefa.tipo}) falhou:`, err);
    const status = tarefa.tentativas >= MAX_TENTATIVAS ? 'erro' : 'pendente';
    await db.query(
      `UPDATE tarefas_agendadas
          SET status = $2, ultimo_erro = $3, executar_em = now() + interval '1 minute', atualizado_em = now()
        WHERE id = $1`,
      [tarefa.id, status, String(err?.message ?? err)]
    ).catch(() => {});
  }
}

let timer = null;

function iniciarAgendador(client) {
  if (timer) return;
  let rodando = false;
  const ciclo = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const tarefas = await reivindicarVencidas();
      for (const tarefa of tarefas) await executarTarefa(client, tarefa);
    } catch (err) {
      console.error('[agendador] Erro na varredura:', err);
    } finally {
      rodando = false;
    }
  };
  ciclo();
  timer = setInterval(ciclo, INTERVALO_MS);
}

module.exports = { agendar, registrarTipo, iniciarAgendador };

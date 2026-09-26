const db = require('./db');

// Debounce de alerta que sobrevive a reinício: guarda em `alertas_enviados` (tipo + chave)
// o instante do último aviso. Os Maps em memória que existiam antes zeravam a cada deploy
// e o mesmo aviso saía de novo.

// true se já avisou dentro da janela; senão registra agora e devolve false.
// Um único UPSERT decide (dois alertas simultâneos da mesma chave não passam juntos).
async function jaAlertadoRecentemente(tipo, chave, janelaMs) {
  try {
    const { rows } = await db.query(
      `INSERT INTO alertas_enviados (tipo, chave, enviado_em) VALUES ($1, $2, now())
       ON CONFLICT (tipo, chave) DO UPDATE
          SET enviado_em = now()
        WHERE alertas_enviados.enviado_em < now() - ($3 || ' milliseconds')::interval
       RETURNING 1`,
      [tipo, String(chave), String(Math.round(janelaMs))]
    );
    return rows.length === 0;
  } catch (err) {
    // Sem banco não dá para lembrar; melhor alertar duas vezes do que calar
    console.error('[alerta] Debounce sem banco, alertando mesmo assim:', err.message);
    return false;
  }
}

module.exports = { jaAlertadoRecentemente };

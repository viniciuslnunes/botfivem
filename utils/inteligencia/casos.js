// Casos: cada alerta da inteligência vira um caso rastreável (aberto → resolvido, ignorado, expirado).
// Serve a três coisas: (1) a liderança age e fecha o caso pelo próprio alerta; (2) o que deixa de valer
// se resolve sozinho, sem ninguém limpar; (3) dá para medir a utilidade dos alertas (quantos foram
// ignorados, quanto demoram a resolver) e ajustar limites com dado, não com palpite.
// Regra de sempre: "resolvido" só depois da ação ter funcionado; permissão conferida no handler.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db');

const DIA_MS = 24 * 60 * 60 * 1000;
const EXPIRA_EM_DIAS = 30;

const ROTULOS = Object.freeze({
  reincidencia: 'Reincidência',
  blacklist_sem_bloqueio: 'Blacklist sem bloqueio',
  recrutou_sem_ficha: 'Recrutou sem ficha',
  ficha_parada: 'Ficha parada',
  sede_sem_vigia: 'Sede sem vigia',
  retirada_atipica: 'Retirada atípica',
  nome_de_restrito: 'Nome de restrito',
  emprestimo_atrasado: 'Empréstimo atrasado',
  saiu_segue_socio: 'Saiu e segue sócio',
  cargo_divergente: 'Cargo divergente',
  responsavel_em_risco: 'Responsável em risco',
  renovacao_em_risco: 'Renovação em risco',
  restricao_com_pendencia: 'Restrição com pagamento pendente',
  acompanhamento_setagem: 'Aprovado sem setagem',
  acompanhamento_aparecer: 'Aprovado que não apareceu',
  acompanhamento_semana: 'Novato sem jogar na semana',
});

// Ações que o próprio alerta oferece (além de RESOLVIDO/IGNORAR). Toda ação é da liderança.
const ACOES = Object.freeze({
  remover_socio: { rotulo: 'REMOVER CARGO DE SÓCIO', emoji: '🚪', estilo: ButtonStyle.Danger },
  ajustar_cargo: { rotulo: 'AJUSTAR CARGO DE RECRUTADOR', emoji: '🔀', estilo: ButtonStyle.Primary },
  bloquear: { rotulo: 'BLOQUEAR ID', emoji: '🚫', estilo: ButtonStyle.Danger },
});
const CODIGO_ACAO = Object.freeze({ remover_socio: 'rem', ajustar_cargo: 'adj', bloquear: 'blq' });

function botoes(casoId, acoes = []) {
  const linha = new ActionRowBuilder();
  for (const nome of acoes) {
    const a = ACOES[nome];
    linha.addComponents(new ButtonBuilder().setCustomId(`intel:${CODIGO_ACAO[nome]}:${casoId}`).setLabel(a.rotulo).setEmoji(a.emoji).setStyle(a.estilo));
  }
  linha.addComponents(
    new ButtonBuilder().setCustomId(`intel:res:${casoId}`).setLabel('RESOLVIDO').setEmoji('✔️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`intel:ign:${casoId}`).setLabel('IGNORAR').setEmoji('🙈').setStyle(ButtonStyle.Secondary)
  );
  return linha;
}

async function abrir({ tipo, chave, alvoDiscordId = null, dados = {} }) {
  const { rows } = await db.query(
    'INSERT INTO inteligencia_casos (tipo, chave, alvo_discord_id, dados) VALUES ($1, $2, $3, $4) RETURNING *',
    [tipo, String(chave), alvoDiscordId, JSON.stringify(dados)]
  );
  return rows[0];
}

async function buscar(id) {
  const { rows } = await db.query('SELECT * FROM inteligencia_casos WHERE id = $1', [id]);
  return rows[0] ?? null;
}

// Só sai de ABERTO uma vez: dois cliques (ou clique + resolução automática) não fecham duas vezes
async function fechar(id, status, { porId = null, resolucao = null } = {}) {
  const { rows } = await db.query(
    `UPDATE inteligencia_casos SET status = $2, resolvido_por_id = $3, resolucao = $4, fechado_em = now()
      WHERE id = $1 AND status = 'ABERTO' RETURNING *`,
    [id, status, porId, resolucao]
  );
  return rows[0] ?? null;
}

async function abertos(tipos = null) {
  const { rows } = await db.query(
    `SELECT * FROM inteligencia_casos WHERE status = 'ABERTO' AND ($1::text[] IS NULL OR tipo = ANY($1)) ORDER BY aberto_em`,
    [tipos]
  );
  return rows;
}

// Caso aberto há mais de 30 dias sem ninguém olhar deixa de ser "aberto": a fila precisa ser honesta
async function expirarAntigos() {
  const { rows } = await db.query(
    `UPDATE inteligencia_casos SET status = 'EXPIRADO', resolucao = 'sem ação em ${EXPIRA_EM_DIAS} dias', fechado_em = now()
      WHERE status = 'ABERTO' AND aberto_em < now() - interval '${EXPIRA_EM_DIAS} days' RETURNING *`
  );
  return rows;
}

// Por tipo: quantos abriram, como fecharam, quanto demoram e quantos seguem abertos (na janela)
async function metricas(dias = 90) {
  const { rows } = await db.query(
    `SELECT tipo, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'ABERTO')::int AS abertos,
            COUNT(*) FILTER (WHERE status = 'RESOLVIDO')::int AS resolvidos,
            COUNT(*) FILTER (WHERE status = 'RESOLVIDO' AND resolvido_por_id IS NULL)::int AS automaticos,
            COUNT(*) FILTER (WHERE status = 'IGNORADO')::int AS ignorados,
            COUNT(*) FILTER (WHERE status = 'EXPIRADO')::int AS expirados,
            COUNT(*) FILTER (WHERE status = 'ABERTO' AND aberto_em < now() - interval '7 days')::int AS velhos,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fechado_em - aberto_em)))
               FILTER (WHERE status = 'RESOLVIDO'))::float AS mediana_seg
       FROM inteligencia_casos WHERE aberto_em >= now() - ($1 || ' days')::interval
      GROUP BY tipo ORDER BY total DESC`,
    [String(dias)]
  );
  return rows;
}

async function registrarMensagem(id, canalId, messageId) {
  await db.query('UPDATE inteligencia_casos SET canal_id = $2, message_id = $3 WHERE id = $1', [id, canalId, messageId]);
}

// Envia o alerta já como caso (botões de resolver/ignorar e as ações do tipo). Se o banco falhar, o
// alerta sai igual, sem botões: avisar continua mais importante que rastrear.
async function enviar(canal, meta, payload) {
  let caso = null;
  try {
    caso = await abrir(meta);
  } catch (err) {
    console.error('[inteligencia] Erro ao abrir caso (o alerta segue sem botões):', err.message);
  }
  const mensagem = await canal.send(caso ? { ...payload, components: [...(payload.components ?? []), botoes(caso.id, meta.acoes)] } : payload);
  if (caso) await registrarMensagem(caso.id, canal.id, mensagem.id).catch(() => {});
  return mensagem;
}

// Tira os botões do alerta e diz como foi encerrado (o embed original fica)
async function encerrarMensagem(client, caso, texto) {
  if (!caso.canal_id || !caso.message_id) return false;
  try {
    const canal = await client.channels.fetch(caso.canal_id);
    const mensagem = await canal.messages.fetch(caso.message_id);
    const embeds = (mensagem.embeds ?? []).map((e, i) => {
      const json = e.toJSON?.() ?? e;
      return i === 0 ? { ...json, footer: { text: [json.footer?.text, texto].filter(Boolean).join(' · ') } } : json;
    });
    await mensagem.edit({ embeds, components: [] });
    return true;
  } catch {
    return false; // mensagem apagada ou sem acesso: o caso já foi fechado no banco
  }
}

module.exports = {
  ROTULOS, ACOES, DIA_MS, EXPIRA_EM_DIAS, botoes, abrir, buscar, fechar, abertos, expirarAntigos, metricas, registrarMensagem, enviar, encerrarMensagem,
};

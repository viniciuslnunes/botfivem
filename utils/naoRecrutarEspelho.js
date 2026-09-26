const db = require('./db');

// Espelho em tabela da lista "não recrutar". O canal de histórico continua sendo a fonte
// e a vitrine (botões, embeds); a tabela existe para o dado poder ser contado, filtrado e
// cruzado (reincidência, blacklist × não recrutar) sem reler o canal inteiro.

const campo = (embed, nome) => embed?.fields?.find(f => f.name === nome)?.value?.trim() ?? null;
const autorDe = valor => /<@!?(\d+)>/.exec(valor ?? '')?.[1] ?? null;

// Lê uma mensagem do histórico. Bloqueio desfeito renomeia o campo para "ID (DESBLOQUEADO)".
function lerMensagem(msg) {
  const embed = msg.embeds?.[0];
  if (!embed) return null;
  const ativoId = campo(embed, 'ID');
  const inativoId = campo(embed, 'ID (DESBLOQUEADO)');
  const idFivem = ativoId ?? inativoId;
  if (!idFivem) return null;
  return {
    idFivem,
    ativo: Boolean(ativoId),
    motivo: campo(embed, 'Motivo'),
    autorId: autorDe(campo(embed, 'Autor')),
    messageId: msg.id,
    bloqueadoEm: new Date(msg.createdTimestamp ?? Date.now()),
    removidoPorId: autorDe(campo(embed, 'Removido por')),
    motivoRemocao: campo(embed, 'Motivo da remoção'),
  };
}

// Mensagens do mais novo para o mais velho (como o fetch do Discord devolve): a mais nova de
// cada ID decide o estado atual; as mais velhas só contam como reincidência.
function estadoDosBloqueios(mensagens) {
  const porId = new Map();
  for (const msg of mensagens) {
    const lida = lerMensagem(msg);
    if (!lida) continue;
    const atual = porId.get(lida.idFivem);
    if (!atual) porId.set(lida.idFivem, { ...lida, vezes: 1 });
    else atual.vezes++;
  }
  return [...porId.values()];
}

async function gravarEspelho(estados) {
  for (const e of estados) {
    await db.query(
      `INSERT INTO nao_recrutar (id_fivem, ativo, motivo, autor_id, message_id, bloqueado_em, vezes, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id_fivem) DO UPDATE
          SET ativo = $2, motivo = $3, autor_id = $4, message_id = $5, bloqueado_em = $6, vezes = $7, atualizado_em = now()`,
      [e.idFivem, e.ativo, e.motivo, e.autorId, e.messageId, e.bloqueadoEm, e.vezes]
    );
  }
}

// Melhor esforço: o canal segue valendo mesmo se o banco falhar
async function espelhar(mensagens) {
  try {
    await gravarEspelho(estadoDosBloqueios(mensagens));
  } catch (err) {
    console.error('[nao-recrutar] Erro ao espelhar a lista no banco:', err.message);
  }
}

async function ativos() {
  const { rows } = await db.query('SELECT * FROM nao_recrutar WHERE ativo ORDER BY bloqueado_em DESC');
  return rows;
}

module.exports = { lerMensagem, estadoDosBloqueios, espelhar, ativos };

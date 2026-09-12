const db = require('./db');
const path = require('path');
const config = require('../config/index.js');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { registrarModulo } = require('./modulos');

const LOGO_PATH = path.join(__dirname, '../img/gavioesdafielfivem_logo.png');
const LOGO_FILE = { attachment: LOGO_PATH, name: 'gavioesdafielfivem_logo.png' };

const CAPA_PATH = path.join(__dirname, '../img/capa.png');
const CAPA_FILE = { attachment: CAPA_PATH, name: 'capa.png' };

const CANAL_MURAL = config.canais.mural;
const CONFIG_KEY = 'mural_associados_message_id';

// Descrição do embed tem limite de 4096 caracteres — com mais de ~100 sócios
// não cabe tudo num embed só, então a lista vira páginas (igual ao painel de
// presença: botões ANTERIOR/PRÓXIMA), em vez de truncar com "... e mais" e
// esconder o resto dos sócios.
const MAX_DESC = 3900;

async function getMuralMessageId() {
  const res = await db.query('SELECT value FROM bot_config WHERE key = $1', [CONFIG_KEY]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function setMuralMessageId(id) {
  await db.query(
    'INSERT INTO bot_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [CONFIG_KEY, id]
  );
}

async function buscarSocios() {
  const res = await db.query(
    // Carteirinha revogada (sócio desligado) não aparece no mural
    'SELECT numero_socio, nome FROM socios WHERE revogada_em IS NULL ORDER BY numero_socio ASC'
  );
  return res.rows;
}

function linhaDoSocio(s) {
  const num = String(s.numero_socio).padStart(2, '0');
  return `**SÓCIO Nº ${num}** — ${s.nome}`;
}

// Agrupa os sócios em páginas por tamanho de texto (não por quantidade fixa
// de linhas) — nomes bem compridos não estouram o limite do embed.
function montarPaginas(rows) {
  const paginas = [];
  let atual = [];
  let tamanho = 0;
  for (const s of rows) {
    const linha = linhaDoSocio(s).length + 1; // +1 do \n
    if (atual.length && tamanho + linha > MAX_DESC) {
      paginas.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(s);
    tamanho += linha;
  }
  paginas.push(atual); // sempre pelo menos uma página, mesmo vazia
  return paginas;
}

function construirEmbed(rowsPagina, atual, totalPaginas, totalSocios) {
  const descricao = rowsPagina.length
    ? rowsPagina.map(linhaDoSocio).join('\n')
    : '*Nenhum sócio registrado ainda.*';

  const rodape = totalPaginas > 1
    ? `Total: ${totalSocios} sócio${totalSocios !== 1 ? 's' : ''} · Página ${atual + 1}/${totalPaginas}`
    : `Total: ${totalSocios} sócio${totalSocios !== 1 ? 's' : ''}`;

  return {
    color: 0x000000,
    title: '📋 MURAL DE ASSOCIADOS — GAVIÕES DA FIEL FIVEM',
    description: descricao,
    thumbnail: { url: 'attachment://gavioesdafielfivem_logo.png' },
    image: { url: 'attachment://capa.png' },
    footer: { text: rodape },
    timestamp: new Date().toISOString()
  };
}

function linhaBotoesPaginacao(atual, totalPaginas) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mural:pag:${atual - 1}`)
      .setLabel(`◀ ANTERIOR (${atual}/${totalPaginas})`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atual === 0),
    new ButtonBuilder()
      .setCustomId(`mural:pag:${atual + 1}`)
      .setLabel(`PRÓXIMA ▶ (${atual + 2}/${totalPaginas})`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atual >= totalPaginas - 1)
  );
}

// Monta o embed + botões de uma página, sempre a partir dos sócios atuais no
// banco — sem guardar estado de consulta em memória (lista pequena, cabe
// reconsultar a cada clique, e assim nunca fica desatualizada nem expira).
async function renderizarPagina(pagina) {
  const rows = await buscarSocios();
  const paginas = montarPaginas(rows);
  const totalPaginas = paginas.length;
  const atual = Math.min(Math.max(0, pagina), totalPaginas - 1);
  const embed = construirEmbed(paginas[atual], atual, totalPaginas, rows.length);
  const components = totalPaginas > 1 ? [linhaBotoesPaginacao(atual, totalPaginas)] : [];
  return { embed, components };
}

async function atualizarMural(client) {
  const { embed, components } = await renderizarPagina(0);

  const canal = await client.channels.fetch(CANAL_MURAL);
  const messageId = await getMuralMessageId();

  if (messageId) {
    try {
      const msg = await canal.messages.fetch(messageId);
      await msg.edit({ embeds: [embed], components, files: [LOGO_FILE, CAPA_FILE], allowedMentions: { users: [] } });
      return;
    } catch {
      // Mensagem não existe mais — envia nova abaixo
    }
  }

  const nova = await canal.send({ embeds: [embed], components, files: [LOGO_FILE, CAPA_FILE], allowedMentions: { users: [] } });
  await setMuralMessageId(nova.id);
}

registrarModulo('mural', async interaction => {
  const [, acao, paginaStr] = interaction.customId.split(':');
  if (interaction.isButton() && acao === 'pag') {
    const { embed, components } = await renderizarPagina(Number(paginaStr) || 0);
    await interaction.update({ embeds: [embed], components });
  }
});

module.exports = { atualizarMural };

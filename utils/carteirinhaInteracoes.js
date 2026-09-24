// Carteirinha: botão de solicitar a carteirinha de sócio.
// Veio do antigo events/interactionCreate.js sem mudar a lógica; cada customId
// continua o mesmo, agora roteado por utils/modulos.js.
const config = require('../config/index.js');
const db = require('./db');
const { gerarCarteirinha } = require('./gerarCarteirinha');
const { atualizarMural } = require('./muralAssociados');
const { situacaoCarteirinha, textoSituacao } = require('./carteirinha/regras');
const { registrarModulo } = require('./modulos');

// solicitar_carteirinha
registrarModulo('solicitar_carteirinha', async interaction => {
  const { client } = interaction;
  await interaction.deferReply({ flags: 64 });

  if (!interaction.member.roles.cache.has(config.cargos.socio)) {
    return interaction.editReply({ content: '❌ A CARTEIRINHA É EXCLUSIVA PARA SÓCIOS APROVADOS.' });
  }

  const discordId = interaction.user.id;
  const membro = interaction.member;
  const nome = membro.nickname || interaction.user.displayName || interaction.user.username;

  let row;
  let isNovo = false;
  const existing = await db.query('SELECT * FROM socios WHERE discord_id = $1', [discordId]);

  if (existing.rows.length > 0) {
    row = existing.rows[0];
  } else {
    const maxResult = await db.query('SELECT COALESCE(MAX(numero_socio), 0) AS max FROM socios');
    const proximoNumero = maxResult.rows[0].max + 1;
    const validade = new Date();
    validade.setFullYear(validade.getFullYear() + 1);
    const insert = await db.query(
      'INSERT INTO socios (discord_id, numero_socio, nome, validade) VALUES ($1, $2, $3, $4) RETURNING *',
      [discordId, proximoNumero, nome, validade.toISOString().split('T')[0]]
    );
    row = insert.rows[0];
    isNovo = true;
  }

  const dataValidade = new Date(row.validade);
  const validadeFormatada = dataValidade.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });

  let buffer;
  try {
    buffer = await gerarCarteirinha({ nome, numeroSocio: row.numero_socio, validade: validadeFormatada, avatarUrl });
  } catch (err) {
    console.error('[solicitar_carteirinha] Erro ao gerar imagem:', err);
    return interaction.editReply({ content: '❌ ERRO AO GERAR A CARTEIRINHA. TENTE NOVAMENTE.' });
  }

  const situacao = situacaoCarteirinha(row.validade, new Date(), config.carteirinha.vencendoDias);
  await interaction.editReply({
    content: `🏆 SUA CARTEIRINHA DE SÓCIO Nº **${String(row.numero_socio).padStart(4, '0')}**!\n${textoSituacao(situacao)}${situacao.situacao === 'VENCIDA' ? ' — PROCURE A DIRETORIA PARA RENOVAR.' : ''}`,
    files: [{ attachment: buffer, name: 'carteirinha.png' }]
  });

  if (isNovo) {
    atualizarMural(client).catch(err => console.error('[solicitar_carteirinha] Erro ao atualizar mural:', err));
  }
  return;
});

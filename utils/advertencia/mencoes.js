// Menções das notificações de advertência (sócio e recrutador): liderança inteira
// (presidente, vice, velha guarda, diretoria) + o recrutador responsável.
// Vai no `content` da mensagem: menção dentro de embed não notifica ninguém.
const config = require('../../config/index.js');

// Recrutador que aprovou a ficha do sócio. null se não houver (ou se o módulo de
// recrutamento estiver desligado: sem a tabela, a menção da liderança segue).
async function recrutadorResponsavel(discordId) {
  try {
    return await require('../recrutamento/fichas').recrutadorQueAprovou(discordId);
  } catch (err) {
    console.error('[adv] Erro ao buscar recrutador responsável:', err.message);
    return null;
  }
}

// `recrutadorId`: quem responde pelo caso (já resolvido); repetidos e vazios saem.
function montarMencoes(recrutadorId) {
  const cargos = config.lideranca.map(id => `<@&${id}>`);
  return [...new Set([...cargos, recrutadorId ? `<@${recrutadorId}>` : null].filter(Boolean))].join(' ');
}

// Advertência de sócio: liderança + recrutador que trouxe o sócio.
async function mencoesDoSocio(discordId) {
  return montarMencoes(await recrutadorResponsavel(discordId));
}

// Advertência de recrutador: liderança + o próprio recrutador advertido.
const mencoesDoRecrutador = discordId => montarMencoes(discordId);

module.exports = { mencoesDoSocio, mencoesDoRecrutador, montarMencoes, recrutadorResponsavel };

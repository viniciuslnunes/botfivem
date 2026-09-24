// A fonte de logs do tenant ativo (tenant.jogo.fonte → fontes/<id>/). Todo o
// bot fala com a fonte por aqui; nenhum módulo importa fontes/<id> direto.
const config = require('../../config/index.js');
const { carregarFonte } = require('../../fontes');

module.exports = carregarFonte(config.jogo.fonte);

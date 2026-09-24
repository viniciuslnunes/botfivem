const config = require('../../config/index.js');
const { lerConfig } = require('../botConfig');

// Limites diários de retirada de droga e rótulos dos itens de farm. Vive num
// arquivo próprio (e não em painelFarmInteracoes) porque o alerta de retirada
// suspeita (alertas.js, módulo logsJogo) também precisa deles — assim o módulo
// painelFarm pode ficar desligado sem o alerta carregar o painel junto.

// Nome bonito (com acento) pros itens configurados em minúsculo sem acento
// (config.logsJogo.farm.itens usa lower(alvo_nome) na comparação SQL —
// ver repositorio.js#SQL_BAU_DO_TITULO). Item fora da lista cai no nome cru.
const ROTULOS_ITEM = {
  maconha: 'Maconha', cocaina: 'Cocaína', heroina: 'Heroína', extasy: 'Extasy',
  tecido: 'Tecido', madeira: 'Madeira', ferro: 'Ferro', polvora: 'Pólvora',
  bandagem: 'Bandagem', ibuprofeno: 'Ibuprofeno', adrenalina: 'Adrenalina', energetico: 'Energético',
};
function rotuloItem(item) {
  return ROTULOS_ITEM[item] ?? item;
}

const CONFIG_KEY_LIMITES = 'farm_limite_diario_retirada';

const CAMPOS_LIMITE = config.logsJogo.farm.itensDroga.map(item => ({
  chave: item,
  rotuloSelect: rotuloItem(item),
  rotuloCampo: `LIMITE DIÁRIO — ${rotuloItem(item).toUpperCase()}`,
  padrao: config.logsJogo.farm.limitePadraoDroga[item] ?? config.logsJogo.farm.limitePadraoDroga.default,
}));

async function lerLimitesFarm() {
  try {
    const bruto = await lerConfig(CONFIG_KEY_LIMITES);
    return bruto ? JSON.parse(bruto) : {};
  } catch {
    return {};
  }
}

// Limite efetivo de cada droga: o que a liderança editou (bot_config)
// sobrepõe o padrão de config/index.js — chamado tanto pelo card fixo
// (mostrar o limite de hoje) quanto pelo alerta de retirada (comparar o
// total do dia contra ele).
async function limitesEfetivosFarm() {
  const manual = await lerLimitesFarm();
  return Object.fromEntries(CAMPOS_LIMITE.map(c => [c.chave, manual[c.chave]?.valor ?? c.padrao]));
}

module.exports = { rotuloItem, lerLimitesFarm, limitesEfetivosFarm, CAMPOS_LIMITE, CONFIG_KEY_LIMITES };

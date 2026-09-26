// Ganchos do recrutamento (atalho sobre o barramento de eventos): outros módulos assinam sem o
// recrutamento conhecê-los. Módulo desligado nunca assina, então não deixa rastro.
const barramento = require('../barramento');

const aoFichaEnviada = fn => barramento.assinar('ficha.enviada', fn);
const emitirFichaEnviada = ficha => barramento.emitir('ficha.enviada', ficha);

module.exports = { aoFichaEnviada, emitirFichaEnviada };

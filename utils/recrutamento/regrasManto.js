// Regras da provagem de manto: mesmo texto no aviso ao candidato e na mensagem
// fixa do canal provar-manto. Só texto (sem cor/marca), então mora aqui.
const COMO_PROVAR = [
  'A foto precisa estar clara e visível.',
  'Selfie com o rosto aparecendo, o manto (tanto vestido quanto em cima do computador) e o monitor mostrando você e o recrutador na tela.',
];

const MOTIVOS_REPROVACAO = [
  'Utilização de IA.',
  'Foto escura demais.',
  'Não corresponder aos requisitos acima.',
];

const lista = itens => itens.map(item => `• ${item}`).join('\n');

function textoRegrasManto() {
  return `**COMO REALIZAR A PROVAGEM DE MANTO:**\n${lista(COMO_PROVAR)}\n\n**MOTIVOS DE REPROVAÇÃO:**\n${lista(MOTIVOS_REPROVACAO)}`;
}

module.exports = { textoRegrasManto };

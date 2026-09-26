// Regras da provagem de manto: mesmo texto no aviso ao candidato e na mensagem
// fixa do canal provar-manto. Só texto (sem cor/marca), então mora aqui.
const COMO_PROVAR = [
  'A foto precisa estar clara e visível.',
  'Selfie com o rosto aparecendo, o manto (tanto vestido quanto em cima do computador) e o monitor mostrando você e o recrutador na tela.',
];

// Fonte única dos motivos: o texto para o candidato (`texto`) e o select da
// avaliação (`label`, mesmo id vira o canal do caso) leem daqui.
const MOTIVOS_REPROVACAO = [
  { id: 'ia', label: 'Utilização de IA', texto: 'Utilização de IA.' },
  { id: 'foto_escura', label: 'Foto escura demais', texto: 'Foto escura demais.' },
  { id: 'sem_rosto', label: 'Sem o rosto na foto', texto: 'Rosto do candidato não aparece na foto.' },
  { id: 'sem_manto', label: 'Sem o manto na foto', texto: 'Manto não aparece na foto (nem vestido, nem sobre o computador).' },
  { id: 'sem_jogo_na_tela', label: 'Sem player e recrutador na tela', texto: 'Monitor não mostra o jogo com o player e o recrutador na tela.' },
  { id: 'fora_requisitos', label: 'Não corresponde aos requisitos', texto: 'Não corresponder aos requisitos acima.' },
];

const lista = itens => itens.map(item => `• ${item}`).join('\n');

function textoRegrasManto() {
  return `**COMO REALIZAR A PROVAGEM DE MANTO:**\n${lista(COMO_PROVAR)}\n\n**MOTIVOS DE REPROVAÇÃO:**\n${lista(MOTIVOS_REPROVACAO.map(m => m.texto))}`;
}

module.exports = { textoRegrasManto, MOTIVOS_REPROVACAO };

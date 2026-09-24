// Tema de EXEMPLO: torcida de mancha verde, rival roxa. Prova que o mesmo
// código serve a uma torcida com paleta oposta à dos Gaviões (que proíbe verde).
module.exports = {
  cor: {
    primaria: 0x0B6623, // verde escuro
    perigo: 0xCC0000,
    aviso: 0xFFCC00,
    destaque: 0xFFFFFF,
    neutro: 0x808080,
  },
  emoji: { ok: '✅', ativo: '🟢', inativo: '⚪', perigo: '🔴', marca: '🌿' },
  marca: {
    nome: 'MANCHA VERDE EXEMPLO FIVEM',
    nomeSegmentado: 'MANCHA VERDE EXEMPLO - FIVEM',
    nomeCurto: 'MANCHA VERDE EXEMPLO',
    nomeNormal: 'Mancha Verde Exemplo',
    nomeNormalFivem: 'Mancha Verde Exemplo FiveM',
    nomeTorcida: 'MANCHA VERDE EXEMPLO TORCIDA',
    de: 'da',
    sigla: 'MVE',
    nickPrefixo: 'S MVE | ',
    logo: 'logo.png',
    capa: 'capa.png',
    faixa: 'faixa.png',
    textos: { parceiros: 'Conheça os parceiros da torcida exemplo.' },
    carteirinha: {
      subtitulo: 'TORCIDA FICTÍCIA PARA TESTES',
      fundacao: 'Fundada em 01/01/2000',
      assinatura: { nome: 'Fulano Exemplo', cargo: 'Presidente' },
    },
  },
  imagem: {
    fundo: '#06280F', grade: '#0F4A1E', gradeForte: '#146B2B', texto: '#FFFFFF', textoFraco: '#A5D6A7',
    barra: '#4CAF50', barraZero: '#1B5E20', media: '#81C784', destaque: '#FFFFFF', disputa: '#C8E6C9',
  },
  cartao: {
    fundo: '#FFFFFF', tinta: '#0B6623', tintaSuave: '#1B5E20', sobreTinta: '#FFFFFF',
    borda: '#A5D6A7', placeholderFundo: '#E8F5E9', placeholderTexto: '#81C784',
  },
  transcricao: { destaque: '#0B6623' },
  proibido: { matizes: ['roxo'] },
};

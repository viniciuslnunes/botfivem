// Tema Torcida Instalacao: cores, emojis e marca. Sobrescreve tema/base.js — só o que for
// diferente precisa estar aqui. Contrato: docs/contratos/tema.md
module.exports = {
  // Cores de embed (0xRRGGBB). Troque pela paleta da torcida.
  // cor: { primaria: 0x000000, perigo: 0xFF0000, aviso: 0xFFCC00, destaque: 0xFFFFFF, neutro: 0x808080 },

  marca: {
    nome: 'TORCIDA INSTALACAO FIVEM', // "BAÚ DA TORCIDA — TORCIDA INSTALACAO FIVEM"
    nomeSegmentado: 'TORCIDA INSTALACAO - FIVEM',
    nomeCurto: 'TORCIDA INSTALACAO',
    nomeNormal: 'Torcida Instalacao',
    nomeNormalFivem: 'Torcida Instalacao FiveM',
    nomeTorcida: 'TORCIDA INSTALACAO TORCIDA',
    de: 'da', // preposição+artigo do nome: "dos Gaviões", "da Mancha", "do Bando"
    sigla: 'TI',
    nickPrefixo: 'S TI | ', // apelido do sócio: "S TI | Nome - 1234"
    logo: 'logo.png',
    capa: 'capa.png',
    faixa: 'faixa.png',
    textos: { parceiros: 'Conheça os parceiros da Torcida Instalacao. Clique nos botões abaixo!' },
    carteirinha: {
      subtitulo: 'SUBTÍTULO DA CARTEIRINHA',
      fundacao: 'Fundada em DD/MM/AAAA',
      assinatura: { nome: 'Nome do Presidente', cargo: 'Presidente' },
    },
  },

  // Matizes que a torcida NÃO usa (o bot recusa subir se algum token cair neles).
  // Ex.: { matizes: ['verde'] } para uma torcida que não usa verde nunca.
  proibido: { matizes: [] },
};

// Tema do tenant Gaviões da Fiel FiveM. Sobrescreve tema/base.js.
//
// REGRA DA TORCIDA: nada verde, em lugar nenhum (embed, gráfico, emoji de
// status). Sucesso não é verde: usa ✔️ e o texto já diz que deu certo. O
// `proibido` abaixo é verificado ao subir o bot e em test/tema.test.js.
module.exports = {
  cor: {
    primaria: 0x000000,
    perigo: 0xFF0000,
    aviso: 0xFFCC00,
    destaque: 0xFFFFFF,
    neutro: 0x808080,
  },

  emoji: {
    ok: '✔️',
    ativo: '🦅',
    inativo: '⚪',
    perigo: '🔴',
    aviso: '⚠️',
    pendente: '⏳',
    recusado: '❌',
    marca: '🦅',
  },

  marca: {
    nome: 'GAVIÕES DA FIEL FIVEM', // "BAÚ DA TORCIDA — GAVIÕES DA FIEL FIVEM"
    nomeSegmentado: 'GAVIÕES DA FIEL - FIVEM', // "TICKET - GAVIÕES DA FIEL - FIVEM"
    nomeCurto: 'GAVIÕES DA FIEL', // "NOSSA EQUIPE DA GAVIÕES DA FIEL"
    nomeNormal: 'Gaviões da Fiel',
    nomeNormalFivem: 'Gaviões da Fiel FiveM',
    nomeTorcida: 'GAVIÕES DA FIEL TORCIDA', // título da carteirinha
    // Preposição+artigo que concorda com o gênero do nome da torcida ("dos
    // Gaviões", "da Torcida X"): por isso vive no tenant. Dela saem
    // marca.dosNome ("DOS GAVIÕES DA FIEL - FIVEM") e marca.dosNormal.
    de: 'dos',
    sigla: 'GDF',
    nickPrefixo: 'S GDF | ', // apelido do sócio: "S GDF | Nome - 1234"
    logo: 'gavioesdafielfivem_logo.png',
    capa: 'capa.png',
    faixa: 'FAIXA_19.jpg',
    // Textos livres que falam da torcida (o tom é dela).
    textos: {
      parceiros: 'A FIEL é gigante, e só cresce porque temos ao nosso lado parceiros que apoiam a nossa paixão pelo Corinthians.\nClique nos botões abaixo e conheça cada um deles!',
    },
    // Sub-marca do elenco (cargo [R.S.J], comando /elenco).
    elenco: {
      titulo: '🦅・[R.S.J] RUA SÃO JORGE - ELENCO',
      nome: '[R.S.J] RUA SÃO JORGE',
      sigla: '[R.S.J]',
      logo: 'ruasaojorge.png',
    },
    carteirinha: {
      subtitulo: 'FORÇA INDEPENDENTE EM PROL DO GRANDE CORINTHIANS',
      fundacao: 'Fundado em 01/07/1969',
      assinatura: { nome: 'Mano Beiço', cargo: 'Presidente' },
    },
  },

  imagem: {
    fundo: '#000000',
    grade: '#262626',
    gradeForte: '#333333',
    texto: '#FFFFFF',
    textoFraco: '#999999',
    barra: '#8C8C8C',
    barraZero: '#3A3A3A',
    media: '#7A7A7A',
    destaque: '#FFFFFF',
    disputa: '#CFCFCF',
  },

  proibido: { matizes: ['verde'] },
};

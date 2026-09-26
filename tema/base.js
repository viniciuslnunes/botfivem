// Estrutura completa do tema com valores de partida neutros (preto, branco,
// vermelho, cinza). Um tenant sobrescreve só o que for diferente
// (tenants/<slug>/tema.js); tudo que o código de módulo usa passa por aqui —
// nunca escreva cor, emoji de estado ou marca direto num módulo (o guardião
// em test/conformidade.test.js falha se escrever). Contrato: docs/contratos/tema.md

module.exports = {
  // Cor de embed do Discord (inteiro 0xRRGGBB).
  cor: {
    primaria: 0x000000, // borda padrão de qualquer embed
    perigo: 0xFF0000, // alerta grave, cancelado, vencido
    aviso: 0xFFCC00, // atenção, pendente, vencendo
    destaque: 0xFFFFFF, // contraste com a primária (ex.: guardado × retirado)
    neutro: 0x808080, // encerrado, desbloqueado, sem estado
  },

  // Emojis de estado. Trocar aqui muda o servidor inteiro; o matiz proibido do
  // tenant também vale para eles (ver `proibido`).
  emoji: {
    ok: '✔️', // confirmação/sucesso (botão CONFIRMAR, "presença confirmada")
    ativo: '⚫', // vigente, vendendo, online, embarcado, guardado
    inativo: '⚪', // fora do estado ativo
    perigo: '🔴', // erro/recusa grave
    aviso: '⚠️',
    alerta: '🟡', // atenção suave: vencendo, encerrada, gravidade média
    pendente: '⏳',
    recusado: '❌',
    marca: '🦅', // assinatura da torcida em textos e títulos
  },

  // Imagens desenhadas com canvas / chart.js (gráficos, carteirinha). Strings
  // CSS '#rrggbb'.
  imagem: {
    fundo: '#000000',
    grade: '#262626',
    gradeForte: '#333333',
    texto: '#FFFFFF',
    textoFraco: '#999999',
    barra: '#8C8C8C',
    barraZero: '#3A3A3A',
    media: '#7A7A7A',
    destaque: '#FFFFFF', // maior pico, "agora", série principal
    disputa: '#CFCFCF', // série secundária tracejada
  },

  // Carteirinha de sócio (canvas).
  cartao: {
    fundo: '#FFFFFF',
    tinta: '#000000', // texto sobre o fundo claro e faixas escuras
    tintaSuave: '#1a1a1a', // rótulos dos dados
    sobreTinta: '#FFFFFF', // texto sobre a faixa escura
    borda: '#cccccc',
    placeholderFundo: '#f0f0f0',
    placeholderTexto: '#aaaaaa',
  },

  // HTML do transcript de ticket: réplica do visual escuro do Discord (não é
  // a identidade da torcida; só o `destaque` costuma mudar por tenant).
  transcricao: {
    fundoPagina: '#1e1f22',
    fundoCabecalho: '#111214',
    fundoHover: '#25262a',
    painel: '#2b2d31',
    linha: '#3a3b40',
    texto: '#dcddde',
    textoFraco: '#72767d',
    rodape: '#444444',
    destaque: '#cc0000',
    selo: '#5865f2', // selo BOT (identidade do Discord)
    link: '#00aff4',
    textoForte: '#ffffff', // título, autor, texto do selo
    metaFraco: '#888888', // metadados do cabeçalho
    metaForte: '#cccccc', // rótulos dos metadados
  },

  // Matizes que a torcida NÃO usa. Ex.: { matizes: ['verde'] } faz o tema
  // falhar ao carregar se qualquer cor/emoji cair em verde. Vazio = livre.
  proibido: { matizes: [] },
};

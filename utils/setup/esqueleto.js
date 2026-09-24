// Gera os arquivos de um tenant novo em modo instalação (tenant.js e tema.js).
// Puro (só devolve texto): quem grava em disco é tools/novo-tenant.js.
const { SNOWFLAKE } = require('../../config/schema');

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

function paraTitulo(nome) {
  return nome.toLowerCase().replace(/(^|\s)(\S)/g, (m, sp, c) => sp + c.toUpperCase());
}

function siglaDe(nome) {
  const iniciais = nome.split(/\s+/).filter(p => p.length > 2 || /^[A-Za-z]/.test(p)).map(p => p[0].toUpperCase()).join('');
  return (iniciais || nome.slice(0, 3).toUpperCase()).slice(0, 4);
}

function validarEntrada({ slug, guildId, nome, fonte }) {
  const erros = [];
  if (!SLUG.test(slug ?? '')) erros.push('slug inválido: use minúsculas, números, "-" e "_" (ex.: mancha-verde)');
  if (String(slug).startsWith('_')) erros.push('slug não pode começar com "_" (reservado a exemplos)');
  if (!SNOWFLAKE.test(guildId ?? '')) erros.push('guild inválido: cole o ID do servidor (17–20 dígitos)');
  if (!nome || nome.trim().length < 3) erros.push('nome da torcida obrigatório (ex.: "Mancha Verde")');
  if (!fonte) erros.push('fonte de logs obrigatória (nome da pasta em fontes/)');
  return erros;
}

function gerarTenantEsqueleto({ slug, guildId, nome, fonte }) {
  const erros = validarEntrada({ slug, guildId, nome, fonte });
  if (erros.length) throw new Error(erros.join('\n'));

  const NOME = nome.trim().toUpperCase();
  const Normal = paraTitulo(nome.trim());
  const sigla = siglaDe(nome.trim());

  const tenantJs = `// Tenant ${Normal} — MODO INSTALAÇÃO.
//
// Neste modo o bot só carrega o /setup. Passos:
//   1. Suba o bot com TENANT=${slug} e rode /setup diagnostico no servidor.
//   2. Rode /setup mapear (acha o que já existe pelo nome) e /setup criar (cria o que falta).
//   3. Cole os trechos gerados aqui (cargos, canais, categorias), preencha logsJogo e o resto
//      (use tenants/gavioes/tenant.js como referência completa) e REMOVA a linha \`instalacao: true\`.
//   4. Reinicie: o bot valida tudo na subida e lista o que ainda faltar.
module.exports = {
  slug: '${slug}',
  instalacao: true,
  guildId: '${guildId}',

  // Servidor de jogo que publica os logs (adapter em fontes/${fonte}/)
  jogo: { fonte: '${fonte}' },

  // Quais módulos sobem. Sem entrada vale o padrão de cada módulo (modulos/*.js).
  // modulos: { rifas: false, loja: false },
};
`;

  const temaJs = `// Tema ${Normal}: cores, emojis e marca. Sobrescreve tema/base.js — só o que for
// diferente precisa estar aqui. Contrato: docs/contratos/tema.md
module.exports = {
  // Cores de embed (0xRRGGBB). Troque pela paleta da torcida.
  // cor: { primaria: 0x000000, perigo: 0xFF0000, aviso: 0xFFCC00, destaque: 0xFFFFFF, neutro: 0x808080 },

  marca: {
    nome: '${NOME} FIVEM', // "BAÚ DA TORCIDA — ${NOME} FIVEM"
    nomeSegmentado: '${NOME} - FIVEM',
    nomeCurto: '${NOME}',
    nomeNormal: '${Normal}',
    nomeNormalFivem: '${Normal} FiveM',
    nomeTorcida: '${NOME} TORCIDA',
    de: 'da', // preposição+artigo do nome: "dos Corsários", "da Mancha", "do Bando"
    sigla: '${sigla}',
    nickPrefixo: 'S ${sigla} | ', // apelido do sócio: "S ${sigla} | Nome - 1234"
    logo: 'logo.png',
    capa: 'capa.png',
    faixa: 'faixa.png',
    textos: { parceiros: 'Conheça os parceiros da ${Normal}. Clique nos botões abaixo!' },
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
`;
  return { 'tenant.js': tenantJs, 'tema.js': temaJs };
}

module.exports = { gerarTenantEsqueleto, validarEntrada, siglaDe, paraTitulo };

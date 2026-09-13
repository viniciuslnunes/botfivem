// Detecção de conta comprometida: a mesma mensagem espalhada por vários canais
// em poucos segundos. Membro de verdade praticamente nunca faz isso; conta
// hackeada faz sempre (golpe de Nitro/Steam, convite de outro servidor, imagem).
// Funções puras — o histórico por usuário fica em servico.js.

// Abaixo disso o texto sozinho não identifica spam: "bom dia" em três canais é
// gente, não golpe. Com link, anexo ou figurinha o tamanho não importa.
const MIN_CARACTERES_TEXTO = 10;

function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '') // invisíveis que o spammer mete pra fugir de filtro
    .replace(/<@[!&]?\d+>/g, '')                 // menção muda de canal pra canal
    .replace(/@(everyone|here)/gi, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Identidade da mensagem para comparar entre canais. null = não dá pra dizer
// que duas mensagens são "a mesma" (texto curto sem link/anexo).
function assinaturaMensagem({ conteudo, anexos = [], figurinhas = [] }) {
  const texto = normalizarTexto(conteudo);
  const temLink = /https?:\/\/|discord\.gg\//.test(texto);
  const temMidia = anexos.length > 0 || figurinhas.length > 0;
  const partes = [];
  if (texto && (texto.length >= MIN_CARACTERES_TEXTO || temLink || temMidia)) partes.push(`t:${texto}`);
  // Nome + tamanho: a URL do anexo muda a cada envio, o arquivo não
  if (anexos.length) partes.push(`a:${anexos.map(a => `${a.nome}:${a.tamanho}`).sort().join(',')}`);
  if (figurinhas.length) partes.push(`f:${[...figurinhas].sort().join(',')}`);
  return partes.length ? partes.join('|') : null;
}

// Golpe de conta hackeada vem com link ou arquivo. Conversa rápida em vários
// canais (recrutador atendendo tickets) raramente tem — só isso entra na regra
// de "vários canais com texto diferente".
function temLinkOuAnexo({ conteudo, anexos = [] }) {
  return anexos.length > 0 || /https?:\/\/|discord\.gg\//.test(normalizarTexto(conteudo));
}

// historico: [{ canalId, assinatura, linkOuAnexo, em (ms) }] do usuário.
function avaliarHistorico(historico, agora, { janelaSegundos, canaisMesmaMensagem, canaisQualquerMensagem }) {
  const recentes = historico.filter(h => agora - h.em <= janelaSegundos * 1000);

  const canaisPorAssinatura = new Map();
  for (const h of recentes) {
    if (!h.assinatura) continue;
    if (!canaisPorAssinatura.has(h.assinatura)) canaisPorAssinatura.set(h.assinatura, new Set());
    canaisPorAssinatura.get(h.assinatura).add(h.canalId);
  }
  for (const canais of canaisPorAssinatura.values()) {
    if (canais.size >= canaisMesmaMensagem) return { spam: true, motivo: 'mesma_mensagem', canais: canais.size };
  }

  // Spammer que embaralha o texto a cada envio: pega pelo número de canais
  const canais = new Set(recentes.filter(h => h.linkOuAnexo).map(h => h.canalId));
  if (canaisQualquerMensagem && canais.size >= canaisQualquerMensagem) {
    return { spam: true, motivo: 'varios_canais', canais: canais.size };
  }
  return { spam: false };
}

// Alta certeza: os MESMOS arquivos replicados em vários canais. É o padrão das
// contas hackeadas daqui (4 imagens em 5–6 canais) e não acontece por acaso —
// vários arquivos com o mesmo tamanho exato em bytes, em N canais, em segundos.
// O nome não entra (dá pra trocar a cada envio). Vale tanto pras 4 imagens numa
// mensagem só quanto pra uma imagem por mensagem.
// historico: [{ canalId, anexos: [{ tamanho }], em (ms) }]
function avaliarAltaCerteza(historico, agora, { janelaSegundos, arquivosMinimos, canaisMinimos }) {
  const canaisPorArquivo = new Map();
  for (const h of historico) {
    if (agora - h.em > janelaSegundos * 1000) continue;
    for (const { tamanho } of h.anexos || []) {
      if (!tamanho) continue;
      if (!canaisPorArquivo.has(tamanho)) canaisPorArquivo.set(tamanho, new Set());
      canaisPorArquivo.get(tamanho).add(h.canalId);
    }
  }
  const replicados = [...canaisPorArquivo.values()].filter(canais => canais.size >= canaisMinimos);
  if (replicados.length < arquivosMinimos) return { spam: false };
  const canais = new Set(replicados.flatMap(c => [...c]));
  return { spam: true, motivo: 'anexos_replicados', arquivos: replicados.length, canais: canais.size };
}

module.exports = { normalizarTexto, assinaturaMensagem, temLinkOuAnexo, avaliarHistorico, avaliarAltaCerteza, MIN_CARACTERES_TEXTO };

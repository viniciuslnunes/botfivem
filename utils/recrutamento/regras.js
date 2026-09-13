// Regras puras do recrutamento (sem Discord nem banco).

// Vocabulário único da reprovação: modal, embed da ficha, DM e banco leem daqui
const CATEGORIAS_REPROVACAO = [
  { id: 'dados_incorretos', label: 'Dados incorretos ou incompletos' },
  { id: 'id_fivem', label: 'ID FiveM inválido ou não confere' },
  { id: 'manto', label: 'Não enviou o manto' },
  { id: 'conduta', label: 'Conduta ou histórico no servidor' },
  { id: 'idade', label: 'Não atende à idade mínima' },
  { id: 'outro', label: 'Outro motivo' },
];

const JUSTIFICATIVA_MIN = 15;
const JUSTIFICATIVA_MAX = 1000;

// Ficha pendente esquecida (mensagem apagada, ninguém decidiu) não prende o candidato para sempre
const PENDENTE_BLOQUEIA_MS = 7 * 24 * 60 * 60 * 1000;

function rotuloCategoria(id) {
  return CATEGORIAS_REPROVACAO.find(c => c.id === id)?.label ?? 'Outro motivo';
}

function validarLaudo({ categoria, justificativa }) {
  if (!CATEGORIAS_REPROVACAO.some(c => c.id === categoria)) {
    return { ok: false, mensagem: '❌ SELECIONE A CATEGORIA DA REPROVAÇÃO.' };
  }
  const texto = String(justificativa ?? '').trim();
  if (texto.length < JUSTIFICATIVA_MIN || texto.length > JUSTIFICATIVA_MAX) {
    return { ok: false, mensagem: `❌ A JUSTIFICATIVA PRECISA TER ENTRE ${JUSTIFICATIVA_MIN} E ${JUSTIFICATIVA_MAX} CARACTERES — ELA VAI PARA O CANDIDATO.` };
  }
  return { ok: true, categoria, justificativa: texto };
}

// situacao: { pendenteDesde: Date|null, reprovacaoDefinitiva: boolean } | null (sem ficha ou banco indisponível)
function avaliarNovaSolicitacao(situacao, agora = Date.now()) {
  if (!situacao) return { ok: true };
  if (situacao.reprovacaoDefinitiva) {
    return { ok: false, mensagem: '❌ SUA SOLICITAÇÃO ANTERIOR FOI REPROVADA DE FORMA DEFINITIVA. SE DISCORDAR, ABRA UM TICKET.' };
  }
  if (situacao.pendenteDesde && agora - new Date(situacao.pendenteDesde).getTime() < PENDENTE_BLOQUEIA_MS) {
    return { ok: false, mensagem: '⏳ VOCÊ JÁ TEM UMA SOLICITAÇÃO EM ANÁLISE. AGUARDE A DECISÃO DOS RECRUTADORES.' };
  }
  return { ok: true };
}

const MOTIVO_LIBERACAO_MIN = 10;
const MOTIVO_LIBERACAO_MAX = 500;

// Desfazer uma reprovação definitiva deixa rastro: o motivo vai pro log de gestão
function validarMotivoLiberacao(motivo) {
  const texto = String(motivo ?? '').trim();
  if (texto.length < MOTIVO_LIBERACAO_MIN || texto.length > MOTIVO_LIBERACAO_MAX) {
    return { ok: false, mensagem: `❌ O MOTIVO PRECISA TER ENTRE ${MOTIVO_LIBERACAO_MIN} E ${MOTIVO_LIBERACAO_MAX} CARACTERES.` };
  }
  return { ok: true, motivo: texto };
}

const semAcento = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

// Busca na lista de reprovados: só dígitos = ID FiveM exato; senão, pedaço do nome
function filtrarReprovados(reprovados, termo) {
  const alvo = semAcento(termo);
  if (!alvo) return [];
  if (/^\d+$/.test(alvo)) return reprovados.filter(r => String(r.id_fivem ?? '').trim() === alvo);
  return reprovados.filter(r => semAcento(r.nome).includes(alvo));
}

// Opção do select (label e description têm no máximo 100 caracteres no Discord)
function opcaoReprovado(r) {
  const corta = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  return {
    label: corta(`${r.nome || 'Sem nome'} · ID ${r.id_fivem || '?'}`, 100),
    description: corta(rotuloCategoria(r.reprovado_categoria), 100),
    value: r.message_id,
  };
}

// Lê a ficha a partir dos campos do embed de análise (fichas anteriores ao banco)
function lerFichaDoEmbed(campos = []) {
  const valor = nome => campos.find(c => c.name === nome)?.value ?? null;
  const idDiscord = valor('ID | DISCORD');
  const idade = parseInt(valor('IDADE'), 10);
  return {
    discordId: idDiscord ? idDiscord.split(' ')[0] : null,
    nome: valor('NOME'),
    idade: Number.isFinite(idade) ? idade : null,
    idFivem: valor('ID FIVEM'),
    telefone: valor('TELEFONE'),
    recrutador: valor('RECRUTADOR'),
    areaNome: valor('ÁREA PRETENDIDA'),
  };
}

function slugDaAreaNoEmbed(campos, areas) {
  const nome = lerFichaDoEmbed(campos).areaNome;
  if (!nome) return null;
  return areas.find(a => a.nome.toLowerCase() === nome.trim().toLowerCase())?.slug ?? null;
}

module.exports = {
  CATEGORIAS_REPROVACAO,
  JUSTIFICATIVA_MIN,
  JUSTIFICATIVA_MAX,
  rotuloCategoria,
  validarLaudo,
  avaliarNovaSolicitacao,
  MOTIVO_LIBERACAO_MIN,
  MOTIVO_LIBERACAO_MAX,
  validarMotivoLiberacao,
  filtrarReprovados,
  opcaoReprovado,
  lerFichaDoEmbed,
  slugDaAreaNoEmbed,
};

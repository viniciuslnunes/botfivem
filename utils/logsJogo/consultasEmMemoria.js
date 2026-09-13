// Armazém de consultas ephemeral em memória — o mesmo mecanismo que
// presencaInteracoes.js já usa pro painel de jogadores (lista grande fica em
// memória, identificada por um ID curto no customId dos botões; endereçar por
// posição, não pelo dado inteiro, porque um customId do Discord tem limite de
// 100 caracteres). Fatorado aqui pra todo canal-painel interativo novo
// reaproveitar em vez de reimplementar Map + TTL + dono da consulta.
//
// Uma consulta expira sozinha (TTL) e só quem abriu pode navegar nela — as
// duas checagens que valem repetir em qualquer módulo que use isto.
const crypto = require('crypto');

const TTL_PADRAO_MS = 15 * 60 * 1000;
const POR_PAGINA_PADRAO = 25;

function criarArmazemConsultas({ ttlMs = TTL_PADRAO_MS, porPagina = POR_PAGINA_PADRAO } = {}) {
  const consultas = new Map();

  function limparExpiradas() {
    const agora = Date.now();
    for (const [id, consulta] of consultas) {
      if (agora - consulta.criadoEm > ttlMs) consultas.delete(id);
    }
  }

  // `dados` é o que o módulo quiser guardar (ex.: itens, período, filtro
  // atual) — este armazém só acrescenta userId/criadoEm e devolve o ID curto.
  function salvar(userId, dados) {
    limparExpiradas();
    const id = crypto.randomBytes(6).toString('hex');
    consultas.set(id, { ...dados, userId, criadoEm: Date.now() });
    return id;
  }

  // Devolve a consulta, ou um motivo (`expirada`/`nao_encontrada`) — quem
  // chama decide a mensagem exata de erro, mas nunca esquece de checar dono.
  function obter(id, userId) {
    const consulta = consultas.get(id);
    if (!consulta) return { erro: 'expirada' };
    if (Date.now() - consulta.criadoEm > ttlMs) {
      consultas.delete(id);
      return { erro: 'expirada' };
    }
    if (consulta.userId !== userId) return { erro: 'outro_usuario' };
    return { consulta };
  }

  function atualizar(id, patch) {
    const consulta = consultas.get(id);
    if (!consulta) return null;
    Object.assign(consulta, patch);
    return consulta;
  }

  function pagina(lista, indice) {
    const totalPaginas = Math.max(1, Math.ceil(lista.length / porPagina));
    const atual = Math.min(Math.max(0, indice), totalPaginas - 1);
    return { itens: lista.slice(atual * porPagina, (atual + 1) * porPagina), atual, totalPaginas };
  }

  return { salvar, obter, atualizar, pagina, porPagina };
}

// Mensagem padrão pros dois motivos de `obter` falhar — todo módulo que usa
// este armazém repete a mesma checagem, então o texto sai daqui uma vez só.
function mensagemErroConsulta(erro) {
  if (erro === 'outro_usuario') return '❌ ESSA CONSULTA NÃO É SUA.';
  return '⌛ ESTA CONSULTA EXPIROU. ABRA DE NOVO PELO PAINEL.';
}

module.exports = { criarArmazemConsultas, mensagemErroConsulta };

const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const A = require('./analises');
const { criarPainelCanal } = require('./painelCanal');
const { registrarConsulta, selectPeriodo } = require('./painelConsulta');
const { buscarBloqueio } = require('../naoRecrutar');

// Canal ⛔・banidos-e-impedidos: quem o JOGO está barrando agora — blacklist,
// suspensão e impedimento — reconstruído dos eventos de adicionar/remover.
//
// O cruzamento com o ❌・nao-recrutar é o ponto do canal, e vale SÓ pra
// blacklist: o jogo banir alguém não bloqueia o ID no Discord, e um banido que
// não está no não-recrutar pode pedir recrutamento e ser aprovado sem ninguém
// notar. Suspensão é temporária, e impedimento é ligado e desligado o tempo todo
// — inclusive entre membros da própria liderança, com segundos de diferença
// (visto nos logs em 2026-09-13) —, então tratar os dois como "não recrutar"
// encheria o canal de falso alarme.
const SLUG = 'banidos_impedidos';
const HISTORICO_MAX = 6000; // eventos lidos pra reconstruir o estado atual
const TOP = 10;
const EVENTOS_CONSULTA = 10;

const DESCRICOES = {
  blacklist: 'Banido da torcida no jogo. Só sai daqui com a retirada da blacklist no próprio jogo.',
  suspensao: 'Suspenso da torcida no jogo (temporário). Sai daqui quando o jogo registra a retirada.',
  impedimento: 'Impedido pelo sistema do jogo. É ligado e desligado com frequência: confira antes de agir.',
};

const ROTULOS_ACAO = {
  blacklist_adicionou: 'Blacklist aplicada',
  blacklist_removeu: 'Blacklist retirada',
  suspensao_adicionou: 'Suspensão aplicada',
  suspensao_removeu: 'Suspensão retirada',
  impedimento_adicionou: 'Impedimento aplicado',
  impedimento_removeu: 'Impedimento retirado',
};

// Só blacklist é consultada. Falha em ler o histórico do não-recrutar (canal
// fora do ar, permissão) não derruba o painel: a marca de cruzamento some e o
// cabeçalho avisa. Um erro só no log — o cache do não-recrutar faz a mesma falha
// se repetir pra cada ID.
async function marcarBloqueioNoDiscord(client, restricoes) {
  let avisou = false;
  const marcadas = [];
  for (const r of restricoes) {
    if (r.tipo !== 'blacklist') {
      marcadas.push({ ...r, bloqueadoNoDiscord: null });
      continue;
    }
    let bloqueado = null;
    try {
      bloqueado = Boolean(await buscarBloqueio(client, r.id));
    } catch (err) {
      if (!avisou) console.error('[banidos_impedidos] Erro ao consultar o não-recrutar:', err);
      avisou = true;
    }
    marcadas.push({ ...r, bloqueadoNoDiscord: bloqueado });
  }
  return marcadas;
}

function linhaRestricao(r) {
  const marca = r.bloqueadoNoDiscord === true ? ' · ✅ no não-recrutar'
    : r.bloqueadoNoDiscord === false ? ' · ⚠️ fora do não-recrutar'
      : '';
  return `• ${F.pessoa(r)} — ${F.haQuantoTempo(r.em)}`
    + (r.porNome ? ` · por ${F.nomeSeguro(r.porNome)}` : '')
    + marca;
}

function linhaTop(l, i) {
  return `${i + 1}. ${F.pessoa(l)} — ${E.formatarNumero(l.total)}`;
}

function cabecalhoCruzamento(blacklist, faltaBloquear) {
  const nota = '*Só blacklist entra no cruzamento: suspensão é temporária e impedimento é ligado e desligado o tempo todo.*';
  if (blacklist.some(r => r.bloqueadoNoDiscord === null)) {
    return `Não foi possível ler o ❌・nao-recrutar agora: o cruzamento volta no próximo ciclo.\n${nota}`;
  }
  if (!faltaBloquear.length) return `Todo ID com blacklist no jogo já está no não-recrutar do Discord. ✅\n${nota}`;
  return `**${faltaBloquear.length}** ${faltaBloquear.length === 1 ? 'ID com blacklist no jogo ainda não está' : 'IDs com blacklist no jogo ainda não estão'} `
    + `no ❌・nao-recrutar — do jeito que está, ${faltaBloquear.length === 1 ? 'pode' : 'podem'} pedir recrutamento no Discord e ser `
    + `${faltaBloquear.length === 1 ? 'aprovado' : 'aprovados'}.\n${nota}`;
}

async function montarBlocos(client) {
  const tudo = E.resolverPeriodo('tudo');
  const [eventos, topAplicou] = await Promise.all([
    repo.listarPorAcoes(A.ACOES_RESTRICAO, tudo, HISTORICO_MAX),
    repo.topAtoresPorAcoes(A.ACOES_RESTRICAO, E.resolverPeriodo('30d'), TOP),
  ]);

  const ativas = await marcarBloqueioNoDiscord(client, A.restricoesAtivas(eventos));
  const embeds = [];

  for (const [tipo, def] of Object.entries(A.TIPOS_RESTRICAO)) {
    const doTipo = ativas.filter(r => r.tipo === tipo);
    embeds.push(...F.embedsDeLista({
      titulo: `⛔ ${def.rotulo} (${doTipo.length})`,
      cabecalho: DESCRICOES[tipo],
      linhas: doTipo.map(linhaRestricao),
      vazio: 'Ninguém nesta lista.',
      origem: 'canal logs-registros',
    }));
  }

  const blacklist = ativas.filter(r => r.tipo === 'blacklist');
  const faltaBloquear = blacklist.filter(r => r.bloqueadoNoDiscord === false);
  embeds.push(...F.embedsDeLista({
    titulo: '🔗 BLACKLIST × ❌・NAO-RECRUTAR',
    cabecalho: cabecalhoCruzamento(blacklist, faltaBloquear),
    linhas: faltaBloquear.map(r => `⚠️ ${F.pessoa(r)} — blacklist ${F.haQuantoTempo(r.em)}`
      + (r.porNome ? ` · por ${F.nomeSeguro(r.porNome)}` : '')),
    vazio: 'Nada pendente.',
    origem: 'canal logs-registros + historico-nao-recrutar',
    fields: topAplicou.length
      ? [{ name: 'QUEM MAIS APLICOU RESTRIÇÃO (30 DIAS)', value: E.truncar(topAplicou.map(linhaTop).join('\n'), 1024) }]
      : [],
  }));

  return F.blocosDeEmbeds(embeds);
}

function montarAcao() {
  return {
    content: '👇 **VER AS RESTRIÇÕES APLICADAS NUM PERÍODO**',
    components: [selectPeriodo(SLUG, 'ESCOLHA UM PERÍODO')],
  };
}

let clientAtual = null;

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '⛔・banidos-e-impedidos',
  razao: 'Blacklist, suspensão e impedimento do jogo a partir dos logs',
  intervaloMin: 60,
  montarBlocos: () => montarBlocos(clientAtual),
  montarAcao,
});

// `montarBlocos` precisa do client (lê o histórico do não-recrutar) e o esqueleto
// do painel não o passa: guardar o client do ciclo aqui mantém o esqueleto igual
// pra todos os painéis em vez de mudar a assinatura por causa de um só.
function iniciar(client) {
  clientAtual = client;
  painel.iniciar(client);
}

function atualizar(client) {
  clientAtual = client;
  return painel.atualizar(client);
}

function agendarAtualizacaoReativa(client) {
  clientAtual = client;
  painel.agendarAtualizacaoReativa(client);
}

registrarConsulta(SLUG, async periodo => {
  const [contagens, eventos] = await Promise.all([
    repo.contarPorAcoes(A.ACOES_RESTRICAO, periodo),
    repo.listarPorAcoes(A.ACOES_RESTRICAO, periodo, EVENTOS_CONSULTA),
  ]);
  return {
    embeds: F.embedsDeLista({
      titulo: `⛔ RESTRIÇÕES — ${periodo.rotulo}`,
      cabecalho: 'O que foi aplicado e retirado no período (quem está barrado HOJE fica no topo do canal).',
      linhas: contagens.map(c => `• **${ROTULOS_ACAO[c.acao] ?? c.acao}:** ${E.formatarNumero(c.total)}`),
      vazio: 'Nenhuma restrição mexida no período.',
      origem: 'canal logs-registros',
      fields: eventos.length
        ? [{
          name: 'ÚLTIMOS EVENTOS DO PERÍODO',
          value: E.truncar(eventos.map(e =>
            `• ${ROTULOS_ACAO[e.acao] ?? e.acao}: ${F.pessoa({ nome: e.alvo_nome, id: e.alvo_id_fivem })}`
            + ` por ${F.nomeSeguro(e.ator_nome)} — ${E.formatarDataHora(e.ocorrido_em)}`).join('\n'), 1024),
        }]
        : [],
    }).slice(0, 1),
  };
}, agendarAtualizacaoReativa);

module.exports = {
  iniciarPainelRestricoes: iniciar,
  atualizarPainelRestricoes: atualizar,
  agendarAtualizacaoReativa,
};

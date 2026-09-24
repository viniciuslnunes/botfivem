const config = require('../../config/index.js');
const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarPainelCanal } = require('./painelCanal');
const {
  farmDoPeriodo, linhaComponentesFarm, tabelaFarm, farmPorItem, tabelaFarmPorItem, rotuloItem, limitesEfetivosFarm, PERIODO_PADRAO,
} = require('./painelFarmInteracoes');
const { gerarGraficoFarmPorDia } = require('./graficoFarmPorDia');
const tema = require('../../tema');

const ITENS_FARM = config.logsJogo.farm.itens.map(i => i.toLowerCase());
const BAUS_FARM = config.logsJogo.farm.baus;

// Canal 🌾・painel-farm: mensagem fixa curta (padrão interativo, ver
// painelBau.js) — cruza o cargo do departamento Farm (EQUIPE FARM/RESPONSÁVEL
// FARM, ver utils/departamentos) com o que de fato foi guardado nos baús
// habilitados (config.logsJogo.farm) dos itens de farm. Nasce na mesma
// categoria de estatística dos outros painéis de log (📦・estoque-bau,
// 🦅・painel-recrutadores). Só liderança/gestor de área (auditoria de
// desempenho individual, não quadro de orgulho).
const SLUG = 'painel_farm';
const ACOES_FARM = ['bau_guardou'];

let clientAtual = null;

async function montarBlocos() {
  const guild = await clientAtual.guilds.fetch(config.guildId);
  const periodo = E.resolverPeriodo(PERIODO_PADRAO);
  const [linhas, itens, linhasDia, ultima, limites] = await Promise.all([
    farmDoPeriodo(guild, periodo),
    farmPorItem(periodo),
    repo.farmPorDia(ITENS_FARM, BAUS_FARM, periodo),
    repo.ultimaOcorrencia(ACOES_FARM),
    limitesEfetivosFarm(),
  ]);
  const aviso = F.avisoFonteParada(ultima);
  const online = linhas.filter(l => l.online).length;
  const zerados = linhas.filter(l => l.quantidade === 0).length;
  const totalQtd = linhas.reduce((soma, l) => soma + l.quantidade, 0);
  const serie = E.serieDiaria(linhasDia, periodo.inicio, periodo.fim);
  const chart = serie.some(s => s.total) ? await gerarGraficoFarmPorDia(serie) : null;

  const embed = {
    color: F.COR,
    title: tema.titulo('🌾 INTELIGÊNCIA DE FARM'),
    description: [
      ...(aviso ? [aviso, ''] : []),
      linhas.length
        ? `**MEMBROS:** ${E.formatarNumero(linhas.length)} · **ONLINE AGORA:** ${E.formatarNumero(online)}`
        : '⚠️ Nenhum membro com cargo do departamento Farm ainda — rode `/departamentos` pra criar/vincular.',
      `**GUARDADO (${periodo.rotulo.toLowerCase()}):** ${E.formatarNumero(Math.round(totalQtd))} unid.`,
      zerados ? `⚠️ **${E.formatarNumero(zerados)}** membro(s) do farm com ZERO depósito em ${periodo.rotulo.toLowerCase()}.` : null,
      '',
      linhas.length ? tabelaFarm(linhas) : null,
      '',
      '**POR ITEM:**',
      itens.length ? tabelaFarmPorItem(itens) : '*Nenhum item de farm guardado no período.*',
      '',
      `**LIMITE DIÁRIO DE RETIRADA (por pessoa):** ${Object.entries(limites).map(([item, valor]) => `${rotuloItem(item)} ${E.formatarNumero(valor)}`).join(' · ')}`,
    ].filter(Boolean).join('\n'),
    image: chart ? { url: 'attachment://farm-dias.png' } : undefined,
    footer: { text: F.rodape('canal logs-baú') },
    timestamp: new Date().toISOString(),
  };
  // `attachments: []` sempre junto de `files`, senão o Discord acumula um PNG
  // por edição em vez de substituir (mesma pegadinha de painelTerritorio.js —
  // ver docs/padroes-e-canais.md § 1.9).
  const files = chart ? [{ attachment: chart, name: 'farm-dias.png' }] : [];
  return [{
    embeds: [embed], components: linhaComponentesFarm(), attachments: [], files, allowedMentions: { parse: [] },
  }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🌾・painel-farm',
  razao: 'Cruzamento do cargo do departamento Farm com o que foi guardado no baú, a partir dos logs',
  intervaloMin: 15,
  montarBlocos,
});

// montarBlocos precisa do client (guild.members do cargo Farm) e o esqueleto
// do painel não o passa — mesma solução de painelRecrutadores.js.
function iniciar(client) { clientAtual = client; painel.iniciar(client); }
function atualizar(client) { clientAtual = client; return painel.atualizar(client); }
function agendarAtualizacaoReativa(client) { clientAtual = client; painel.agendarAtualizacaoReativa(client); }

module.exports = {
  iniciarPainelFarm: iniciar,
  atualizarPainelFarm: atualizar,
  agendarAtualizacaoReativa,
};

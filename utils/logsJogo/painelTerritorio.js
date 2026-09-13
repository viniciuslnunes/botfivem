const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesTerritorio, porTerritorio } = require('./painelTerritorioInteracoes');

// Canal 🗺️・dominacao-territorios: mensagem fixa curta (padrão interativo, ver
// painelBau.js). Público — conquista é orgulho da torcida, não auditoria.
// Detalhe (ranking paginado por período, territórios perdidos) mora em
// painelTerritorioInteracoes.js.
const SLUG = 'dominacao_territorios';
const ACOES = ['coins_dominacao', 'coins_conquista'];

async function montarBlocos() {
  const mes = E.resolverPeriodo('30d');
  const [linhasMes, ultima] = await Promise.all([repo.resumoPorAlvo(ACOES, mes), repo.ultimaOcorrencia(ACOES)]);
  const territorios = porTerritorio(linhasMes);
  const horas = territorios.reduce((s, t) => s + t.horas, 0);
  const conquistas = territorios.reduce((s, t) => s + t.conquistas, 0);
  const aviso = F.avisoFonteParada(ultima);

  const lider = territorios[0];
  const embed = {
    color: F.COR,
    title: '🗺️ DOMINAÇÃO DE TERRITÓRIOS — GAVIÕES DA FIEL FIVEM',
    description: [
      ...(aviso ? [aviso, ''] : []),
      `**ÚLTIMOS 30 DIAS:** ${E.formatarNumero(horas)}h de domínio · ${E.formatarNumero(conquistas)} conquistas · ${E.formatarNumero(territorios.length)} territórios`,
      lider ? `**LÍDER:** ${F.nomeSeguro(lider.territorio)} (${E.formatarNumero(lider.horas)}h)` : null,
    ].filter(Boolean).join('\n'),
    footer: { text: F.rodape('canal logs-banco') },
    timestamp: new Date().toISOString(),
  };
  return [{ embeds: [embed], components: linhaComponentesTerritorio(), allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🗺️・dominacao-territorios',
  razao: 'Dominação e conquista de territórios a partir das coins do jogo',
  publico: true,
  intervaloMin: 30,
  montarBlocos,
});

module.exports = {
  iniciarPainelTerritorio: painel.iniciar,
  atualizarPainelTerritorio: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};

const repo = require('./repositorio');
const E = require('./estatisticas');
const F = require('./painelFormato');
const { criarPainelCanal } = require('./painelCanal');
const { linhaComponentesBau } = require('./painelBauInteracoes');

// Canal 📦・estoque-bau: o que entra e sai do baú da torcida (5 compartimentos:
// GDF Sócio/Diretoria/Presidência/Recrutador + Recompensas), a partir do canal
// logs-baú.
//
// Padrão "canal-painel interativo" (2026-09-13, replicado nos 8 outros canais
// de log): a mensagem fixa mostra só os números-chave, igual ao
// 📊・painel-jogadores — nada de listagem direta no canal. Escolher período,
// filtrar por baú, buscar item/jogador e ver ranking são tudo botão/select
// que abre uma resposta EPHEMERAL, só pra quem clicou (mecânica inteira em
// painelBauInteracoes.js).
//
// Honestidade do número: o jogo NUNCA diz quanto já tinha dentro do baú, só
// avisa "guardou 1 tecido" / "removeu 58 madeira". Então todo saldo aqui é
// LÍQUIDO DESDE O PRIMEIRO LOG LIDO, não estoque — e a mensagem fixa diz isso.
const SLUG = 'estoque_bau';

function qtd(n) {
  return E.formatarNumero(Math.round(Number(n) || 0));
}

async function montarBlocos() {
  const saldos = await repo.saldoBau();
  if (!saldos.length) {
    return [{
      embeds: [{
        color: F.COR,
        title: '📦 BAÚ DA TORCIDA — GAVIÕES DA FIEL FIVEM',
        description: 'Nenhum movimento de baú registrado ainda. Assim que o jogo publicar o primeiro '
          + '"Guardou/Removeu" no canal de logs do baú, os números aparecem aqui.',
        footer: { text: F.rodape('canal logs-baú') },
      }],
      components: linhaComponentesBau(),
    }];
  }

  const desde = saldos.reduce((min, l) => (new Date(l.desde) < new Date(min) ? l.desde : min), saldos[0].desde);
  const negativos = saldos.filter(l => l.saldo < 0).length;
  const baus = [...new Set(saldos.map(l => l.bau))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const [pessoas30d] = await Promise.all([repo.movimentoBauPorPessoa(E.resolverPeriodo('30d'), 1)]);
  const maiorRetirador = pessoas30d[0] ? await F.comNomes(pessoas30d) : null;

  const embed = {
    color: F.COR,
    title: '📦 BAÚ DA TORCIDA — GAVIÕES DA FIEL FIVEM',
    description: [
      `**COMPARTIMENTOS:** ${baus.length}`,
      `**ITENS COM MOVIMENTO:** ${qtd(saldos.length)}${negativos ? ` (${qtd(negativos)} com saldo negativo)` : ''}`,
      maiorRetirador?.[0] ? `**QUEM MAIS RETIROU (30 DIAS):** ${maiorRetirador[0].nome ?? maiorRetirador[0].id} (${qtd(maiorRetirador[0].removeu)})` : null,
      `Saldo **líquido desde ${E.formatarDataHora(desde)}** — o jogo não informa o que já estava dentro, só entrada e saída.`,
    ].filter(Boolean).join('\n'),
    footer: { text: F.rodape('canal logs-baú') },
    timestamp: new Date().toISOString(),
  };
  return [{ embeds: [embed], components: linhaComponentesBau(baus), allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '📦・estoque-bau',
  razao: 'Saldo e auditoria do baú da torcida a partir dos logs do jogo',
  intervaloMin: 30,
  montarBlocos,
});

module.exports = {
  iniciarPainelBau: painel.iniciar,
  atualizarPainelBau: painel.atualizar,
  agendarAtualizacaoReativa: painel.agendarAtualizacaoReativa,
};

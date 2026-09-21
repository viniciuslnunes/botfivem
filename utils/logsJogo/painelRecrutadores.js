const config = require('../../config/index.js');
const E = require('./estatisticas');
const F = require('./painelFormato');
const repo = require('./repositorio');
const relatorios = require('./relatorios');
const { criarPainelCanal } = require('./painelCanal');
const {
  recrutadoresDoPeriodo, linhaComponentesRecrutadores, tabelaRecrutadores, ACOES_RECRUTAMENTO, PERIODO_PADRAO,
} = require('./painelRecrutadoresInteracoes');

// Canal 🦅・painel-recrutadores: mensagem fixa curta (padrão interativo, ver
// painelBau.js) — cruza o cargo RECRUTADOR com recrutamentos e tempo jogado
// no período. Nasce ao lado de 📋・quadro-de-recrutadores (mesma categoria de
// departamento social). Só liderança (auditoria de desempenho individual,
// não quadro de orgulho como o quadro atual): `publico` fica no padrão
// (false) do criarPainelCanal.
const SLUG = 'painel_recrutadores';

let clientAtual = null;

async function montarBlocos() {
  const guild = await clientAtual.guilds.fetch(config.guildId);
  const periodo = E.resolverPeriodo(PERIODO_PADRAO);
  const [linhas, ultima, recrutamentos] = await Promise.all([
    recrutadoresDoPeriodo(guild, periodo),
    repo.ultimaOcorrencia(ACOES_RECRUTAMENTO),
    relatorios.recrutamentosRecentes(),
  ]);
  const aviso = F.avisoFonteParada(ultima);
  const online = linhas.filter(l => l.online).length;
  const zerados = linhas.filter(l => l.recrutamentos === 0).length;
  // Amostra mínima de 3 recrutamentos: com 1 ou 2, um único caso de azar
  // (recrutado saiu por motivo alheio ao recrutador) já derruba a % pra 0/50
  // e vira ruído, não sinal.
  const baixaRetencao = linhas.filter(l => l.recrutamentos >= 3 && (l.recrutamentos - l.saiuCedo) / l.recrutamentos < 0.5).length;

  const embed = {
    color: F.COR,
    title: '🦅 INTELIGÊNCIA DE RECRUTADORES — GAVIÕES DA FIEL FIVEM',
    description: [
      ...(aviso ? [aviso, ''] : []),
      `**RECRUTADORES:** ${E.formatarNumero(linhas.length)} · **ONLINE AGORA:** ${E.formatarNumero(online)}`,
      `**RECRUTAMENTOS:** +${E.formatarNumero(recrutamentos.hoje)} hoje · +${E.formatarNumero(recrutamentos.semana)} na semana`,
      zerados ? `⚠️ **${E.formatarNumero(zerados)}** recrutador(es) com ZERO recrutamento em ${periodo.rotulo.toLowerCase()}.` : null,
      baixaRetencao ? `⚠️ **${E.formatarNumero(baixaRetencao)}** recrutador(es) com retenção abaixo de 50% (mín. 3 recrutamentos em ${periodo.rotulo.toLowerCase()}).` : null,
      '',
      linhas.length ? tabelaRecrutadores(linhas) : '*Nenhum membro com o cargo RECRUTADOR.*',
    ].filter(Boolean).join('\n'),
    footer: { text: F.rodape('canal logs-registros + logs-painel') },
    timestamp: new Date().toISOString(),
  };
  return [{ embeds: [embed], components: linhaComponentesRecrutadores(), allowedMentions: { parse: [] } }];
}

const painel = criarPainelCanal({
  slug: SLUG,
  nomeCanal: '🦅・painel-recrutadores',
  razao: 'Cruzamento do cargo RECRUTADOR com recrutamentos e tempo jogado, a partir dos logs',
  intervaloMin: 15,
  montarBlocos,
  canalVizinhoId: config.canais.quadroRecrutadores,
});

// `montarBlocos` precisa do client (guild.members do cargo RECRUTADOR) e o
// esqueleto do painel não o passa — guardar aqui repete a solução de
// painelRestricoes.js (mesmo motivo).
function iniciar(client) { clientAtual = client; painel.iniciar(client); }
function atualizar(client) { clientAtual = client; return painel.atualizar(client); }
function agendarAtualizacaoReativa(client) { clientAtual = client; painel.agendarAtualizacaoReativa(client); }

module.exports = {
  iniciarPainelRecrutadores: iniciar,
  atualizarPainelRecrutadores: atualizar,
  agendarAtualizacaoReativa,
};

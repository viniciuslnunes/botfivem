// Mérito de recrutadores: embeds e textos (extrato pessoal, dossiê do indicado,
// seção do quadro de regras). Só formatação: recebe dados já calculados.
const tema = require('../../tema');
const F = require('../logsJogo/painelFormato');
const R = require('./regras');

const dataCurta = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const seg = d => Math.floor(new Date(d).getTime() / 1000);
const pts = n => Number(n).toFixed(1).replace('.', ',');

const ROTULOS = [
  ['constancia', 'Constância (semanas na meta)', R.PESOS.constancia],
  ['sequencia', 'Sequência de semanas seguidas', R.PESOS.sequencia],
  ['qualidade', 'Qualidade (recrutas que ficaram)', R.PESOS.qualidade],
  ['conversao', 'Conversão (recrutas aprovados)', R.PESOS.conversao],
  ['manto', 'Manto certo', R.PESOS.manto],
  ['ficha', 'Ficha completa', R.PESOS.ficha],
  ['engajamento', 'Engajamento (eventos)', R.PESOS.engajamento],
];

const rotuloSelo = selo => (selo === 'DESTAQUE' ? 'Destaque' : 'Constante');

// Uma dica só: o critério com mais pontos a ganhar que o recrutador ainda controla
function dicaParaSubir(detalhe) {
  const p = detalhe.pontos ?? {};
  const faltas = ROTULOS
    .filter(([chave]) => chave !== 'sequencia')
    .map(([chave, rotulo, peso]) => ({ chave, rotulo, falta: peso - (p[chave] ?? 0) }))
    .sort((a, b) => b.falta - a.falta);
  const maior = faltas[0];
  if (!maior || maior.falta < 1) return 'Você está no máximo em todos os critérios. É manter o ritmo.';
  const dicas = {
    constancia: 'bata a meta em mais semanas do ciclo: é o critério que mais pesa.',
    qualidade: 'traga recrutas que voltam ao jogo e ficam, sem sair cedo nem dar problema.',
    conversao: 'acompanhe o recrutado até ele preencher a ficha e ser aprovado.',
    manto: 'confira o manto do candidato antes de aprovar a ficha.',
    ficha: 'só aprove ficha com nome, idade, ID e telefone preenchidos.',
    engajamento: 'compareça aos eventos da torcida.',
  };
  return `${maior.rotulo}: ${dicas[maior.chave]} (ainda dá para ganhar ${pts(maior.falta)} pontos)`;
}

function linhaSemana(s, meta) {
  const marca = s.dispensada ? 'dispensada' : s.bateu ? tema.emoji.ok : '·';
  const extra = [s.pendentes ? `${s.pendentes} em validação` : null, s.suspeitos ? `${s.suspeitos} suspeito(s)` : null, s.retidos ? `${s.retidos} em revisão` : null]
    .filter(Boolean).join(', ');
  return `S${s.semana + 1} ${marca} ${s.validos + s.pendentes}/${s.meta ?? meta}${extra ? ` (${extra})` : ''}`;
}

// resultado: linha de merito_resultado; semanas: linhas de merito_semanas
function embedExtrato({ ciclo, resultado, semanas, selos = [], nome }) {
  const d = resultado?.detalhe ?? {};
  const cab = ciclo.sombra ? ' · CICLO DE CALIBRAÇÃO (sem indicação nem votação)' : '';
  if (!resultado) {
    return {
      color: F.COR, title: tema.titulo(`${tema.emoji.marca} MEU MÉRITO — CICLO ${ciclo.numero}`),
      description: `Ainda não há pontuação para ${nome ?? 'você'} neste ciclo. Confirme que o apelido termina com o seu ID do jogo (Nome - ID) e que você tem o cargo de recrutador.`,
    };
  }
  const p = d.pontos ?? {};
  const linhas = ROTULOS.map(([chave, rotulo, peso]) => {
    const neutro = d.pontos?.neutros?.[chave] ? ' (amostra pequena: vale meio)' : '';
    return `${rotulo}: **${pts(p[chave] ?? 0)}** / ${peso}${neutro}`;
  });
  if ((p.disciplina ?? 0) < 0) linhas.push(`Advertências no ciclo: **${pts(p.disciplina)}**`);
  if (resultado.bonus > 0) linhas.push(`Bônus de trajetória: **+${pts(resultado.bonus)}** (${(p.bonus ?? []).map(b => b.nome).join(', ')})`);

  const situacao = resultado.elegivel
    ? `${tema.emoji.ok} Elegível à indicação${resultado.posicao ? ` · **${resultado.posicao}º lugar**` : ''}`
    : `${tema.emoji.pendente} Ainda não elegível: ${(resultado.motivos ?? []).join('; ')}`;

  return {
    color: F.COR,
    title: tema.titulo(`${tema.emoji.marca} MEU MÉRITO — CICLO ${ciclo.numero}`),
    description: [
      `${situacao}${cab}`,
      `**Total: ${pts(resultado.pontos)} pontos** de 100${resultado.bonus > 0 ? ` + ${pts(resultado.bonus)} de bônus` : ''}`,
      `Semanas na meta: **${d.semanasBatidas ?? 0}/${d.semanasContaveis ?? 0}** · maior sequência: **${d.maiorSequencia ?? 0}** · ciclo até <t:${seg(ciclo.fim)}:D>`,
      '',
      ...linhas,
    ].join('\n'),
    fields: [
      { name: 'SEMANAS', value: (semanas ?? []).map(s => linhaSemana(s, d.meta)).join('\n') || 'Sem semanas ainda.' },
      { name: 'COMO SUBIR', value: dicaParaSubir(d) },
      ...(selos.length ? [{ name: 'SELOS', value: selos.map(s => `${rotuloSelo(s.selo)} (ciclo ${s.numero})`).join(' · ') }] : []),
    ],
    footer: { text: 'Recrutamento só conta como confirmado 14 dias depois: fantasma e saída cedo não pontuam' },
  };
}

// Dossiê de um indicado para a liderança votar
function embedDossie({ resultado, selos = [], posicao, vetado = null }) {
  const d = resultado.detalhe ?? {};
  const p = d.pontos ?? {};
  const t = d.totais ?? {};
  return {
    color: F.COR,
    title: tema.titulo(`${posicao ? `${posicao}º · ` : ''}${F.nomeSeguro(d.nome ?? resultado.discord_id)}`),
    description: [
      `<@${resultado.discord_id}> · **${pts(resultado.pontos + resultado.bonus)} pontos**${vetado ? `\n${tema.emoji.recusado} **VETADO:** ${vetado.motivo}` : ''}`,
      `Semanas na meta: **${d.semanasBatidas ?? 0}/${d.semanasContaveis ?? 0}** · sequência **${d.maiorSequencia ?? 0}** · recrutamentos efetivos **${d.efetivos ?? 0}**`,
      `Ficaram: **${t.ficaram ?? 0}/${t.maduros ?? 0}** · aprovados: **${t.aprovados ?? 0}** · manto certo: **${d.manto?.corretos ?? 0}/${d.manto?.avaliados ?? 0}** · fichas completas: **${d.fichas?.completas ?? 0}/${d.fichas?.aprovadas ?? 0}**`,
      `Advertências no ciclo: **${d.advCiclo ?? 0}** · eventos: **${d.engajamento?.presentes ?? 0}/${d.engajamento?.eventos ?? 0}**`,
      `Constância ${pts(p.constancia ?? 0)} · qualidade ${pts(p.qualidade ?? 0)} · conversão ${pts(p.conversao ?? 0)} · manto ${pts(p.manto ?? 0)} · ficha ${pts(p.ficha ?? 0)} · eventos ${pts(p.engajamento ?? 0)}`,
      selos.length ? `Selos: ${selos.map(s => `${rotuloSelo(s.selo)} (ciclo ${s.numero})`).join(' · ')}` : null,
    ].filter(Boolean).join('\n'),
  };
}

// Seção do quadro 📘・regras-recrutadores, lida dos mesmos limites do motor
function embedRegrasMerito() {
  const L = R.LIMITES;
  return {
    color: F.COR,
    title: tema.titulo(`${tema.emoji.marca} MÉRITO: COMO SE CHEGA A GESTOR`),
    description: [
      `A cada **${L.semanasCiclo} semanas** o bot fecha um ranking de mérito e indica os **${L.indicados} melhores** para crescer na diretoria do departamento. A liderança vota e decide; o bot nunca promove sozinho.`,
      '',
      `**Constância vale mais que pico.** Semana batida (padrão **${L.metaPadrao} recrutamentos**) pesa até ${R.PESOS.constancia + R.PESOS.sequencia} de 100 pontos.`,
      `**Recruta que fica vale mais que recruta que some.** Qualidade dos recrutas ${R.PESOS.qualidade} pts, aprovação ${R.PESOS.conversao}, manto certo ${R.PESOS.manto}, ficha completa ${R.PESOS.ficha}, eventos ${R.PESOS.engajamento}. Cada advertência tira ${R.DESCONTO_ADV}.`,
      `**Confirmação:** o recrutamento só é confirmado ${L.janelaValidacaoDias} dias depois (voltou ao jogo, não saiu cedo, sem problema). Recrutado que some não conta.`,
      `**Para entrar no ranking:** ${L.minSemanasCargo}+ semanas de cargo, meta batida em ${L.minSemanasBatidas}+ semanas, sem advertência ativa de 2ª ou mais e sem risco alto.`,
      `**Ausência avisada:** ${L.semanasDispensadasPorCiclo} semana dispensada por ciclo, aprovada pela liderança, sai da conta sem punir.`,
      `**Selos:** Constante (meta em ${L.seloConstanteSemanas}+ semanas) e Destaque (top ${L.indicados}).`,
      '',
      'Veja onde você está em **🏆・mérito-recrutadores** ou com **/merito**.',
    ].join('\n'),
    footer: { text: 'Valores lidos das regras do bot: este quadro acompanha qualquer ajuste' },
  };
}

module.exports = { embedExtrato, embedDossie, embedRegrasMerito, dicaParaSubir, linhaSemana, dataCurta, pts, seg, rotuloSelo, ROTULOS };

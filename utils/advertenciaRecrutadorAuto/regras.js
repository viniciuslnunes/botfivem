// Advertência automática de recrutador: regras puras (sem Discord nem banco).
// Cada regra devolve uma justificativa que vai para o registro e para o canal.
const DIA_MS = 24 * 60 * 60 * 1000;

const LIMITES = Object.freeze({
  diasSemRecrutarJogando: 5,     // jogou e não recrutou → 1ª advertência
  diasInativo: 7,                // não jogou nem recrutou → perde o cargo
  minJogadoMs: 30 * 60 * 1000,   // abaixo disso "jogou" é só ter logado
  diasRetencao: 14,              // janela da retenção (recrutado precisa de tempo para sair)
  retencaoMinima: 0.5,
  minRecrutamentosRetencao: 3,   // mesma amostra mínima do painel (1–2 casos é ruído)
  ocorrencias: 3,                // manto errado / ficha incompleta em diasOcorrencias
  diasOcorrencias: 7,
  perdaoRecrutamentos: 3,        // advertência por inatividade sai depois disso
  prazoSegundaMs: 2 * DIA_MS,    // 2ª por inatividade: voltar a recrutar
  validadeDias: 30,              // advertência ativa há mais que isso expira
});

const REGRAS = Object.freeze({
  sem_recrutar_jogando: { rotulo: 'JOGANDO SEM RECRUTAR', cooldownDias: LIMITES.diasSemRecrutarJogando },
  retencao_baixa: { rotulo: 'RETENÇÃO BAIXA', cooldownDias: LIMITES.diasRetencao },
  manto_errado: { rotulo: 'MANTO APROVADO ERRADO', cooldownDias: LIMITES.diasOcorrencias },
  ficha_incompleta: { rotulo: 'FICHA APROVADA INCOMPLETA', cooldownDias: LIMITES.diasOcorrencias },
});

const horas = ms => `${Math.floor(ms / 3600000)}h${String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')}`;

// d = métricas de UM recrutador:
//   rec5/ms5, rec7/ms7 (recrutamentos e tempo jogado nos últimos 5/7 dias), online,
//   rec14/saiuCedo14, erros7, incompletas7, cargoDesde (Date|null), ultimaPorRegra {regra: Date}
// Devolve { removerCargo: motivo|null, infracoes: [{ regra, motivo }] }.
function decidir(d, agora = new Date()) {
  const cargoHaDias = d.cargoDesde ? (agora - new Date(d.cargoDesde)) / DIA_MS : Infinity;
  const emCooldown = regra => {
    const ultima = d.ultimaPorRegra?.[regra];
    return Boolean(ultima) && (agora - new Date(ultima)) < REGRAS[regra].cooldownDias * DIA_MS;
  };

  if (d.rec7 === 0 && d.ms7 === 0 && !d.online && cargoHaDias >= LIMITES.diasInativo) {
    return {
      removerCargo: `Inatividade: ${LIMITES.diasInativo} dias sem jogar e sem recrutar ninguém.`,
      infracoes: [],
    };
  }

  const infracoes = [];
  if (d.rec5 === 0 && d.ms5 >= LIMITES.minJogadoMs && cargoHaDias >= LIMITES.diasSemRecrutarJogando && !emCooldown('sem_recrutar_jogando')) {
    infracoes.push({
      regra: 'sem_recrutar_jogando',
      motivo: `Jogou ${horas(d.ms5)} nos últimos ${LIMITES.diasSemRecrutarJogando} dias e não recrutou ninguém.`,
    });
  }
  if (d.rec14 >= LIMITES.minRecrutamentosRetencao && (d.rec14 - d.saiuCedo14) / d.rec14 < LIMITES.retencaoMinima && !emCooldown('retencao_baixa')) {
    const pct = Math.round(((d.rec14 - d.saiuCedo14) / d.rec14) * 100);
    infracoes.push({
      regra: 'retencao_baixa',
      motivo: `Retenção de ${pct}% (${d.saiuCedo14} de ${d.rec14} recrutados saíram cedo) nos últimos ${LIMITES.diasRetencao} dias.`,
    });
  }
  if (d.erros7 >= LIMITES.ocorrencias && !emCooldown('manto_errado')) {
    infracoes.push({
      regra: 'manto_errado',
      motivo: `${d.erros7} mantos aprovados errado (avaliação da liderança) nos últimos ${LIMITES.diasOcorrencias} dias.`,
    });
  }
  if (d.incompletas7 >= LIMITES.ocorrencias && !emCooldown('ficha_incompleta')) {
    infracoes.push({
      regra: 'ficha_incompleta',
      motivo: `${d.incompletas7} fichas aprovadas com informação faltando (nome, idade, ID ou telefone) nos últimos ${LIMITES.diasOcorrencias} dias.`,
    });
  }
  return { removerCargo: null, infracoes };
}

// Aviso preventivo: quem está perto de cruzar um limite. Mesmas medidas de
// `decidir` (mais `ultimoRecrutou` e `ultimaConexaoEm`, Date|null; sem eles as
// regras de tempo não avisam). Devolve [{ regra, texto, restamDias|null }].
const AVISO = Object.freeze({
  antecedenciaDias: 2,   // avisa quando faltam até 2 dias para a regra disparar
  repeticaoDias: 2,      // mesmo aviso não repete dentro disso
  retencaoFolga: 0.1,    // avisa com retenção entre 50% e 60%
});

function riscos(d, agora = new Date()) {
  const cargoHaDias = d.cargoDesde ? (agora - new Date(d.cargoDesde)) / DIA_MS : Infinity;
  const emCooldown = regra => {
    const ultima = d.ultimaPorRegra?.[regra];
    return Boolean(ultima) && (agora - new Date(ultima)) < REGRAS[regra].cooldownDias * DIA_MS;
  };
  const diasDesde = data => (agora - new Date(data)) / DIA_MS;
  const dentro = restam => restam > 0 && restam <= AVISO.antecedenciaDias;
  const plural = n => `${n} dia${n === 1 ? '' : 's'}`;
  const saida = [];

  if (d.ultimoRecrutou && d.rec5 > 0 && d.ms5 >= LIMITES.minJogadoMs && !emCooldown('sem_recrutar_jogando')) {
    const restam = Math.max(LIMITES.diasSemRecrutarJogando - diasDesde(d.ultimoRecrutou), LIMITES.diasSemRecrutarJogando - cargoHaDias);
    if (dentro(restam)) {
      const n = Math.ceil(restam);
      saida.push({
        regra: 'sem_recrutar_jogando', restamDias: n,
        texto: `Último recrutamento há ${plural(Math.floor(diasDesde(d.ultimoRecrutou)))}: sem recrutar em ${plural(n)} e jogando, recebe advertência.`,
      });
    }
  }

  const ultimaAtividade = [d.ultimoRecrutou, d.ultimaConexaoEm].filter(Boolean).map(x => new Date(x).getTime());
  if (ultimaAtividade.length && !d.online) {
    const dias = diasDesde(Math.max(...ultimaAtividade));
    const restam = Math.max(LIMITES.diasInativo - dias, LIMITES.diasInativo - cargoHaDias);
    if (dentro(restam)) {
      const n = Math.ceil(restam);
      saida.push({
        regra: 'inatividade', restamDias: n,
        texto: `Sem jogar nem recrutar há ${plural(Math.floor(dias))}: em ${plural(n)} perde o cargo de recrutador.`,
      });
    }
  }

  if (d.rec14 >= LIMITES.minRecrutamentosRetencao && !emCooldown('retencao_baixa')) {
    const ret = (d.rec14 - d.saiuCedo14) / d.rec14;
    if (ret >= LIMITES.retencaoMinima && ret < LIMITES.retencaoMinima + AVISO.retencaoFolga) {
      saida.push({
        regra: 'retencao_baixa', restamDias: null,
        texto: `Retenção em ${Math.round(ret * 100)}% nos últimos ${LIMITES.diasRetencao} dias (abaixo de ${Math.round(LIMITES.retencaoMinima * 100)}% gera advertência).`,
      });
    }
  }

  if (d.erros7 === LIMITES.ocorrencias - 1 && !emCooldown('manto_errado')) {
    saida.push({ regra: 'manto_errado', restamDias: null, texto: `${d.erros7} mantos aprovados errado em ${LIMITES.diasOcorrencias} dias: o próximo gera advertência.` });
  }
  if (d.incompletas7 === LIMITES.ocorrencias - 1 && !emCooldown('ficha_incompleta')) {
    saida.push({ regra: 'ficha_incompleta', restamDias: null, texto: `${d.incompletas7} fichas aprovadas incompletas em ${LIMITES.diasOcorrencias} dias: a próxima gera advertência.` });
  }
  return saida;
}

// Nível da próxima advertência = ativas + 1. Só a inatividade tem prazo na 2ª
// (voltar a recrutar); nas demais a 2ª é registro, sem prazo.
function planoDaAdvertencia(ativas, regra) {
  const nivel = ativas + 1;
  return {
    nivel,
    removeCargo: nivel >= 3,
    prazoMs: nivel === 2 && regra === 'sem_recrutar_jogando' ? LIMITES.prazoSegundaMs : null,
  };
}

const perdoada = recrutamentosDesde => recrutamentosDesde >= LIMITES.perdaoRecrutamentos;
const expirada = (criadaEm, agora = new Date()) => (agora - new Date(criadaEm)) > LIMITES.validadeDias * DIA_MS;

module.exports = { LIMITES, REGRAS, AVISO, decidir, riscos, planoDaAdvertencia, perdoada, expirada, DIA_MS };

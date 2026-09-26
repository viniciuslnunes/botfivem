// Relatórios da inteligência cruzada, prontos para embed. Servem o /inteligencia (ephemeral,
// liderança) e o boletim semanal. Cada função devolve um embed puro ({ color, title, ... });
// quem chama decide onde publicar. Tudo só informa: a decisão é da liderança.
const config = require('../../config/index.js');
const tema = require('../../tema');
const F = require('../logsJogo/painelFormato');
const E = require('../logsJogo/estatisticas');
const logs = require('../logsJogo/repositorio');
const R = require('./regras');
const repo = require('./repositorio');

const pct = n => (n == null ? '—' : `${Math.round(n * 100)}%`);
const hora = h => `${String(h).padStart(2, '0')}h`;
const embed = (titulo, extra = {}) => ({
  color: tema.cor.primaria, title: titulo, timestamp: new Date().toISOString(), ...extra,
});

// IDs do jogo de quem tem o cargo de recrutador (base da cobertura de horário)
function recrutadoresIdsDe(socios) {
  return socios.filter(s => s.idFivem && s.membro.roles.cache.has(config.cargos.recrutador)).map(s => s.idFivem);
}

// ── Risco e atividade ────────────────────────────────────────────────────────

async function embedRisco({ limite = 15, minimo = 30 } = {}) {
  const linhas = (await repo.maioresRiscos(limite, minimo)).map(r => {
    const nivel = r.risco >= 60 ? 'ALTO' : 'MÉDIO';
    const fatores = (r.dados?.fatores ?? []).slice(0, 4).join(' · ');
    return `**${r.risco}** ${nivel} — <@${r.discord_id}>${fatores ? `\n↳ ${fatores}` : ''}`;
  });
  return embed('🧯 ASSOCIADOS EM RISCO', {
    color: linhas.length ? tema.cor.perigo : tema.cor.primaria,
    description: linhas.length
      ? `Pontuação 0–100 a partir de advertências, restrições no jogo, reincidência, pagamento pendente, atividade em queda e lista não recrutar.\n\n${linhas.join('\n')}`
      : 'Nenhum sócio acima de 30 pontos na última varredura.',
    footer: { text: 'Só informa — a liderança decide · atualizado a cada 3 h' },
  });
}

async function embedFichaAssociado(discordId, confianca = null) {
  const r = await repo.resumoDe(discordId);
  if (!r) return embed('🧯 SEM RESUMO AINDA', { description: 'Este associado não foi medido na última varredura (precisa ter o cargo de sócio).' });
  const d = r.dados;
  const linhas = [
    `**Risco:** ${r.risco} · ${r.risco >= 60 ? 'ALTO' : r.risco >= 30 ? 'MÉDIO' : 'BAIXO'}`,
    d.fatores?.length ? `**Fatores:** ${d.fatores.join(' · ')}` : '**Fatores:** nenhum',
    `**Advertências ativas:** ${d.advAtivas}${d.pagamentoPendente ? ' (pagamento pendente)' : ''}`,
    `**Restrições ativas no jogo:** ${d.restricoesAtivas?.length ? d.restricoesAtivas.join(', ') : 'nenhuma'}`,
    `**Ocorrências em ${R.LIMITES.reincidenciaDias} dias:** ${d.ocorrencias90}${d.reincidente ? ' — reincidente' : ''}`,
    `**Jogo:** ${E.formatarDuracao(d.h7Ms)} em 7 dias · ${E.formatarDuracao(d.h28Ms)} em 28 dias${d.esfriando ? ' — atividade em queda' : ''}`,
    `**Baú (28 dias):** guardou ${E.formatarNumero(d.bau.entrou)} · retirou ${E.formatarNumero(d.bau.saiu)} — ${R.contribuicao(d.bau.entrou, d.bau.saiu).papel}`,
    `**Banco (28 dias):** depositou ${E.formatarDinheiro(d.banco.entrou)} · sacou ${E.formatarDinheiro(d.banco.saiu)} — ${R.contribuicao(d.banco.entrou, d.banco.saiu).papel}`,
    d.naoRecrutar ? '**Lista não recrutar:** ID bloqueado' : null,
    confianca ? `**Confiança:** ${confianca}` : null,
  ].filter(Boolean);
  return embed(`🧯 RESUMO DO ASSOCIADO`, {
    description: `<@${discordId}> (${r.id_fivem ?? 'sem ID no apelido'})\n\n${linhas.join('\n')}`,
    footer: { text: `Calculado ${d.calculadoEm ? new Date(d.calculadoEm).toLocaleString('pt-BR') : '—'}` },
  });
}

async function embedEsfriando() {
  const linhas = (await repo.esfriando(25)).map(r =>
    `<@${r.discord_id}> — ${E.formatarDuracao(r.dados.h7Ms)} nos últimos 7 dias (antes: ${E.formatarDuracao(r.dados.h28Ms / 4)}/semana)`);
  return embed('🧊 ESFRIANDO', {
    description: linhas.length
      ? `Sócios que jogavam ao menos ${R.LIMITES.esfriandoMediaMinMs / R.HORA_MS} h por semana e caíram ${pct(R.LIMITES.esfriandoQueda)} ou mais. Vale conversar antes de virar saída.\n\n${linhas.join('\n')}`
      : 'Ninguém com queda relevante de atividade.',
    footer: { text: F.rodape('logs-painel') },
  });
}

// ── Recrutamento ─────────────────────────────────────────────────────────────

async function embedRecrutamento() {
  const [funil, fichas, motivos, aprov] = await Promise.all([
    repo.funilDeFichas(30), repo.fichasDoPeriodo(30), repo.motivosDeReprovacao(30), repo.aprovadoresComProblema(R.LIMITES.aprovadorJanelaDias),
  ]);
  const etapas = R.funilDeFichas({
    fichas: funil.fichas, aprovadas: funil.aprovadas, mantoCorreto: funil.manto_correto,
    recrutadas: funil.recrutadas, maduras7: funil.maduras7, jogaram7d: funil.jogaram7d,
  });
  const sla = R.slaDasFichas(fichas);
  const qualidade = R.qualidadeDosAprovadores(aprov);

  const fields = [
    { name: 'FUNIL (30 DIAS)', value: etapas.map(e => `${e.rotulo}: **${e.total}**${e.deAnterior == null ? '' : ` (${pct(e.deAnterior)})`}`).join('\n') },
    {
      name: 'TEMPO DE ANÁLISE DA FICHA',
      value: sla.mediaMs == null
        ? 'Sem fichas decididas no período.'
        : `Média **${E.formatarDuracao(sla.mediaMs)}** · mediana **${E.formatarDuracao(sla.medianaMs)}** (${sla.decididas} decididas)`
          + (sla.paradas.length ? `\n⚠️ ${sla.paradas.length} ficha(s) pendente(s) há mais de ${R.LIMITES.fichaParadaHoras} h` : ''),
    },
    ...F.campoLista('MOTIVOS DE REPROVAÇÃO', motivos.map(m => `${F.nomeSeguro(m.categoria)}: **${m.total}**`), 'Nenhuma reprovação no período.', { numerar: false }),
    ...F.campoLista(
      `QUEM APROVOU × PROBLEMAS EM 30 DIAS (${R.LIMITES.aprovadorJanelaDias} DIAS)`,
      qualidade.map(q => `<@${q.aprovadorId}> — ${q.comProblema}/${q.aprovados} com ADV ou restrição (${pct(q.taxa)})${q.alerta ? ' ⚠️' : ''}`),
      'Ninguém aprovou no período.', { numerar: false }
    ),
  ];
  return embed('📋 RECRUTAMENTO: FUNIL, ANÁLISE E QUALIDADE', {
    description: 'Mede o caminho inteiro do candidato, quanto a equipe demora para decidir e se quem entra dá problema depois. Os aprovados mais recentes ainda podem entrar na conta.',
    fields,
    footer: { text: 'Discord (fichas, manto) + logs do jogo · só informa' },
  });
}

// ── Baú, banco, farm ─────────────────────────────────────────────────────────

async function nomesDe(ids) {
  return logs.nomesPorIds(ids);
}

async function embedContribuicao() {
  const [bau, banco] = await Promise.all([repo.movimentoBauPorId(28), repo.movimentoBancoPorId(28)]);
  const nomes = await nomesDe([...new Set([...bau, ...banco].map(l => l.id))]);
  const rotulo = id => `${F.nomeSeguro(nomes.get(id) ?? '?')} (${id})`;

  const secao = (linhasBrutas, formatar) => {
    const comPapel = linhasBrutas.map(l => ({ ...l, ...R.contribuicao(l.entrou, l.saiu) }));
    const consumidores = comPapel.filter(l => l.papel === 'CONSUMIDOR').sort((a, b) => a.liquido - b.liquido).slice(0, 8);
    const contribuintes = comPapel.filter(l => l.papel === 'CONTRIBUINTE').sort((a, b) => b.liquido - a.liquido).slice(0, 8);
    const contagem = comPapel.reduce((m, l) => ({ ...m, [l.papel]: (m[l.papel] ?? 0) + 1 }), {});
    return { comPapel, consumidores, contribuintes, contagem, formatar };
  };
  const b = secao(bau, E.formatarNumero);
  const c = secao(banco, E.formatarDinheiro);
  const linhas = (lista, fmt) => lista.map(l => `${rotulo(l.id)} — entrou ${fmt(l.entrou)} · saiu ${fmt(l.saiu)}`);
  const resumo = s => ['CONTRIBUINTE', 'EQUILIBRADO', 'CONSUMIDOR'].map(p => `${p.toLowerCase()}: ${s.contagem[p] ?? 0}`).join(' · ');

  return embed('⚖️ CONTRIBUIÇÃO: QUEM PÕE × QUEM TIRA (28 DIAS)', {
    description: 'Compara o que cada jogador guardou com o que retirou do baú, e depositou com o que sacou do banco da torcida. Retirar é normal para quem trabalha na área; o número mostra o padrão, não o motivo.',
    fields: [
      { name: `BAÚ — ${resumo(b)}`, value: '​' },
      ...F.campoLista('MAIORES CONSUMIDORES DO BAÚ', linhas(b.consumidores, E.formatarNumero), 'Nenhum.', { numerar: false }),
      ...F.campoLista('MAIORES CONTRIBUINTES DO BAÚ', linhas(b.contribuintes, E.formatarNumero), 'Nenhum.', { numerar: false }),
      { name: `BANCO — ${resumo(c)}`, value: '​' },
      ...F.campoLista('MAIORES SAQUES LÍQUIDOS', linhas(c.consumidores, E.formatarDinheiro), 'Nenhum.', { numerar: false }),
      ...F.campoLista('MAIORES DEPÓSITOS LÍQUIDOS', linhas(c.contribuintes, E.formatarDinheiro), 'Nenhum.', { numerar: false }),
    ],
    footer: { text: F.rodape('logs-baú + logs-banco') },
  });
}

async function embedFarm({ tempoJogadoPorId, socios = [] }) {
  const farm = config.logsJogo.farm;
  const periodo = { chave: '28d', rotulo: '28 DIAS', inicio: new Date(Date.now() - 28 * R.DIA_MS), fim: new Date() };
  const [linhas, tempo] = await Promise.all([logs.farmPorItemEAtor(farm.itens, farm.baus, periodo), tempoJogadoPorId(periodo)]);
  const total = new Map();
  for (const l of linhas) total.set(l.id, (total.get(l.id) ?? 0) + l.quantidade);
  const conc = R.concentracao([...total.values()]);
  const nomes = await nomesDe([...total.keys()]);

  const produtividade = [...total.entries()]
    .map(([id, q]) => ({ id, q, horas: (tempo.get(id)?.ms ?? 0) / R.HORA_MS }))
    .filter(p => p.horas >= 1)
    .map(p => ({ ...p, porHora: p.q / p.horas }))
    .sort((a, b) => b.porHora - a.porHora);
  const fmt = p => `${F.nomeSeguro(nomes.get(p.id) ?? '?')} (${p.id}) — ${E.formatarNumero(Math.round(p.q))} em ${p.horas.toFixed(1)} h = **${E.formatarNumero(Math.round(p.porHora))}/h**`;

  // Cargo do departamento × produção de verdade: quem tem o cargo e não produz, e quem produz sem ter
  const area = socios.length ? await require('../departamentos/repositorio').buscarDepartamento('farm') : null;
  const membrosFarm = area?.cargo_membro_id ? socios.filter(s => s.membro.roles.cache.has(area.cargo_membro_id)) : [];
  const cruzamento = area?.cargo_membro_id ? R.farmCargoVsProducao(membrosFarm, total) : null;
  const porIdFivem = new Map(socios.filter(s => s.idFivem).map(s => [s.idFivem, s]));

  return embed('🌾 FARM: PRODUTIVIDADE E CONCENTRAÇÃO (28 DIAS)', {
    description: [
      `Total guardado: **${E.formatarNumero(Math.round(conc.total))}** por **${conc.pessoas}** pessoa(s).`,
      conc.total ? `As ${R.LIMITES.concentracaoTop} maiores respondem por **${pct(conc.participacao)}**${conc.alerta ? ' — produção muito concentrada: se elas param, o farm cai' : ''}.` : '',
    ].filter(Boolean).join('\n'),
    fields: [
      ...F.campoLista('MAIS PRODUTIVOS POR HORA JOGADA', produtividade.slice(0, 8).map(fmt), 'Sem dados.', { numerar: false }),
      ...F.campoLista('MENOS PRODUTIVOS (COM 1 H+ DE JOGO)', produtividade.slice(-5).reverse().map(fmt), 'Sem dados.', { numerar: false }),
      ...(cruzamento ? [
        ...F.campoLista(`COM O CARGO E SEM PRODUÇÃO (${cruzamento.semProducao.length}/${membrosFarm.length})`,
          cruzamento.semProducao.map(m => `<@${m.discordId}>`), 'Todos produziram.', { numerar: false }),
        ...F.campoLista('PRODUZEM SEM TER O CARGO',
          cruzamento.producaoSemCargo.slice(0, 8).map(l => `${porIdFivem.get(l.id) ? `<@${porIdFivem.get(l.id).discordId}>` : `ID ${l.id}`} — ${E.formatarNumero(Math.round(l.quantidade))}`),
          'Ninguém de fora produziu.', { numerar: false }),
      ] : []),
    ],
    footer: { text: F.rodape('logs-baú + logs-painel') },
  });
}

// ── Eventos, território, tickets, departamentos ──────────────────────────────

// Presença marcada × quem estava online no jogo 15 min depois do início. Presença sem estar no jogo
// pode ser evento fora do jogo (caravana), então é pista, não acusação. Também conta os sócios que
// estavam jogando e nem confirmaram: público que o evento não alcançou.
async function presencaDosEventos(socios) {
  const P = require('../logsJogo/presenca');
  const limite = config.logsJogo.presencaSessaoMaxHoras * R.HORA_MS;
  const porDiscord = new Map(socios.map(s => [s.discordId, s]));
  const linhas = [];
  for (const ev of await repo.eventosComPresenca(30, 6)) {
    const instante = new Date(new Date(ev.inicio_em).getTime() + 15 * 60 * 1000);
    if (instante > new Date() || !ev.presentes.length) continue;
    const estado = await logs.estadoDosJogadores(instante);
    const online = new Set(P.listaOnline(P.estadoSemSessoesExpiradas(estado, limite, instante)).map(e => e.id));
    const conf = R.presencaConferida(ev.presentes.map(d => porDiscord.get(d)?.idFivem), online);
    const confirmados = new Set(ev.confirmados);
    const semConfirmar = socios.filter(s => s.idFivem && online.has(s.idFivem) && !confirmados.has(s.discordId)).length;
    linhas.push(`**${F.nomeSeguro(ev.titulo)}** (<t:${Math.floor(new Date(ev.inicio_em).getTime() / 1000)}:d>) — ${conf.noJogo}/${conf.conferiveis} presentes estavam online (${pct(conf.taxa)}) · ${semConfirmar} sócio(s) jogando sem ter confirmado`);
  }
  return linhas;
}

async function embedEventos({ socios = [] } = {}) {
  const [noShow, porHora] = await Promise.all([repo.noShowPorPessoa(60), repo.eventosPorHora(60)]);
  const faltosos = noShow.filter(l => l.faltou >= 2).slice(0, 8)
    .map(l => `<@${l.discord_id}> — faltou a **${l.faltou}** de ${l.confirmou} eventos que confirmou (${pct(l.faltou / l.confirmou)})`);
  const horas = porHora.filter(h => h.confirmados > 0)
    .sort((a, b) => (b.presentes / b.confirmados) - (a.presentes / a.confirmados))
    .map(h => `${hora(h.hora)} — ${h.eventos} evento(s), presença ${pct(h.presentes / h.confirmados)} dos confirmados`);
  const conferidos = socios.length ? await presencaDosEventos(socios) : [];
  return embed('🎉 EVENTOS: FALTAS E MELHORES HORÁRIOS (60 DIAS)', {
    fields: [
      ...(conferidos.length ? F.campoLista('PRESENÇA CONFERIDA PELO JOGO (ÚLTIMOS EVENTOS)', conferidos, '', { numerar: false }) : []),
      ...F.campoLista('CONFIRMA E NÃO APARECE', faltosos, 'Ninguém com 2+ faltas.', { numerar: false }),
      ...F.campoLista('PRESENÇA POR HORÁRIO (MELHOR PRIMEIRO)', horas, 'Sem eventos com confirmação no período.', { numerar: false }),
    ],
    footer: { text: 'Discord (eventos e presença)' },
  });
}

async function embedTerritorio() {
  const [conquistas, entradas] = await Promise.all([repo.conquistasPorHora(30), repo.entradasPorHora(30)]);
  const risco = R.horasDeRisco(conquistas, entradas.map(e => ({ hora: e.hora, media: e.media })));
  const topConquistas = [...conquistas].sort((a, b) => b.total - a.total).slice(0, 5);
  return embed('🗺️ TERRITÓRIO × PRESENÇA (30 DIAS)', {
    description: 'O jogo não avisa quando perdemos um território, então o cruzamento é entre **quando conquistamos** e **quando há gente entrando**.',
    fields: [
      ...F.campoLista('HORAS COM MAIS CONQUISTAS', topConquistas.map(c => `${hora(c.hora)} — ${c.total} conquista(s)`), 'Sem conquistas no período.', { numerar: false }),
      ...F.campoLista('CONQUISTA COM POUCA GENTE (DEFESA FRÁGIL)', risco.map(r => `${hora(r.hora)} — ${r.conquistas} conquista(s), média de ${r.online.toFixed(1)} entradas/dia`), 'Nenhuma hora de risco.', { numerar: false }),
    ],
    footer: { text: F.rodape('logs-banco + logs-painel') },
  });
}

async function embedTickets() {
  const linhas = (await require('../ticketRegistro').resumo(60)).map(t => {
    const resposta = t.resposta_seg == null ? 'sem resposta medida' : `1ª resposta em ${E.formatarDuracao(t.resposta_seg * 1000)}`;
    const duracao = t.duracao_seg == null ? '' : ` · dura ${E.formatarDuracao(t.duracao_seg * 1000)}`;
    return `**${F.nomeSeguro(t.categoria)}** — ${t.total} aberto(s), ${t.fechados} fechado(s) · ${resposta}${duracao}`;
  });
  return embed('🎫 TICKETS (60 DIAS)', {
    description: linhas.length ? linhas.join('\n') : 'Nenhum ticket registrado desde que o registro começou.',
    footer: { text: 'Discord (tickets)' },
  });
}

async function embedDepartamentos(client, { tempoJogadoPorId, socios }) {
  const { listarDepartamentos } = require('../departamentos/repositorio');
  const periodo = { chave: '14d', rotulo: '14 DIAS', inicio: new Date(Date.now() - 14 * R.DIA_MS), fim: new Date() };
  const [areas, tempo] = await Promise.all([listarDepartamentos({ apenasAtivos: true }), tempoJogadoPorId(periodo)]);
  const linhas = areas.map(area => {
    const membros = socios.filter(s => s.membro.roles.cache.has(area.cargo_membro_id));
    const comId = membros.filter(s => s.idFivem);
    const ativos = comId.filter(s => (tempo.get(s.idFivem)?.ms ?? 0) >= R.HORA_MS);
    const gestor = socios.find(s => s.membro.roles.cache.has(area.cargo_gestor_id));
    const taxa = comId.length ? ativos.length / comId.length : null;
    const gestorInativo = Boolean(gestor?.idFivem) && (tempo.get(gestor.idFivem)?.ms ?? 0) < R.HORA_MS;
    return { area, total: membros.length, semId: membros.length - comId.length, ativos: ativos.length, taxa, gestor, gestorInativo };
  }).sort((a, b) => (a.taxa ?? 2) - (b.taxa ?? 2));
  return embed('🏛️ SAÚDE DOS DEPARTAMENTOS (14 DIAS)', {
    description: 'Ativo = jogou 1 h ou mais nos últimos 14 dias. Os de menor participação vêm primeiro.',
    fields: F.campoLista('DEPARTAMENTOS', linhas.map(l =>
      `${l.area.emoji} **${l.area.nome}** — ${l.ativos}/${l.total - l.semId} ativos (${pct(l.taxa)})${l.semId ? ` · ${l.semId} sem ID no apelido` : ''} · gestor: ${l.gestor ? `<@${l.gestor.discordId}>${l.gestorInativo ? ' ⚠️ sem jogar há 14 dias' : ''}` : '**sem gestor**'}`),
    'Nenhum departamento ativo.', { numerar: false }),
    footer: { text: F.rodape('logs-painel + cargos do Discord') },
  });
}

// ── Retenção, cobertura e disciplina ─────────────────────────────────────────

async function embedRetencao() {
  const [coortes, saidas] = await Promise.all([repo.coortesDeRecrutamento(150), repo.saidasComContexto(90)]);
  const linhasCoorte = R.retencaoDasCoortes(coortes).map(c =>
    `**${c.mes}** — ${c.total} recrutado(s) · ficaram 7 dias: ${pct(c.d7)} (de ${c.maduros7}) · ficaram 30 dias: ${pct(c.d30)} (de ${c.maduros30})`);
  const perfil = R.perfilDasSaidas(saidas);
  const rotuloSaida = { saiu_torcida: 'saíram por conta própria', expulso_torcida: 'foram expulsos', removido_torcida_automatico: 'removidos por inatividade' };
  return embed('🚪 RETENÇÃO: QUEM FICA E POR QUE SAI', {
    description: 'Coorte = mês em que a pessoa foi recrutada no jogo. "Ficou" = não saiu, não foi expulsa nem removida no prazo. Só entram os recrutados que já completaram o prazo.',
    fields: [
      ...F.campoLista('COORTES DE RECRUTAMENTO', linhasCoorte, 'Sem recrutamentos no período.', { numerar: false }),
      { name: `SAÍDAS EM 90 DIAS (${perfil.total})`, value: perfil.total
        ? Object.entries(perfil.porTipo).map(([a, n]) => `${n} ${rotuloSaida[a] ?? a}`).join(' · ')
          + `\n**${perfil.comProblema}** (${pct(perfil.comProblema / perfil.total)}) tiveram ADV ou restrição nos 30 dias antes de sair`
        : 'Nenhuma saída registrada.' },
      ...F.campoLista('TEMPO DE CASA NA SAÍDA', perfil.faixas.map(([rotulo, n]) => `${rotulo}: **${n}**`), 'Sem saídas.', { numerar: false }),
    ],
    footer: { text: F.rodape('logs-registros') },
  });
}

async function embedCobertura({ recrutadoresIds }) {
  const [fichas, recrutadores] = await Promise.all([repo.fichasPorHora(30), repo.entradasDeIdsPorHora(recrutadoresIds, 30)]);
  const buracos = R.buracosDeCobertura(fichas, recrutadores);
  const topFichas = [...fichas].sort((a, b) => b.media - a.media).slice(0, 4);
  return embed('🕒 COBERTURA DO RECRUTAMENTO (30 DIAS)', {
    description: 'Cruza a hora em que os candidatos mandam ficha com a hora em que os recrutadores entram no jogo. Ficha que chega sem recrutador por perto espera, e candidato que espera desiste.',
    fields: [
      ...F.campoLista('HORAS COM MAIS FICHAS', topFichas.map(f => `${hora(f.hora)} — ${f.media.toFixed(1)} ficha(s)/dia`), 'Sem fichas no período.', { numerar: false }),
      ...F.campoLista('FICHA CHEGANDO SEM RECRUTADOR (BURACO)', buracos.map(b => `${hora(b.hora)} — ${b.fichas.toFixed(1)} ficha(s)/dia, ${b.recrutadores.toFixed(1)} entrada(s) de recrutador/dia`), 'Nenhum horário descoberto.', { numerar: false }),
    ],
    footer: { text: 'Discord (fichas) + logs-painel (entradas)' },
  });
}

async function embedDisciplina() {
  const advs = await repo.advSocioEfetividade(180);
  const ef = R.efetividadeDeAdv(advs);
  const status = Object.entries(ef.porStatus).map(([st, n]) => `${n} ${st.toLowerCase().replace('_', ' ')}`).join(' · ');
  return embed('🧾 A ADVERTÊNCIA FUNCIONA? (180 DIAS)', {
    description: ef.total
      ? [
        `**${ef.total}** advertência(s) de sócio: ${status}.`,
        ef.taxaPagaNoPrazo == null ? null : `Pagas no prazo (as que exigem pagamento): **${pct(ef.taxaPagaNoPrazo)}**.`,
        `Quem tomou ADV e **saiu em 30 dias**: **${pct(ef.taxaSaiu30)}**.`,
        `Quem tomou ADV e **teve outra ADV ou restrição em 60 dias**: **${pct(ef.taxaReincidiu60)}**.`,
      ].filter(Boolean).join('\n')
      : 'Nenhuma advertência de sócio no período.',
    fields: F.campoLista('QUEM REGISTROU', ef.aplicadores.slice(0, 10).map(a => `${/^\d{15,}$/.test(a.id) ? `<@${a.id}>` : F.nomeSeguro(a.id)} — ${a.total}`), 'Sem registros.', { numerar: false }),
    footer: { text: 'Discord (advertências) + logs do jogo (saídas e restrições). Advertência recente ainda pode entrar na conta.' },
  });
}

// ── Patrimônio e finanças (seções opcionais: só existem com o módulo ligado) ─

async function opcional(fn) {
  try {
    return await fn();
  } catch (err) {
    if (/does not exist|relation/i.test(String(err?.message))) return null; // módulo desligado: a tabela não existe
    throw err;
  }
}

async function embedPatrimonio() {
  const [fora, atrasados] = await Promise.all([
    repo.patrimonioForaDoBau(), opcional(() => require('../patrimonio/inteligencia').emprestimosAtrasados(7)),
  ]);
  const nomes = await nomesDe([...new Set(fora.map(f => f.ator_id_fivem).filter(Boolean))]);
  const foraTexto = fora.slice(0, 15).map(f =>
    `**${F.nomeSeguro(f.item)}** — com ${F.nomeSeguro(nomes.get(f.ator_id_fivem) ?? '?')} (${f.ator_id_fivem ?? '?'}) desde <t:${Math.floor(new Date(f.em).getTime() / 1000)}:R>`);
  return embed('🚩 PATRIMÔNIO: ONDE ESTÁ CADA PEÇA', {
    description: 'Estado deduzido do último movimento de cada peça no baú do jogo (o jogo publica evento, não estado): se o último foi "retirou", a peça está fora.',
    fields: [
      ...F.campoLista(`FORA DO BAÚ AGORA (${fora.length})`, foraTexto, 'Todas as peças registradas estão no baú.', { numerar: false }),
      ...(atrasados ? F.campoLista('EMPRÉSTIMOS ABERTOS HÁ MAIS DE 7 DIAS (DISCORD)', atrasados.slice(0, 10).map(a =>
        `${F.nomeSeguro(a.nome)} — <@${a.discord_id}> desde <t:${Math.floor(new Date(a.saiu_em).getTime() / 1000)}:R>`), 'Nenhum atrasado.', { numerar: false }) : []),
    ],
    footer: { text: F.rodape('logs-baú') + (atrasados ? ' + empréstimos do Discord' : '') },
  });
}

async function embedFinancas() {
  const [balanco, loja, rifas] = await Promise.all([
    opcional(() => require('../financeiro/inteligencia').balanco()),
    opcional(() => require('../loja/inteligencia').atendimento(60)),
    opcional(() => require('../rifas/inteligencia').panorama()),
  ]);
  const fields = [];
  if (balanco) {
    const soma = (campo) => balanco.reduce((t, l) => t + l[campo], 0);
    const saldo = soma('receita') - soma('despesa');
    const saldoAnt = soma('receita_ant') - soma('despesa_ant');
    fields.push({
      name: 'LIVRO-CAIXA (30 DIAS × 30 ANTERIORES)',
      value: `Receita **${E.formatarDinheiro(soma('receita'))}** · despesa **${E.formatarDinheiro(soma('despesa'))}** · saldo **${E.formatarDinheiro(saldo)}** (antes: ${E.formatarDinheiro(saldoAnt)})`,
    });
    const maiores = [...balanco].sort((a, b) => b.despesa - a.despesa).filter(l => l.despesa > 0).slice(0, 4);
    if (maiores.length) fields.push(...F.campoLista('MAIORES DESPESAS', maiores.map(l => `${F.nomeSeguro(l.categoria)} — ${E.formatarDinheiro(l.despesa)} (antes: ${E.formatarDinheiro(l.despesa_ant)})`), '', { numerar: false }));
  }
  if (loja) {
    fields.push({
      name: 'LOJA (60 DIAS)',
      value: `${loja.confirmados} confirmado(s) · ${loja.cancelados} cancelado(s) · decisão em ${loja.decisao_seg == null ? '—' : E.formatarDuracao(loja.decisao_seg * 1000)}`
        + (loja.parados ? `\n⚠️ **${loja.parados}** pedido(s) pendente(s) há mais de 24 h` : ''),
    });
  }
  if (rifas) {
    const lucro = rifas.sorteadas.filter(r => r.custo != null).map(r => ({ ...r, margem: r.arrecadado - r.custo }));
    if (lucro.length) {
      fields.push({
        name: 'RIFAS SORTEADAS (180 DIAS)',
        value: `${lucro.length} rifa(s): arrecadado **${E.formatarDinheiro(lucro.reduce((t, r) => t + r.arrecadado, 0))}**, margem sobre o prêmio **${E.formatarDinheiro(lucro.reduce((t, r) => t + r.margem, 0))}**`
          + (lucro.some(r => r.margem < 0) ? `\n⚠️ ${lucro.filter(r => r.margem < 0).length} deu prejuízo` : ''),
      });
    }
    if (rifas.emRisco.length) {
      fields.push(...F.campoLista('RIFAS QUE PODEM NÃO FECHAR (ENCERRA EM 3 DIAS COM MENOS DE 50% VENDIDO)', rifas.emRisco.map(r =>
        `${F.nomeSeguro(r.titulo)} — ${r.vendidos}/${r.total_numeros} vendidos`), '', { numerar: false }));
    }
  }
  return embed('💰 FINANÇAS DA TORCIDA', {
    description: fields.length ? 'Tudo em dinheiro do jogo.' : 'Nenhum módulo financeiro ligado (livro-caixa, loja ou rifas).',
    fields,
    footer: { text: 'Discord (livro-caixa, loja, rifas)' },
  });
}

// ── Casos: a utilidade dos próprios alertas ───────────────────────────────────

async function embedCasos() {
  const casos = require('./casos');
  const [metricas, abertos] = await Promise.all([casos.metricas(90), casos.abertos()]);
  const linhas = metricas.map(m => {
    const demora = m.mediana_seg == null ? '—' : E.formatarDuracao(m.mediana_seg * 1000);
    return `**${casos.ROTULOS[m.tipo] ?? m.tipo}** — ${m.total} caso(s): ${m.resolvidos} resolvido(s) (${m.automaticos} sozinho), ${m.ignorados} ignorado(s), ${m.expirados} expirado(s), ${m.abertos} aberto(s) · resolve em ${demora}`;
  });
  const achados = R.avaliarUtilidadeDosAlertas(metricas).map(a => `${a.gravidade === 'ruido' ? '📢' : '⏳'} **${casos.ROTULOS[a.tipo] ?? a.tipo}**: ${a.texto}`);
  const fila = abertos.slice(0, 10).map(c =>
    `${casos.ROTULOS[c.tipo] ?? c.tipo} — aberto <t:${Math.floor(new Date(c.aberto_em).getTime() / 1000)}:R>${c.alvo_discord_id ? ` · <@${c.alvo_discord_id}>` : ''}${c.canal_id && c.message_id ? ` · [abrir](https://discord.com/channels/${config.guildId}/${c.canal_id}/${c.message_id})` : ''}`);
  return embed('🗂️ CASOS DA INTELIGÊNCIA (90 DIAS)', {
    description: 'Cada alerta vira um caso: aberto até alguém resolver, ignorar ou a condição sumir sozinha. Aqui se vê o que os alertas rendem.',
    fields: [
      ...F.campoLista('POR TIPO', linhas, 'Nenhum caso aberto no período.', { numerar: false }),
      ...F.campoLista('O QUE OS NÚMEROS SUGEREM', achados, 'Nada a ajustar por enquanto.', { numerar: false }),
      ...F.campoLista(`FILA ABERTA AGORA (${abertos.length})`, fila, 'Nenhum caso aberto.', { numerar: false }),
    ],
    footer: { text: 'Discord (alertas da inteligência)' },
  });
}

// ── Liderança ────────────────────────────────────────────────────────────────

async function embedLideranca() {
  const [restr, mov] = await Promise.all([repo.restricoesPorEvento(30), repo.movimentosDeCargo(30)]);
  const ficha = R.consistenciaDaLideranca(restr, mov).slice(0, 12);
  const nomes = await nomesDe(ficha.map(f => f.id));
  const linhas = ficha.map(f => {
    const sinais = [
      f.removeuRapido ? `${f.removeuRapido} restrição(ões) desfeita(s) em até 10 min pelo próprio` : null,
      f.promocoesEmRajada ? `${f.promocoesEmRajada} rajada(s) de ${R.LIMITES.promocoesEmRajada}+ promoções/rebaixamentos em 1 h` : null,
    ].filter(Boolean).join(' · ');
    return `${f.alerta ? '⚠️ ' : ''}**${F.nomeSeguro(nomes.get(f.id) ?? '?')}** (${f.id}) — ${f.acoes} ação(ões)${sinais ? ` — ${sinais}` : ''}`;
  });
  return embed('🧭 CONSISTÊNCIA DA LIDERANÇA (30 DIAS)', {
    description: 'Padrões que merecem uma conversa, não uma conclusão: restrição colocada e retirada logo em seguida pelo mesmo líder, e promoções em rajada. Só a presidência vê isto.',
    fields: F.campoLista('QUEM MAIS AGIU', linhas, 'Sem ações de liderança no período.', { numerar: false }),
    footer: { text: F.rodape('logs-registros') },
  });
}

// ── Manto (provar-manto) ────────────────────────────────────────────────────

async function embedManto(dias = 30) {
  const mantos = require('../recrutamento/mantoRepositorio');
  const { rotuloMotivo } = require('../recrutamento/mantoRegras');
  const [r, placar, avaliadores] = await Promise.all([mantos.resumoDoPeriodo(dias), mantos.placarPorRecrutador(), mantos.desempenhoAvaliadores(dias)]);
  const avaliadas = r.corretos + r.errados;
  const piores = placar.filter(l => l.recrutador_id && l.erros > 0).sort((a, b) => b.erros - a.erros).slice(0, 5);
  const fields = [
    {
      name: `FOTOS (${dias} DIAS)`,
      value: `${tema.emoji.ok} corretas: **${r.corretos}** · ${tema.emoji.recusado} erradas: **${r.errados}**${avaliadas ? ` (${pct(r.corretos / avaliadas)} de acerto)` : ''}
`
        + `Aguardando avaliação: **${r.pendentes}** · Casos abertos: **${r.casos_abertos}**
`
        + (r.media_s == null ? 'Sem avaliações no período.' : `Tempo médio até a avaliação: **${E.formatarDuracao(Math.round(r.media_s * 1000))}**`),
    },
    ...F.campoLista('MOTIVOS DOS ERROS', r.motivos.map(m => `${rotuloMotivo(m.motivo)}: **${m.total}**`), 'Nenhum manto errado no período.', { numerar: false }),
    ...F.campoLista('MAIS ERROS (RECRUTADORES)', piores.map(l => `<@${l.recrutador_id}> — **${l.erros}** erro(s), ${l.acertos} acerto(s)`), 'Nenhum erro atribuído a recrutador.', { numerar: false }),
    ...F.campoLista('AVALIADORES', avaliadores.map(a => `<@${a.avaliado_por_id}> — **${a.total}** · média ${E.formatarDuracao(Math.round(a.media_s * 1000))}`), 'Ninguém avaliou no período.', { numerar: false }),
  ];
  return embed('🧥 MANTO: ACERTOS, ERROS E CASOS', {
    description: 'Fotos do provar-manto avaliadas pela liderança. Erro **recuperado** (candidato mandou depois uma foto correta) e ficha reprovada não contam contra o recrutador.',
    fields,
    footer: { text: 'Discord (provar-manto, fichas) · só informa' },
  });
}

module.exports = {
  embedManto, embedRisco, embedFichaAssociado, embedEsfriando, embedRecrutamento, embedContribuicao, embedFarm,
  embedEventos, embedTerritorio, embedTickets, embedDepartamentos, embedLideranca,
  embedRetencao, embedCobertura, embedDisciplina, embedPatrimonio, embedFinancas, embedCasos, recrutadoresIdsDe,
};

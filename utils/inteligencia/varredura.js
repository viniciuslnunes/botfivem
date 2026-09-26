// Varredura periódica da inteligência cruzada (a cada 3 h): recalcula o resumo de cada sócio e
// dispara os alertas que dependem de cruzar fontes. Só avisa (quem decide é a liderança), nunca
// pune. Cada etapa é uma função separada e falha sozinha: uma etapa com erro não derruba as outras.
// Debounce de cada alerta em alertas_enviados (sobrevive a reinício).
const config = require('../../config/index.js');
const tema = require('../../tema');
const { jaAlertadoRecentemente } = require('../alertaPersistente');
const { mencoesDaEquipe, cargosDaEquipe } = require('../permissoes');
const F = require('../logsJogo/painelFormato');
const R = require('./regras');
const repo = require('./repositorio');
const { garantirCanalInteligencia, mencoesLideranca } = require('./canais');
const casos = require('./casos');
const { enviar } = casos;

const INTERVALO_MS = 3 * R.HORA_MS;
const ATRASO_INICIAL_MS = 4 * 60 * 1000;

const permitir = cargos => ({ roles: cargos.filter(Boolean) });
const segundos = data => Math.floor(new Date(data).getTime() / 1000);

// Sem log recente não dá para separar "não aconteceu" de "o jogo parou de mandar log"
async function fonteViva(agora) {
  const logs = require('../logsJogo/repositorio');
  const ultima = await logs.ultimaOcorrencia(['jogador_recrutou', 'jogador_entrou', 'jogador_saiu']);
  return Boolean(ultima) && agora - new Date(ultima) <= config.logsJogo.fonteParadaDias * R.DIA_MS;
}

// ── Etapas (cada uma devolve quantos alertas enviou) ─────────────────────────

// Reincidência: 2+ ocorrências em 90 dias. A chave leva a contagem: só avisa de novo se piorar.
// Só dispara quando a ocorrência mais recente é da última semana: na 1ª varredura o histórico
// antigo não vira uma enxurrada de alertas (ele continua no ranking de risco).
async function alertarReincidencia(canal, resumos, agora = new Date()) {
  let enviados = 0;
  const recente = x => x.dados.ultimaOcorrenciaEm && agora - new Date(x.dados.ultimaOcorrenciaEm) <= 7 * R.DIA_MS;
  for (const r of resumos.filter(x => x.dados.reincidente && recente(x))) {
    const chave = `${r.socio.discordId}:${r.dados.ocorrencias90}`;
    if (await jaAlertadoRecentemente('reincidencia', chave, 90 * R.DIA_MS)) continue;
    await enviar(canal, { tipo: 'reincidencia', chave, alvoDiscordId: r.socio.discordId }, {
      content: mencoesLideranca(),
      allowedMentions: permitir(config.lideranca),
      embeds: [{
        color: tema.cor.perigo,
        title: '🔁 SÓCIO REINCIDENTE',
        description: `<@${r.socio.discordId}> acumulou **${r.dados.ocorrencias90}** ocorrências em ${R.LIMITES.reincidenciaDias} dias (advertência de sócio, blacklist, suspensão ou impedimento).`,
        fields: [
          { name: 'RISCO', value: `${r.risco.score} — ${r.risco.nivel}`, inline: true },
          { name: 'ADV ATIVAS', value: String(r.dados.advAtivas), inline: true },
          { name: 'RESTRIÇÕES ATIVAS', value: r.dados.restricoesAtivas.length ? r.dados.restricoesAtivas.join(', ') : 'nenhuma', inline: true },
          ...(r.dados.fatores.length ? [{ name: 'FATORES', value: r.dados.fatores.join('\n') }] : []),
        ],
        footer: { text: 'Cruzamento automático: advertências do Discord + restrições do jogo. A liderança decide.' },
        timestamp: new Date().toISOString(),
      }],
    });
    enviados++;
  }
  return enviados;
}

// Blacklist ativa no jogo sem o ID em "não recrutar": a barreira do Discord não sabe do banimento
// Só blacklists dos últimos 30 dias: o ID troca a cada season, então as antigas são de outra
// "encarnação" do jogador e inundariam o canal na 1ª varredura. Marca como avisado só o que foi listado.
async function alertarBlacklistSemBloqueio(canal, blacklistsAtivas, idsBloqueados, nomes, agora = new Date()) {
  const faltando = blacklistsAtivas.filter(b => !idsBloqueados.has(b.id_fivem) && agora - new Date(b.em) <= 30 * R.DIA_MS);
  let enviados = 0;
  for (const b of faltando) {
    if (enviados >= 10) break; // uma mensagem por ID (cada uma com o botão de bloquear); o resto sai na próxima varredura
    if (await jaAlertadoRecentemente('blacklist_sem_bloqueio', b.id_fivem, 30 * R.DIA_MS)) continue;
    await enviar(canal, { tipo: 'blacklist_sem_bloqueio', chave: b.id_fivem, dados: { idFivem: b.id_fivem }, acoes: ['bloquear'] }, {
      content: enviados === 0 ? mencoesDaEquipe() : undefined, // só a 1ª chama a equipe; as outras não repetem o ping
      allowedMentions: permitir(cargosDaEquipe()),
      embeds: [{
        color: tema.cor.perigo,
        title: '🚫 BLACKLIST NO JOGO SEM BLOQUEIO EM "NÃO RECRUTAR"',
        description: `O ID \`${b.id_fivem}\` (${F.nomeSeguro(nomes.get(b.id_fivem) ?? '?')}) está na blacklist do jogo desde <t:${segundos(b.em)}:d> e **não está bloqueado** aqui. Sem o bloqueio, a ficha dele pode ser aprovada.`,
        footer: { text: 'O botão abre o bloqueio já com o ID; o caso fecha sozinho quando o ID entrar na lista' },
        timestamp: new Date().toISOString(),
      }],
    });
    enviados++;
  }
  return enviados;
}

// Recrutou no jogo e não há ficha aprovada no Discord (nem no prazo de a ficha ser analisada)
async function alertarRecrutouSemFicha(canal, recrutamentos, idsComFicha, nomes, agora) {
  const candidatos = recrutamentos.filter(r => {
    const idade = agora - new Date(r.em);
    return idade >= 2 * R.HORA_MS && idade <= 3 * R.DIA_MS;
  });
  const semFicha = R.recrutouSemFicha(candidatos, idsComFicha);
  const novos = [];
  for (const r of semFicha) {
    if (novos.length >= 15) break; // o que não coube fica para a próxima varredura (não é marcado)
    if (await jaAlertadoRecentemente('recrutou_sem_ficha', r.id, 30 * R.DIA_MS)) continue;
    novos.push(r);
  }
  if (!novos.length) return 0;
  await enviar(canal, { tipo: 'recrutou_sem_ficha', chave: `lote:${novos.map(r => r.id).join(',')}`.slice(0, 200), dados: { ids: novos.map(r => r.id) } }, {
    content: mencoesDaEquipe(),
    allowedMentions: permitir(cargosDaEquipe()),
    embeds: [{
      color: tema.cor.aviso,
      title: '📋 RECRUTADO NO JOGO SEM FICHA APROVADA',
      description: 'O jogo registrou o recrutamento, mas não existe ficha **aprovada** no Discord para o ID. Pode ser ficha em análise, ID digitado errado ou setagem fora do fluxo.',
      fields: F.campoLista('RECRUTAMENTOS', novos.map(r =>
        `\`${r.id}\` ${F.nomeSeguro(r.nome ?? '?')} — por ${F.nomeSeguro(nomes.get(r.recrutador_id) ?? '?')} (${r.recrutador_id ?? '?'}) <t:${Math.floor(new Date(r.em).getTime() / 1000)}:R>`), 'Nenhum.', { numerar: false }),
      footer: { text: 'Cruzamento: jogador_recrutou (jogo) × fichas aprovadas (Discord)' },
      timestamp: new Date().toISOString(),
    }],
  });
  return novos.length;
}

async function alertarFichasParadas(canal, fichas, agora) {
  const { paradas } = R.slaDasFichas(fichas, agora);
  let enviados = 0;
  for (const f of paradas) {
    if (enviados >= 8) break;
    if (await jaAlertadoRecentemente('ficha_parada', f.message_id, 24 * R.HORA_MS)) continue;
    await enviar(canal, { tipo: 'ficha_parada', chave: f.message_id, alvoDiscordId: f.discord_id, dados: { fichaId: f.message_id } }, {
      content: mencoesDaEquipe(), // canal dedicado: todo registro novo chama a equipe
      allowedMentions: permitir(cargosDaEquipe()),
      embeds: [{
        color: tema.cor.aviso,
        title: '⏳ FICHA PARADA NA ANÁLISE',
        description: `<@${f.discord_id}> (${F.nomeSeguro(f.nome ?? '?')}) · ID ${f.id_fivem ?? '?'} · pendente desde <t:${segundos(f.criado_em)}:R> (limite: ${R.LIMITES.fichaParadaHoras} h). Candidato esperando é candidato desistindo.\n[abrir a ficha](https://discord.com/channels/${config.guildId}/${config.canais.validarSetagem}/${f.message_id})`,
        footer: { text: 'O caso fecha sozinho quando a ficha for decidida' },
        timestamp: new Date().toISOString(),
      }],
    });
    enviados++;
  }
  return enviados;
}

// Sede/portão destrancado há muito tempo e ninguém online para vigiar
async function alertarSedeSemVigia(canal, fechaduras, online, agora) {
  const abertas = R.fechaduraSemVigia(fechaduras, online, agora);
  const novas = [];
  for (const f of abertas) {
    if (await jaAlertadoRecentemente('sede_sem_vigia', `${f.rotulo}:${new Date(f.desde).toISOString()}`, 12 * R.HORA_MS)) continue;
    novas.push(f);
  }
  if (!novas.length) return 0;
  await enviar(canal, { tipo: 'sede_sem_vigia', chave: novas.map(f => f.rotulo).join(',') }, {
    content: mencoesLideranca(),
    allowedMentions: permitir(config.lideranca),
    embeds: [{
      color: tema.cor.perigo,
      title: '🔓 PATRIMÔNIO DESTRANCADO SEM NINGUÉM ONLINE',
      description: novas.map(f => `**${f.rotulo}** destrancado desde <t:${Math.floor(new Date(f.desde).getTime() / 1000)}:R>${f.por ? ` por ${F.nomeSeguro(f.por)}` : ''}`).join('\n')
        + '\n\nNenhum jogador conectado agora.',
      footer: { text: F.rodape('logs-registros + logs-painel') },
      timestamp: new Date().toISOString(),
    }],
  });
  return novas.length;
}

// Retirada do baú muito acima do padrão da PRÓPRIA pessoa (4× a mediana dela, com histórico): quem
// sempre tira muito não dispara; quem quase nunca tirava e levou de uma vez, sim. Liderança fica de fora.
async function alertarRetiradaAtipica(canal, retiradas, historico, nomes, porIdFivem) {
  const hist = new Map(historico.map(h => [`${h.id}|${h.item}`, h]));
  const { ehLideranca } = require('../permissoes');
  const novas = [];
  for (const r of retiradas) {
    if (novas.length >= 10) break;
    if (ehLideranca(porIdFivem.get(r.id)?.membro)) continue;
    if (!R.retiradaAtipica(r, hist.get(`${r.id}|${String(r.item ?? '').toLowerCase()}`))) continue;
    if (await jaAlertadoRecentemente('retirada_atipica', `${r.id}:${r.item}:${new Date(r.em).toISOString()}`, 7 * R.DIA_MS)) continue;
    novas.push({ ...r, mediana: hist.get(`${r.id}|${String(r.item ?? '').toLowerCase()}`).mediana });
  }
  if (!novas.length) return 0;
  await enviar(canal, { tipo: 'retirada_atipica', chave: `lote:${novas.map(r => r.id).join(',')}`.slice(0, 200) }, {
    content: mencoesLideranca(),
    allowedMentions: permitir(config.lideranca),
    embeds: [{
      color: tema.cor.aviso,
      title: '📦 RETIRADA FORA DO PADRÃO DA PRÓPRIA PESSOA',
      description: 'Cada retirada abaixo é pelo menos 4× a mediana do que a mesma pessoa costuma tirar do mesmo item. Pode ser uso legítimo; vale conferir.',
      fields: F.campoLista('RETIRADAS', novas.map(r => {
        const dono = porIdFivem.get(r.id);
        return `${dono ? `<@${dono.discordId}>` : F.nomeSeguro(nomes.get(r.id) ?? '?')} (${r.id}) — **${Math.round(r.quantidade)}×** ${F.nomeSeguro(r.item ?? '?')} (costuma tirar ~${Math.round(r.mediana)}) <t:${Math.floor(new Date(r.em).getTime() / 1000)}:R>`;
      }), 'Nenhuma.', { numerar: false }),
      footer: { text: 'Compara a pessoa com ela mesma nos 60 dias anteriores · logs-baú' },
      timestamp: new Date().toISOString(),
    }],
  });
  return novas.length;
}

// Sócio com o nome de alguém que está com restrição ativa sob OUTRO ID: o ID troca a cada season, então
// pode ser a mesma pessoa que voltou com ID novo. Limiar mais alto que na ficha (sócio já foi aprovado).
async function alertarNomeDeRestrito(canal, socios, restricoes, nomes) {
  const { nomeDoNick } = require('../nomes');
  const candidatos = restricoes
    .map(r => ({ id_fivem: r.id_fivem, nome: nomes.get(r.id_fivem) ?? '', rotulo: r.rotulo }))
    .filter(r => r.nome);
  const novos = [];
  for (const socio of socios) {
    if (novos.length >= 10) break;
    const nome = nomeDoNick(socio.membro.nickname ?? socio.nome);
    const achado = R.nomesParecidos(nome, candidatos.filter(c => c.id_fivem !== socio.idFivem), 0.88)[0];
    if (!achado) continue;
    if (await jaAlertadoRecentemente('nome_de_restrito', `${socio.discordId}:${achado.id_fivem}`, 90 * R.DIA_MS)) continue;
    novos.push({ socio, achado });
  }
  if (!novos.length) return 0;
  await enviar(canal, { tipo: 'nome_de_restrito', chave: `lote:${novos.map(n => n.socio.discordId).join(',')}`.slice(0, 200) }, {
    content: mencoesLideranca(),
    allowedMentions: permitir(config.lideranca),
    embeds: [{
      color: tema.cor.aviso,
      title: '🪪 SÓCIO COM NOME DE QUEM ESTÁ COM RESTRIÇÃO',
      description: 'O ID do jogo troca a cada season; o nome é a identidade. Estes sócios têm nome muito parecido com o de um ID que está com restrição ativa. **Pode ser coincidência** — confirme antes de qualquer coisa.',
      fields: F.campoLista('CASOS', novos.map(({ socio, achado }) =>
        `<@${socio.discordId}> (ID ${socio.idFivem ?? '?'}) ≈ **${F.nomeSeguro(achado.nome)}** (ID \`${achado.id_fivem}\`, ${achado.rotulo}) — ${Math.round(achado.score * 100)}%`), 'Nenhum.', { numerar: false }),
      timestamp: new Date().toISOString(),
    }],
  });
  return novos.length;
}

// Empréstimo de patrimônio aberto há mais de 7 dias (peça que saiu e não voltou)
async function alertarEmprestimosAtrasados(canal, atrasados) {
  const novos = [];
  for (const a of atrasados) {
    if (novos.length >= 10) break;
    if (await jaAlertadoRecentemente('emprestimo_atrasado', String(a.id), 3 * R.DIA_MS)) continue;
    novos.push(a);
  }
  if (!novos.length) return 0;
  await enviar(canal, { tipo: 'emprestimo_atrasado', chave: `lote:${novos.map(a => a.id).join(',')}`.slice(0, 200) }, {
    content: mencoesLideranca(),
    allowedMentions: permitir(config.lideranca),
    embeds: [{
      color: tema.cor.aviso,
      title: '🚩 PATRIMÔNIO EMPRESTADO HÁ MAIS DE 7 DIAS',
      fields: F.campoLista('PEÇAS', novos.map(a =>
        `**${F.nomeSeguro(a.nome)}** — <@${a.discord_id}> desde <t:${Math.floor(new Date(a.saiu_em).getTime() / 1000)}:R>`), 'Nenhuma.', { numerar: false }),
      footer: { text: 'Empréstimos registrados no Discord (departamento de patrimônio)' },
      timestamp: new Date().toISOString(),
    }],
  });
  return novos.length;
}

// Saiu, foi expulso ou removido no JOGO e o Discord ainda o trata como sócio: cargo, carteirinha e
// permissões seguem de pé para quem já não é da torcida. Só avisa (a liderança decide o que remover).
async function alertarSaiuMasSegueSocio(canal, saidas, porIdFivem, nomes = new Map()) {
  const rotulo = { saiu_torcida: 'saiu da torcida por conta própria', expulso_torcida: 'foi expulso da torcida', removido_torcida_automatico: 'foi removido por inatividade' };
  let enviados = 0;
  for (const s of saidas) {
    if (enviados >= 8) break;
    const socio = porIdFivem.get(s.id);
    if (!socio) continue; // sem sócio com esse ID no Discord: nada divergente
    if (await jaAlertadoRecentemente('saiu_segue_socio', `${s.id}:${new Date(s.em).toISOString()}`, 14 * R.DIA_MS)) continue;
    await enviar(canal, { tipo: 'saiu_segue_socio', chave: `${s.id}:${new Date(s.em).toISOString()}`, alvoDiscordId: socio.discordId, dados: { idFivem: s.id }, acoes: ['remover_socio'] }, {
      content: enviados === 0 ? mencoesLideranca() : undefined,
      allowedMentions: permitir(config.lideranca),
      embeds: [{
        color: tema.cor.aviso,
        title: '🚪 SAIU NO JOGO, CONTINUA SÓCIO NO DISCORD',
        description: `<@${socio.discordId}> **${F.nomeSeguro(nomes.get(s.id) ?? '?')}** (ID ${s.id}) ${rotulo[s.acao] ?? s.acao} <t:${segundos(s.em)}:R>, e o Discord ainda o trata como sócio. Pode ser troca de conta; confirme antes de remover.`,
        footer: { text: F.rodape('logs-registros') + ' · o caso fecha sozinho quando o cargo sair' },
        timestamp: new Date().toISOString(),
      }],
    });
    enviados++;
  }
  return enviados;
}

// Cargo de recrutador no jogo (promoção/rebaixamento) × cargo no Discord. O jogo manda; o Discord
// acompanha à mão, e é aí que fica cargo sobrando (quem já foi rebaixado ainda recruta) ou faltando.
async function alertarCargoDivergente(canal, movimentos, porIdFivem, agora = new Date()) {
  let enviados = 0;
  for (const m of movimentos) {
    if (enviados >= 8) break;
    if (agora - new Date(m.ocorrido_em) > 30 * R.DIA_MS) continue;
    const socio = porIdFivem.get(m.alvo_id_fivem);
    if (!socio) continue;
    const tem = socio.membro.roles.cache.has(config.cargos.recrutador);
    const promovido = m.acao === 'promoveu_cargo';
    if (promovido === tem) continue; // já está coerente
    const tipo = promovido ? 'falta_cargo' : 'cargo_sobrando';
    const chave = `${tipo}:${m.alvo_id_fivem}:${new Date(m.ocorrido_em).toISOString()}`;
    if (await jaAlertadoRecentemente('cargo_divergente', chave, 14 * R.DIA_MS)) continue;
    await enviar(canal, { tipo: 'cargo_divergente', chave, alvoDiscordId: socio.discordId, dados: { promovido, idFivem: m.alvo_id_fivem }, acoes: ['ajustar_cargo'] }, {
      content: enviados === 0 ? mencoesLideranca() : undefined,
      allowedMentions: permitir(config.lideranca),
      embeds: [{
        color: tema.cor.aviso,
        title: '🔀 CARGO DE RECRUTADOR DIFERENTE ENTRE JOGO E DISCORD',
        description: `<@${socio.discordId}> — ${promovido ? '**promovido no jogo** e **sem** o cargo de recrutador no Discord' : '**rebaixado no jogo** e **ainda com** o cargo de recrutador no Discord'} (<t:${segundos(m.ocorrido_em)}:R>, por ${F.nomeSeguro(m.ator_nome ?? '?')}).`,
        footer: { text: 'O jogo é a referência. O botão alinha o cargo do Discord; o caso fecha sozinho quando bater' },
        timestamp: new Date().toISOString(),
      }],
    });
    enviados++;
  }
  return enviados;
}

// Quem tem cargo de responsabilidade (recrutador, gestor de área, diretoria) e está com ADV séria ou
// restrição ativa: a conduta de quem representa a torcida pesa mais que a de um sócio comum.
async function alertarResponsavelEmRisco(canal, resumos, cargosResponsaveis) {
  const novos = [];
  for (const r of resumos) {
    if (novos.length >= 10) break;
    const cargos = [...cargosResponsaveis.entries()].filter(([id]) => r.socio.membro.roles.cache.has(id)).map(([, rotulo]) => rotulo);
    if (!cargos.length) continue;
    if (!(r.dados.advAtivas >= 2 || r.dados.restricoesAtivas.length > 0)) continue;
    const estado = `adv${r.dados.advAtivas}:${r.dados.restricoesAtivas.join('+')}`;
    if (await jaAlertadoRecentemente('responsavel_em_risco', `${r.socio.discordId}:${estado}`, 14 * R.DIA_MS)) continue;
    novos.push({ ...r, cargos });
  }
  if (!novos.length) return 0;
  await enviar(canal, { tipo: 'responsavel_em_risco', chave: `lote:${novos.map(n => n.socio.discordId).join(',')}`.slice(0, 200) }, {
    content: mencoesLideranca(),
    allowedMentions: permitir(config.lideranca),
    embeds: [{
      color: tema.cor.perigo,
      title: '🎖️ QUEM REPRESENTA A TORCIDA COM CONDUTA EM RISCO',
      description: 'Recrutador, gestor de área ou diretoria com 2+ advertências ativas ou restrição ativa no jogo.',
      fields: F.campoLista('CASOS', novos.map(n =>
        `<@${n.socio.discordId}> (${[...new Set(n.cargos)].join(', ')}) — ${n.dados.advAtivas} ADV ativa(s)${n.dados.restricoesAtivas.length ? ` · ${n.dados.restricoesAtivas.join(', ')} no jogo` : ''}`), 'Nenhum.', { numerar: false }),
      footer: { text: 'Só informa — a liderança decide se o cargo continua' },
      timestamp: new Date().toISOString(),
    }],
  });
  return novos.length;
}

// Carteirinha vencendo de quem está em risco ou esfriando: a renovação é a última chance de conversar
async function alertarRenovacaoEmRisco(canal, carteirinhas, resumosPorDiscord) {
  const novos = [];
  for (const c of carteirinhas) {
    const r = resumosPorDiscord.get(c.discord_id);
    if (!r || !(r.risco.score >= 30 || r.dados.esfriando)) continue;
    if (novos.length >= 10) break;
    if (await jaAlertadoRecentemente('renovacao_em_risco', `${c.discord_id}:${new Date(c.validade).toISOString().slice(0, 10)}`, 14 * R.DIA_MS)) continue;
    novos.push({ ...c, r });
  }
  if (!novos.length) return 0;
  await enviar(canal, { tipo: 'renovacao_em_risco', chave: `lote:${novos.map(n => n.discord_id).join(',')}`.slice(0, 200) }, {
    content: mencoesLideranca(),
    allowedMentions: permitir(config.lideranca),
    embeds: [{
      color: tema.cor.aviso,
      title: '🪪 RENOVAÇÃO DE CARTEIRINHA DE QUEM ESTÁ EM RISCO',
      description: 'A carteirinha vence (ou acabou de vencer) e o associado está com risco médio/alto ou esfriando. É a hora de conversar antes de renovar — ou de deixar sair.',
      fields: F.campoLista('CASOS', novos.map(n =>
        `<@${n.discord_id}> — vence <t:${Math.floor(new Date(n.validade).getTime() / 1000)}:R> · risco ${n.r.risco.score}${n.r.dados.esfriando ? ' · atividade em queda' : ''}${n.r.dados.fatores?.length ? ` (${n.r.dados.fatores.slice(0, 2).join(', ')})` : ''}`), 'Nenhum.', { numerar: false }),
      timestamp: new Date().toISOString(),
    }],
  });
  return novos.length;
}

// Confiança 2.0: conduta vira sinal. Idempotente (o ledger ignora a mesma origem duas vezes).
async function sincronizarConfianca(client, { advs, restricoes, socios, porIdFivem, agora }) {
  const { registrarSinal } = require('../confianca/servico');
  let novos = 0;
  const marca = async args => { if (await registrarSinal(client, args)) novos++; };
  const porDiscord = new Map(socios.map(s => [s.discordId, s]));

  for (const a of advs) {
    if (!porDiscord.has(a.discord_id)) continue;
    const base = { discordId: a.discord_id, origemTipo: 'adv_socio', origemId: a.id };
    await marca({ ...base, sinal: 'ADV_SOCIO' });
    if (a.status === 'PAGA') await marca({ ...base, sinal: 'ADV_PAGA_EM_DIA' });
    if (a.status === 'VENCIDA') await marca({ ...base, sinal: 'ADV_VENCIDA' });
  }
  for (const r of restricoes) {
    const socio = porIdFivem.get(r.id_fivem);
    if (!socio) continue;
    await marca({ discordId: socio.discordId, sinal: 'RESTRICAO_JOGO', origemTipo: 'restricao', origemId: `${r.acao}:${r.id_fivem}:${new Date(r.em).toISOString()}` });
  }
  for (const s of socios) {
    const desde = s.membro.joinedTimestamp;
    if (!desde) continue;
    const dias = (agora - desde) / R.DIA_MS;
    for (const marco of [60, 120, 180]) {
      if (dias >= marco) await marca({ discordId: s.discordId, sinal: 'TEMPO_DE_CASA', origemTipo: 'tempo_de_casa', origemId: `d${marco}` });
    }
  }
  return novos;
}

// Casos abertos cuja condição deixou de valer se resolvem sozinhos (sem ninguém limpar a fila), e o que
// ficou 30 dias sem ação expira: a fila de casos precisa refletir o que ainda pede atenção.
async function resolverCasosAutomaticos(client, { pessoas, idsBloqueados }) {
  const abertos = await casos.abertos(['saiu_segue_socio', 'cargo_divergente', 'blacklist_sem_bloqueio', 'ficha_parada']);
  const pendentes = await repo.fichasPendentes(abertos.filter(c => c.tipo === 'ficha_parada').map(c => c.dados?.fichaId).filter(Boolean));
  const membros = pessoas.guild.members.cache;
  let resolvidos = 0;
  for (const caso of abertos) {
    let motivo = null;
    const membro = caso.alvo_discord_id ? membros.get(caso.alvo_discord_id) : null;
    if (caso.tipo === 'saiu_segue_socio' && (!membro || !membro.roles.cache.has(config.cargos.socio))) motivo = 'o cargo de sócio já saiu';
    else if (caso.tipo === 'cargo_divergente' && (!membro || membro.roles.cache.has(config.cargos.recrutador) === Boolean(caso.dados?.promovido))) motivo = 'o cargo já bate com o jogo';
    else if (caso.tipo === 'blacklist_sem_bloqueio' && idsBloqueados.has(String(caso.dados?.idFivem))) motivo = 'o ID já está em não recrutar';
    else if (caso.tipo === 'ficha_parada' && !pendentes.has(caso.dados?.fichaId)) motivo = 'a ficha foi decidida';
    if (!motivo) continue;
    const fechado = await casos.fechar(caso.id, 'RESOLVIDO', { resolucao: motivo });
    if (!fechado) continue;
    resolvidos++;
    await casos.encerrarMensagem(client, fechado, `✔️ resolvido automaticamente — ${motivo}`);
  }
  for (const caso of await casos.expirarAntigos()) {
    await casos.encerrarMensagem(client, caso, `⌛ expirado: ${casos.EXPIRA_EM_DIAS} dias sem ação`);
  }
  return resolvidos;
}

// ── Orquestração ─────────────────────────────────────────────────────────────

async function etapa(nome, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[inteligencia] Etapa "${nome}" falhou:`, err);
    return 0;
  }
}

async function executarVarredura(client, { agora = new Date(), canais = null } = {}) {
  const logs = require('../logsJogo/repositorio');
  const A = require('../logsJogo/analises');
  const { carregarSocios } = require('./pessoas');
  const resumo = require('./resumo');

  const pessoas = await carregarSocios(client);
  const resumos = await resumo.atualizarResumos(client, { agora, socios: pessoas.socios });
  const saida = { resumos: resumos.length, reincidencia: 0, blacklist: 0, semFicha: 0, paradas: 0, sede: 0, atipica: 0, nomeRestrito: 0, emprestimos: 0, saiuSegue: 0, cargos: 0, responsaveis: 0, renovacoes: 0, casosAuto: 0, confianca: 0 };

  const canalInteligencia = canais?.inteligencia ?? await garantirCanalInteligencia(client);
  const canalOcorrencias = canais?.ocorrencias ?? canais?.atencao ?? await client.channels.fetch(config.canais.ocorrencias).catch(() => null) ?? canalInteligencia;
  const canalSaidas = canais?.saidas ?? await client.channels.fetch(config.canais.saidasNoJogo).catch(() => null) ?? canalInteligencia;
  const canalCargos = canais?.cargos ?? await client.channels.fetch(config.canais.cargoDivergente).catch(() => null) ?? canalInteligencia;
  const canalNaoRecrutar = canais?.naoRecrutar ?? await client.channels.fetch(config.canais.historicoNaoRecrutar).catch(() => null) ?? canalInteligencia;

  saida.reincidencia = await etapa('reincidência', () => alertarReincidencia(canalOcorrencias, resumos, agora));

  const canalSetagens = canais?.setagens ?? await client.channels.fetch(config.canais.setagensPendentes).catch(() => null) ?? canalInteligencia;
  saida.paradas = await etapa('fichas paradas', async () =>
    alertarFichasParadas(canalSetagens, await repo.fichasDoPeriodo(7), agora));

  if (await fonteViva(agora)) {
    saida.blacklist = await etapa('blacklist × não recrutar', async () => {
      const naoRecrutar = require('../naoRecrutarEspelho');
      // Recarrega o espelho (o cache do canal dura 5 min) antes de comparar
      await require('../naoRecrutar').mensagensDoBloqueio(client, '0').catch(() => {});
      const [ativas, bloqueados] = await Promise.all([repo.restricoesAtivasPorAlvo(), naoRecrutar.ativos()]);
      const blacklists = ativas.filter(a => a.acao === A.TIPOS_RESTRICAO.blacklist.adicionou);
      const nomes = await logs.nomesPorIds(blacklists.map(b => b.id_fivem));
      return alertarBlacklistSemBloqueio(canalNaoRecrutar, blacklists, new Set(bloqueados.map(b => b.id_fivem)), nomes, agora);
    });

    saida.semFicha = await etapa('recrutou sem ficha', async () => {
      const recrutamentos = await repo.recrutamentosDoJogo(4);
      const idsComFicha = await repo.idsComFichaAprovada([...new Set(recrutamentos.map(r => r.id))]);
      const nomes = await logs.nomesPorIds([...new Set(recrutamentos.map(r => r.recrutador_id).filter(Boolean))]);
      return alertarRecrutouSemFicha(canalInteligencia, recrutamentos, idsComFicha, nomes, agora);
    });

    saida.sede = await etapa('sede sem vigia', async () => {
      const { estadoFechaduras } = require('../logsJogo/seguranca');
      const P = require('../logsJogo/presenca');
      const limite = config.logsJogo.presencaSessaoMaxHoras * R.HORA_MS;
      const [fechaduras, estado] = await Promise.all([estadoFechaduras(), logs.estadoDosJogadores(agora)]);
      const online = P.listaOnline(P.estadoSemSessoesExpiradas(estado, limite, agora)).length;
      return alertarSedeSemVigia(canalInteligencia, fechaduras, online, agora);
    });
  }

  if (await fonteViva(agora)) {
    saida.atipica = await etapa('retirada atípica', async () => {
      const retiradas = await repo.retiradasBauRecentes(24);
      const historico = await repo.historicoDeRetiradas([...new Set(retiradas.map(r => r.id))], 24);
      const nomes = await logs.nomesPorIds([...new Set(retiradas.map(r => r.id))]);
      return alertarRetiradaAtipica(canalInteligencia, retiradas, historico, nomes, pessoas.porIdFivem);
    });

    saida.nomeRestrito = await etapa('nome de restrito', async () => {
      const ativas = (await repo.restricoesAtivasPorAlvo()).map(a => ({ ...a, rotulo: A.TIPOS_RESTRICAO[A.tipoDaAcao(a.acao)].rotulo }));
      const nomes = await logs.nomesPorIds([...new Set(ativas.map(a => a.id_fivem))]);
      return alertarNomeDeRestrito(canalInteligencia, pessoas.socios, ativas, nomes);
    });
  }

  if (await fonteViva(agora)) {
    saida.saiuSegue = await etapa('saiu e segue sócio', async () => {
      const saidas = await repo.saidasRecentesSemRetorno(3);
      const nomes = await logs.nomesPorIds([...new Set(saidas.map(s => s.id))]);
      return alertarSaiuMasSegueSocio(canalSaidas, saidas, pessoas.porIdFivem, nomes);
    });
    saida.cargos = await etapa('cargo divergente', async () =>
      alertarCargoDivergente(canalCargos, await logs.movimentosDeRecrutador(), pessoas.porIdFivem, agora));
  }

  saida.responsaveis = await etapa('responsável em risco', async () => {
    const cargos = new Map([[config.cargos.recrutador, 'recrutador'], [config.cargos.diretoria, 'diretoria']]);
    for (const area of await require('../departamentos/repositorio').listarDepartamentos({ apenasAtivos: true })) {
      if (area.cargo_gestor_id) cargos.set(area.cargo_gestor_id, `gestor ${area.nome}`);
    }
    return alertarResponsavelEmRisco(canalInteligencia, resumos, cargos);
  });

  saida.renovacoes = await etapa('renovação em risco', async () => {
    try {
      const carteirinhas = await require('../carteirinha/inteligencia').vencendo(7);
      return alertarRenovacaoEmRisco(canalInteligencia, carteirinhas, new Map(resumos.map(r => [r.socio.discordId, r])));
    } catch (err) {
      if (/does not exist|relation/i.test(String(err?.message))) return 0; // módulo carteirinha desligado
      throw err;
    }
  });

  saida.casosAuto = await etapa('casos automáticos', async () => {
    const bloqueados = await require('../naoRecrutarEspelho').ativos().catch(() => []);
    return resolverCasosAutomaticos(client, { pessoas, idsBloqueados: new Set(bloqueados.map(b => String(b.id_fivem))) });
  });

  saida.escalados = await etapa('escalonamento', () => require('./escalonamento').escalarCasosParados(client));

  // Empréstimos: só existe com o módulo de patrimônio ligado (sem tabela, a etapa some em silêncio)
  saida.emprestimos = await etapa('empréstimos atrasados', async () => {
    try {
      return alertarEmprestimosAtrasados(canalInteligencia, await require('../patrimonio/inteligencia').emprestimosAtrasados(7));
    } catch (err) {
      if (/does not exist|relation/i.test(String(err?.message))) return 0;
      throw err;
    }
  });

  saida.confianca = await etapa('confiança', async () => sincronizarConfianca(client, {
    advs: await repo.advSocioNaJanela(90), restricoes: await repo.restricoesAdicionadas(90),
    socios: pessoas.socios, porIdFivem: pessoas.porIdFivem, agora,
  }));
  return saida;
}

let timer = null;
function iniciar(client) {
  const rodar = () => executarVarredura(client).catch(err => console.error('[inteligencia] Varredura falhou:', err));
  setTimeout(rodar, ATRASO_INICIAL_MS).unref();
  timer = setInterval(rodar, INTERVALO_MS);
  timer.unref();
}

module.exports = {
  executarVarredura, iniciar, fonteViva,
  alertarReincidencia, alertarBlacklistSemBloqueio, alertarRecrutouSemFicha, alertarFichasParadas,
  alertarSedeSemVigia, sincronizarConfianca, alertarRetiradaAtipica, alertarNomeDeRestrito, alertarEmprestimosAtrasados,
  alertarSaiuMasSegueSocio, alertarCargoDivergente, alertarResponsavelEmRisco, alertarRenovacaoEmRisco, resolverCasosAutomaticos,
};

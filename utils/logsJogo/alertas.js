const {
  EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');
const { buscarBloqueio } = require('../naoRecrutar');
const { garantirMembrosCarregados } = require('../membrosGuild');
const { buscarDepartamento } = require('../departamentos/repositorio');
const repo = require('./repositorio');
const E = require('./estatisticas');
const A = require('./analises');
const { advertenciaAtivaDoMembro } = require('./advertenciaDiscord');
const { rotuloItem, limitesEfetivosFarm } = require('./farmLimites');
const tema = require('../../tema');

const CHAVE_CANAL_ALERTA_BAU = 'canal_alerta_bau';

// Canal dedicado pro alerta de retirada grande do baú (nasce na primeira vez
// que o alerta dispara, ID salvo em bot_config). Antes caía no canal de
// alerta de novatos (config.logsJogo.canalAlertas) por não ter `canal:`
// próprio — confundia alerta de patrimônio com recrutamento.
async function garantirCanalAlertaBau(client) {
  const guild = await client.guilds.fetch(config.guildId);
  const salvoId = await lerConfig(CHAVE_CANAL_ALERTA_BAU);
  const salvo = salvoId && await guild.channels.fetch(salvoId).catch(() => null);
  if (salvo) return salvo.id;

  const referencia = await guild.channels.fetch(config.logsJogo.canalAlertas).catch(() => null);
  const canal = await guild.channels.create({
    name: '🚨・alerta-baú',
    type: ChannelType.GuildText,
    parent: referencia?.parentId ?? null,
    permissionOverwrites: referencia
      ? referencia.permissionOverwrites.cache.map(o => ({ id: o.id, allow: o.allow, deny: o.deny }))
      : [],
    reason: 'Alerta de retirada grande do baú da torcida',
  });
  await gravarConfig(CHAVE_CANAL_ALERTA_BAU, canal.id);
  return canal.id;
}

// Regras avaliadas só para log que acabou de chegar — nunca na sincronização
// do histórico, senão cada registro antigo viraria um alerta.
// Alerta avisa quem decide; não pune nem concede nada sozinho.

const JANELA_REPETICAO_MS = 6 * 60 * 60 * 1000;
const ultimosAlertasBloqueio = new Map(); // idFivem -> timestamp
const ultimosAlertasAtencao = new Map(); // 'tipo:idFivem' -> timestamp

function mencoes() {
  return config.logsJogo.mencionarAlertas.map(id => `<@&${id}>`).join(' ');
}

// Restrição de sócio ativo não é assunto de recrutamento — só a liderança
// decide o que fazer, então não usa mencoes() (que inclui o cargo recrutador).
function mencoesLideranca() {
  return config.lideranca.map(id => `<@&${id}>`).join(' ');
}

// Movimentação de patrimônio (bandeira/faixa/mastro) menciona só quem decide
// sobre patrimônio da torcida — não a equipe de recrutamento, que entra em
// `mencoes()` mas não tem nada a ver com isso.
function mencoesPatrimonio() {
  return [config.cargos.presidente, config.cargos.velhaGuarda, config.cargos.diretoria].map(id => `<@&${id}>`).join(' ');
}

// Retirada suspeita de item de farm: mesma liderança de mencoesPatrimonio +
// o gestor do próprio departamento Farm (RESPONSÁVEL FARM), que é quem mais
// precisa saber na hora que o estoque do time sumiu.
function mencoesFarm(area) {
  const ids = [config.cargos.presidente, config.cargos.velhaGuarda, config.cargos.diretoria];
  if (area?.cargo_gestor_id) ids.push(area.cargo_gestor_id);
  return ids.map(id => `<@&${id}>`).join(' ');
}

// Quem tem autoridade reconhecida pra tirar item de farm do baú, hoje: a
// liderança (que pode fazer qualquer coisa) e o gestor do departamento Farm
// (RESPONSÁVEL FARM — no fluxo combinado com o usuário, 2026-09-21, só ele
// vai transferir do baú de Sócio pro de Diretoria). Membro comum do Farm
// (EQUIPE FARM) só GUARDA — se ele também remover, é retirada suspeita igual
// a qualquer outro sócio, não vira exceção.
function autorizadoParaTirarFarm(membro, area) {
  if (!membro) return false;
  const cargosAutorizados = [config.cargos.presidente, config.cargos.vicePresidente, config.cargos.velhaGuarda, config.cargos.diretoria];
  if (area?.cargo_gestor_id) cargosAutorizados.push(area.cargo_gestor_id);
  return cargosAutorizados.some(id => id && membro.roles.cache.has(id));
}

// Cruzamento pedido pelo usuário em 2026-09-21 (🚨・associado-em-atenção):
// mesmo embed serve pras duas direções — jogo aplicou restrição num sócio já
// advertido no Discord (REGRAS abaixo), ou o Discord acabou de advertir um
// sócio que já está com restrição ativa no jogo (verificarRestricaoAoAdvertir,
// chamada por utils/advertencia/interacoes.js). Um debounce só
// (`ultimosAlertasAtencao`, por tipo+ID) cobre as duas: se uma direção já
// alertou por essa restrição há pouco, a outra não repete o aviso.
function alertaAtencaoJaEnviado(tipo, idFivem) {
  const chave = `${tipo}:${idFivem}`;
  const ultimo = ultimosAlertasAtencao.get(chave);
  if (ultimo && Date.now() - ultimo < JANELA_REPETICAO_MS) return true;
  ultimosAlertasAtencao.set(chave, Date.now());
  return false;
}

function embedAtencaoSocio({ titulo, descricao, membro, idFivem, tipo, nivelAdv, bloqueadoNoDiscord }) {
  return new EmbedBuilder()
    .setColor(tema.cor.perigo)
    .setTitle(titulo)
    .setDescription(descricao)
    .addFields(
      { name: '👤 Sócio', value: `${membro.displayName} (${idFivem})`, inline: true },
      { name: '🚫 Restrição', value: A.TIPOS_RESTRICAO[tipo].rotulo, inline: true },
      { name: '❌ Advertência (Discord)', value: nivelAdv ? `ATIVA — ${nivelAdv}ª` : 'nenhuma', inline: true },
      ...(tipo === 'blacklist'
        ? [{ name: '🔒 Não-recrutar', value: bloqueadoNoDiscord === null ? 'não conferido' : bloqueadoNoDiscord ? 'já bloqueado' : '⚠️ FALTA BLOQUEAR', inline: true }]
        : []),
    )
    .setFooter({ text: 'Cruzamento automático: cargo de sócio (Discord) + restrição do jogo' })
    .setTimestamp();
}

// Chamada por utils/advertencia/interacoes.js logo depois de registrar uma
// advertência de sócio: se esse sócio já está com blacklist/suspensão/
// impedimento ativa no jogo, a advertência sozinha (sem essa checagem) não
// deixaria a liderança saber que o caso já é mais grave do que parece no
// Discord. Nunca lança: falha aqui não pode derrubar o registro da
// advertência, só perde o alerta extra (loga e segue).
async function verificarRestricaoAoAdvertir(client, membro) {
  try {
    const idFivem = E.idFivemDoNick(membro?.nickname ?? membro?.displayName);
    if (!idFivem) return;
    const eventos = await repo.eventosDoAlvo(idFivem, A.ACOES_RESTRICAO, 50);
    const ativas = A.statusRestricoesDoAlvo(eventos).filter(s => s.ativo);
    if (!ativas.length) return;

    const nivelAdv = advertenciaAtivaDoMembro(membro);
    const canal = await client.channels.fetch(config.canais.associadoEmAtencao).catch(() => null);
    if (!canal) return;

    for (const { tipo } of ativas) {
      if (alertaAtencaoJaEnviado(tipo, idFivem)) continue;
      let bloqueadoNoDiscord = null;
      if (tipo === 'blacklist') {
        try { bloqueadoNoDiscord = Boolean(await buscarBloqueio(client, idFivem)); } catch { /* segue sem a marca */ }
      }
      const alerta = embedAtencaoSocio({
        titulo: `🚨 SÓCIO COM ${A.TIPOS_RESTRICAO[tipo].rotulo} ATIVA RECEBEU ADVERTÊNCIA`,
        descricao: 'Advertência registrada agora no Discord para um sócio que já está com restrição ativa no jogo.',
        membro, idFivem, tipo, nivelAdv, bloqueadoNoDiscord,
      });
      await canal.send({ content: mencoesLideranca(), embeds: [alerta] });
    }
  } catch (err) {
    console.error('[logs-jogo] Erro ao checar restrição ativa ao advertir:', err);
  }
}

// Limite diário de retirada de droga (config.logsJogo.farm.itensDroga),
// editável no painel-farm (botão EDITAR LIMITES). Dispara só na TRANSIÇÃO
// (total de hoje cruza o limite com esta retirada) — quem já tinha estourado
// antes desta mesma retirada não gera um segundo aviso no mesmo dia, senão
// vira alerta a cada nova retirada depois do primeiro estouro. Botão
// REGISTRAR ADVERTÊNCIA abre o mesmo fluxo de select_prazo_adv já usado em
// utils/advertencia/interacoes.js (ver painelFarmInteracoes.js#registrarModulo
// acao 'advertir') — pulando só o passo de selecionar o membro.
async function montarAlertaLimiteDiarioFarm(registro, item, bau, membro, area) {
  const [limites, totalHoje] = await Promise.all([
    limitesEfetivosFarm(),
    repo.farmRetiradoHojePorItem(registro.atorIdFivem, item, config.logsJogo.farm.baus, E.resolverPeriodo('hoje')),
  ]);
  const limite = limites[item];
  const quantidade = Number(registro.valor) || 0;
  const totalAntes = totalHoje - quantidade;
  if (totalHoje < limite || totalAntes >= limite) return null; // dentro do limite, ou já avisado hoje

  const alerta = new EmbedBuilder()
    .setColor(tema.cor.perigo)
    .setTitle('🌾 LIMITE DIÁRIO DE RETIRADA EXCEDIDO')
    .setDescription(`${membro} passou do limite diário parametrizado de **${rotuloItem(item)}** — pode ser uso legítimo num dia de pista mais puxado, mas vale conferir.`)
    .addFields(
      { name: '📦 Item', value: rotuloItem(item), inline: true },
      { name: '📊 Retirado hoje', value: `${E.formatarNumero(Math.round(totalHoje))} / ${E.formatarNumero(limite)}`, inline: true },
      { name: '🗄️ Baú', value: bau ?? 'N/A', inline: true }
    )
    .setFooter({ text: 'Limite editável no botão EDITAR LIMITES do painel-farm · canal logs-baú' })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`farm:advertir:${membro.id}`).setLabel('REGISTRAR ADVERTÊNCIA').setEmoji('⛔').setStyle(ButtonStyle.Danger)
  );
  return { content: mencoesFarm(area), embeds: [alerta], components: [row] };
}

const REGRAS = [
  // Regra 'novato' removida em 2026-09-13: `novato_entrou` só era logado pelo
  // canal 1461544673825783929 ("logs-liderança"), que pertence à categoria
  // "LOGS FANÁTICOS/ARENA" — outra comunidade, não o Hoolibras. Sem fonte de
  // verdade pro Hoolibras, essa regra nunca mais dispara.
  {
    nome: 'id_bloqueado_no_jogo',
    // Vai para o histórico de não recrutar, não para novatos: o ID já é
    // bloqueado, não é candidato a recrutamento.
    canal: () => config.canais.historicoNaoRecrutar,
    async montar(registro, client) {
      for (const idFivem of [registro.atorIdFivem, registro.alvoIdFivem].filter(Boolean)) {
        const ultimo = ultimosAlertasBloqueio.get(idFivem);
        if (ultimo && Date.now() - ultimo < JANELA_REPETICAO_MS) continue;
        const bloqueio = await buscarBloqueio(client, idFivem);
        if (!bloqueio) continue;
        ultimosAlertasBloqueio.set(idFivem, Date.now());
        const alerta = new EmbedBuilder()
          .setColor(tema.cor.perigo)
          .setTitle('🚫 ID DA LISTA "NÃO RECRUTAR" ATIVO NO JOGO')
          .setDescription(registro.descricao ? registro.descricao.slice(0, 1000) : 'Registro sem descrição.')
          .addFields(
            { name: '🆔 ID FiveM', value: idFivem, inline: true },
            { name: '📂 Categoria', value: registro.categoria ?? 'N/A', inline: true }
          )
          .setFooter({ text: 'Detectado automaticamente nos logs do jogo' })
          .setTimestamp();
        return { content: mencoes(), embeds: [alerta, bloqueio] };
      }
      return null;
    },
  },
  {
    nome: 'restricao_jogo_socio_ativo',
    canal: () => config.canais.associadoEmAtencao,
    // Cruzamento pedido pelo usuário em 2026-09-21: o sinal que interessa pra
    // liderança olhar na hora é um SÓCIO ATIVO (cargo Discord, correlação por
    // nome — ver 1.4) levando blacklist/suspensão/impedimento no jogo, porque
    // é gente que ainda está na torcida. Quem já não é sócio (correlação não
    // bate ou perdeu o cargo) fica só na ficha manual de ⛔・banidos-e-impedidos,
    // sem alerta aqui — não é "associado em atenção" se não é mais associado.
    // Debounce de JANELA_REPETICAO_MS por tipo+ID: impedimento liga/desliga
    // com segundos de diferença (ver docs/inteligencia-logs-jogo.md), sem
    // isso a mesma pessoa alertaria várias vezes seguidas pelo mesmo evento.
    async montar(registro, client) {
      const tipo = A.tipoDaAcao(registro.acao);
      if (!tipo || A.TIPOS_RESTRICAO[tipo].adicionou !== registro.acao) return null;
      const idFivem = registro.alvoIdFivem;
      if (!idFivem) return null; // "#nil": sem alvo resolvido, não dá pra correlacionar

      const guild = await client.guilds.fetch(config.guildId);
      await garantirMembrosCarregados(guild);
      const membro = guild.members.cache.find(m => E.idFivemDoNick(m.nickname ?? m.displayName) === idFivem);
      if (!membro || !membro.roles.cache.has(config.cargos.socio)) return null;

      if (alertaAtencaoJaEnviado(tipo, idFivem)) return null;

      const nivelAdv = advertenciaAtivaDoMembro(membro);
      let bloqueadoNoDiscord = null;
      if (tipo === 'blacklist') {
        try { bloqueadoNoDiscord = Boolean(await buscarBloqueio(client, idFivem)); } catch { /* segue sem a marca */ }
      }

      const alerta = embedAtencaoSocio({
        titulo: `🚨 SÓCIO ATIVO COM ${A.TIPOS_RESTRICAO[tipo].rotulo} NO JOGO`,
        descricao: registro.descricao ? registro.descricao.slice(0, 1000) : 'Registro sem descrição.',
        membro, idFivem, tipo, nivelAdv, bloqueadoNoDiscord,
      });
      return { content: mencoesLideranca(), embeds: [alerta] };
    },
  },
  {
    nome: 'retirada_grande_bau',
    canal: (client) => garantirCanalAlertaBau(client),
    // Retirada grande é o único evento do baú que precisa de alguém olhando na
    // hora: material do baú é da torcida, e o log não diz pra onde foi. O nome
    // do jogador é emprestado dos outros canais — o log do baú só manda o ID.
    async montar(registro) {
      if (registro.acao !== 'bau_removeu') return null;
      const quantidade = Number(registro.valor) || 0;
      if (quantidade < config.logsJogo.bau.alertaRetiradaQtd) return null;

      const nome = registro.atorIdFivem
        ? (await repo.nomesPorIds([registro.atorIdFivem])).get(registro.atorIdFivem)
        : null;
      const alerta = new EmbedBuilder()
        .setColor(tema.cor.perigo)
        .setTitle('📦 RETIRADA GRANDE NO BAÚ DA TORCIDA')
        .setDescription(`Saiu uma quantidade acima do normal do baú de uma vez só.`)
        .addFields(
          { name: '📦 Item', value: `${E.formatarNumero(quantidade)}× ${registro.alvoNome ?? '?'}`, inline: true },
          { name: '🗄️ Baú', value: E.bauDoTitulo(registro.titulo) ?? 'N/A', inline: true },
          { name: '👤 Quem', value: nome ? `${nome} (${registro.atorIdFivem})` : (registro.atorIdFivem ?? 'N/A'), inline: true }
        )
        .setFooter({ text: `Alerta a partir de ${E.formatarNumero(config.logsJogo.bau.alertaRetiradaQtd)} unidades · canal logs-baú` })
        .setTimestamp();
      return { content: mencoes(), embeds: [alerta] };
    },
  },
  {
    nome: 'patrimonio_bau',
    canal: (client) => garantirCanalAlertaBau(client),
    // Bandeira/faixa/mastro/instrumento saindo ou voltando pro baú — sem
    // limiar de quantidade, ao contrário da retirada grande: cada peça é
    // única, então toda movimentação importa pra saber quem está com o quê.
    // Dois formatos reais viram esse alerta (ver E.nomePatrimonio): o webhook
    // novo (`patrimonio_guardou`/`patrimonio_removeu`, sempre patrimônio) e o
    // baú comum antigo (`bau_guardou`/`bau_removeu`, que também carrega
    // tecido/droga/etc — só entra aqui quando o item bate com o padrão de
    // patrimônio).
    async montar(registro) {
      const formatoNovo = registro.acao === 'patrimonio_guardou' || registro.acao === 'patrimonio_removeu';
      const formatoAntigo = registro.acao === 'bau_guardou' || registro.acao === 'bau_removeu';
      if (!formatoNovo && !formatoAntigo) return null;
      const rotulo = formatoNovo ? registro.alvoNome : E.nomePatrimonio(registro.alvoNome);
      if (!rotulo) return null;

      const retirou = registro.acao === 'patrimonio_removeu' || registro.acao === 'bau_removeu';
      const nome = registro.atorIdFivem
        ? (await repo.nomesPorIds([registro.atorIdFivem])).get(registro.atorIdFivem)
        : null;
      const alerta = new EmbedBuilder()
        .setColor(retirou ? tema.cor.perigo : tema.cor.destaque)
        .setTitle(retirou ? '🚩 PATRIMÔNIO RETIRADO DO BAÚ' : '🚩 PATRIMÔNIO GUARDADO NO BAÚ')
        .addFields(
          { name: '🎌 Item', value: rotulo, inline: true },
          { name: '👤 Quem', value: nome ? `${nome} (${registro.atorIdFivem})` : (registro.atorIdFivem ?? 'N/A'), inline: true }
        )
        .setFooter({ text: 'Detectado automaticamente pelos logs do jogo · canal logs-baú' })
        .setTimestamp();
      return { content: mencoesPatrimonio(), embeds: [alerta] };
    },
  },
  {
    nome: 'retirada_suspeita_farm',
    canal: (client) => garantirCanalAlertaBau(client),
    // O medo real que motivou o departamento Farm (usuário, 2026-09-21): um
    // sócio comum retirar pra si o que o time de farm guardou. Só item de
    // farm (config.logsJogo.farm.itens), só baú habilitado
    // (config.logsJogo.farm.baus) — nunca dispara pra tecido/madeira fora
    // dessa lista nem pro baú de Presidência/Recrutador, que já correm risco
    // sabido demais pra virar sinal novo aqui.
    //
    // Refinado em 2026-09-21 (pedido do usuário): droga (itensDroga) tem
    // LIMITE DIÁRIO parametrizável (uso normal pra pista/briga não deve
    // virar alerta a cada grama) — só dispara quando o total do dia de uma
    // pessoa IDENTIFICADA (vínculo Discord) estoura o limite editável
    // (painel-farm, botão EDITAR LIMITES). Matéria-prima/vida e droga de ID
    // SEM vínculo (não dá pra aplicar limite nem oferecer advertência)
    // continuam no alerta antigo: qualquer retirada de não autorizado é
    // suspeita.
    async montar(registro, client) {
      if (registro.acao !== 'bau_removeu') return null;
      const item = String(registro.alvoNome ?? '').toLowerCase();
      if (!config.logsJogo.farm.itens.includes(item)) return null;
      const bau = E.bauDoTitulo(registro.titulo);
      if (!config.logsJogo.farm.baus.includes(bau)) return null;

      const area = await buscarDepartamento('farm');
      const guild = await client.guilds.fetch(config.guildId);
      await garantirMembrosCarregados(guild);
      const membro = registro.atorIdFivem
        ? guild.members.cache.find(m => E.idFivemDoNick(m.nickname ?? m.displayName) === registro.atorIdFivem)
        : null;
      if (autorizadoParaTirarFarm(membro, area)) return null;

      if (membro && config.logsJogo.farm.itensDroga.includes(item)) {
        return montarAlertaLimiteDiarioFarm(registro, item, bau, membro, area);
      }

      const quantidade = Number(registro.valor) || 0;
      const nome = membro?.displayName
        ?? (registro.atorIdFivem ? (await repo.nomesPorIds([registro.atorIdFivem])).get(registro.atorIdFivem) : null);
      const alerta = new EmbedBuilder()
        .setColor(tema.cor.perigo)
        .setTitle('🌾 RETIRADA SUSPEITA NO BAÚ DO FARM')
        .setDescription('Item de farm saiu do baú por quem não é diretoria nem gestor do departamento Farm — pode ser furto do que o time produziu.')
        .addFields(
          { name: '📦 Item', value: `${E.formatarNumero(quantidade)}× ${registro.alvoNome ?? '?'}`, inline: true },
          { name: '🗄️ Baú', value: bau ?? 'N/A', inline: true },
          { name: '👤 Quem', value: nome ? `${nome} (${registro.atorIdFivem})` : (registro.atorIdFivem ?? 'N/A (sem ID no log)'), inline: true }
        )
        .setFooter({ text: 'Detectado automaticamente pelos logs do jogo · canal logs-baú' })
        .setTimestamp();
      return { content: mencoesFarm(area), embeds: [alerta] };
    },
  },
  {
    nome: 'saque_grande_banco',
    // Saque do banco da torcida acima do limite: dinheiro coletivo saindo.
    async montar(registro) {
      if (registro.acao !== 'banco_sacou') return null;
      const valor = Number(registro.valor) || 0;
      if (valor < config.logsJogo.caixa.alertaSaqueValor) return null;

      const alerta = new EmbedBuilder()
        .setColor(tema.cor.perigo)
        .setTitle('🏦 SAQUE GRANDE NO BANCO DA TORCIDA')
        .setDescription(registro.descricao ? registro.descricao.slice(0, 1000) : 'Registro sem descrição.')
        .addFields(
          { name: '💰 Valor', value: E.formatarDinheiro(valor), inline: true },
          { name: '👤 Quem', value: registro.atorNome ?? registro.atorIdFivem ?? 'N/A', inline: true }
        )
        .setFooter({ text: `Alerta a partir de ${E.formatarDinheiro(config.logsJogo.caixa.alertaSaqueValor)} · canal logs-banco` })
        .setTimestamp();
      return { content: mencoes(), embeds: [alerta] };
    },
  },
];

const canaisAlerta = new Map(); // idCanal -> Channel (cache simples, uma leva por vez)

async function resolverCanal(client, idCanal) {
  if (!canaisAlerta.has(idCanal)) {
    canaisAlerta.set(idCanal, await client.channels.fetch(idCanal).catch(() => null));
  }
  return canaisAlerta.get(idCanal);
}

async function avaliarAlertas(client, registros) {
  if (!registros.length) return;
  canaisAlerta.clear();
  for (const registro of registros) {
    for (const regra of REGRAS) {
      try {
        const mensagem = await regra.montar(registro, client);
        if (!mensagem) continue;
        const idCanal = regra.canal ? await regra.canal(client) : config.logsJogo.canalAlertas;
        const canal = await resolverCanal(client, idCanal);
        if (canal) await canal.send(mensagem);
      } catch (err) {
        console.error(`[logs-jogo] Erro no alerta ${regra.nome}:`, err);
      }
    }
  }
}

module.exports = { avaliarAlertas, verificarRestricaoAoAdvertir };

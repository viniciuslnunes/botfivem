const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const config = require('../../config/index.js');
const { lerConfig, gravarConfig } = require('../botConfig');

// Esqueleto dos canais-painel de estatística dos logs do jogo. Toda a mecânica
// que painelJogadores.js, painelSociosSemId.js e registrosDiarios.js repetem
// mora aqui uma vez: garantir o canal (criado na primeira vez, reaproveitado
// depois pelo ID salvo em bot_config), reeditar as mensagens no lugar em vez de
// postar de novo, apagar as que sobraram quando a lista encolhe, ciclo por tempo
// como rede de segurança e atualização reativa com debounce.
//
// Painel novo escreve só o que é DELE: o nome do canal e uma função que monta os
// blocos (uma mensagem cada). Não copiar essa mecânica de novo.
//
// Regra de ouro do bloco de ação (select/botão): ele é SEMPRE a última mensagem
// do canal, por isso vem de `montarAcao` e não de `montarBlocos`. A resposta
// ephemeral do Discord nasce no fim do canal — componente no topo com listagem
// grande embaixo esconde a resposta atrás de scroll (já aconteceu nos canais de
// IDs sem Discord e de sócios sem ID).

const LER = [P.ViewChannel, P.ReadMessageHistory];
const ESCREVER = [...LER, P.SendMessages, P.EmbedLinks];

// Só a liderança vê (padrão): estes painéis expõem auditoria — quem retirou
// material, quem está banido, quem perdoou advertência.
function permissoesLideranca(guild, botId) {
  return [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
    ...config.lideranca.map(id => ({ id, allow: ESCREVER })),
    { id: botId, allow: [...ESCREVER, P.ManageMessages] },
  ];
}

// Todo mundo lê, ninguém escreve além da liderança e do bot.
function permissoesPublicas(guild, botId) {
  return [
    { id: guild.roles.everyone.id, allow: LER, deny: [P.SendMessages] },
    ...config.lideranca.map(id => ({ id, allow: ESCREVER })),
    { id: botId, allow: [...ESCREVER, P.ManageMessages] },
  ];
}

// Reexecuta quando o Discord recusar por rate limit (`retry_after` diz quanto
// esperar). Sem isso, um 429 no meio do loop de mensagens deixa metade do painel
// com o conteúdo novo e metade com o antigo — ver registrosDiarios.comRetry, de
// onde isso veio.
async function comRetry(fn, tentativasRestantes = 2) {
  try {
    return await fn();
  } catch (err) {
    const retryAfter = err?.data?.retry_after ?? err?.retryAfter;
    if (tentativasRestantes > 0 && typeof retryAfter === 'number') {
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000 + 500));
      return comRetry(fn, tentativasRestantes - 1);
    }
    throw err;
  }
}

// slug            → prefixo das chaves em bot_config (canal e IDs de mensagem)
// nomeCanal       → nome do canal criado na primeira vez
// razao           → motivo registrado no audit log do Discord ao criar o canal
// publico         → true: todo mundo lê. Padrão: só a liderança.
// intervaloMin    → ciclo por tempo (rede de segurança)
// debounceMs      → janela pra juntar uma rajada de logs numa atualização só
// montarBlocos    → async () => [payload, ...] (uma mensagem por payload)
// montarAcao      → () => payload | null: o bloco de select/botão, sempre último
// cargosLeitura  → cargos que também LEEM o canal (sem escrever), além da liderança
// canalVizinhoId  → cria o canal logo abaixo deste (mesma categoria). Padrão:
//                   categoria do painel de jogadores, no fim.
function criarPainelCanal({
  slug, nomeCanal, razao, publico = false, intervaloMin, debounceMs = 30 * 1000, montarBlocos, montarAcao = null,
  canalVizinhoId = null, cargosLeitura = [],
}) {
  const CHAVE_CANAL = `canal_${slug}`;
  const CHAVE_MSGS = `${slug}_message_ids`;
  const log = (...args) => console.error(`[${slug}]`, ...args);

  async function garantirCanal(guild) {
    const salvoId = await lerConfig(CHAVE_CANAL);
    const salvo = salvoId && await guild.channels.fetch(salvoId).catch(() => null);
    if (salvo) return salvo;

    // Mesma categoria do painel de jogadores: os painéis de log moram juntos.
    // Painel de outro módulo pode pedir pra nascer ao lado do canal dele.
    const referenciaId = canalVizinhoId ?? config.logsJogo.canalPainelJogadores;
    const referencia = referenciaId
      ? await guild.channels.fetch(referenciaId).catch(() => null)
      : null;

    const canal = await guild.channels.create({
      name: nomeCanal,
      type: ChannelType.GuildText,
      parent: referencia?.parentId ?? null,
      ...(canalVizinhoId && referencia ? { position: referencia.rawPosition + 1 } : {}),
      permissionOverwrites: [
        ...(publico ? permissoesPublicas : permissoesLideranca)(guild, guild.members.me.id),
        ...cargosLeitura.map(id => ({ id, allow: LER, deny: [P.SendMessages] })),
      ],
      reason: razao,
    });
    await gravarConfig(CHAVE_CANAL, canal.id);
    return canal;
  }

  async function lerMsgIds() {
    try {
      const bruto = await lerConfig(CHAVE_MSGS);
      return bruto ? JSON.parse(bruto) : [];
    } catch {
      return [];
    }
  }

  async function atualizar(client) {
    const guild = await client.guilds.fetch(config.guildId);
    const canal = await garantirCanal(guild);

    const acao = montarAcao?.();
    const blocos = [...await montarBlocos(), ...(acao ? [acao] : [])];
    const idsAntigos = await lerMsgIds();
    const idsNovos = [];

    for (let i = 0; i < blocos.length; i++) {
      // allowedMentions fechado por padrão: painel é leitura, não notificação.
      // Quem quiser mencionar de propósito manda o próprio allowedMentions.
      const payload = { allowedMentions: { parse: [] }, components: [], ...blocos[i] };
      const idAntigo = idsAntigos[i];
      if (idAntigo) {
        const msg = await canal.messages.fetch(idAntigo).catch(() => null);
        if (msg) {
          await comRetry(() => msg.edit(payload));
          idsNovos.push(idAntigo);
          continue;
        }
      }
      const nova = await comRetry(() => canal.send(payload));
      idsNovos.push(nova.id);
    }
    // A listagem encolheu: apaga o que sobrou do ciclo anterior.
    for (const idExtra of idsAntigos.slice(blocos.length)) {
      await canal.messages.delete(idExtra).catch(() => {});
    }
    await gravarConfig(CHAVE_MSGS, JSON.stringify(idsNovos));
  }

  function iniciar(client) {
    const rodar = () => atualizar(client).catch(err => log('Erro ao atualizar:', err));
    rodar();
    setInterval(rodar, intervaloMin * 60 * 1000);
  }

  let timerPendente = null;
  function agendarAtualizacaoReativa(client) {
    if (timerPendente) return;
    timerPendente = setTimeout(() => {
      timerPendente = null;
      atualizar(client).catch(err => log('Erro ao atualizar (reativo):', err));
    }, debounceMs);
  }

  return { iniciar, atualizar, agendarAtualizacaoReativa };
}

module.exports = { criarPainelCanal, comRetry };

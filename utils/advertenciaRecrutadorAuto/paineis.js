// Dois canais para os recrutadores (leem eles e a liderança; só o bot escreve):
//  📘・regras-recrutadores      como funciona o recrutamento e as advertências
//  🚨・recrutadores-advertidos  tabela reativa: quem está advertido ou não
// As regras de advertência saem de regras.js (LIMITES), então o quadro nunca
// fica desatualizado em relação ao que o bot aplica.
const config = require('../../config/index.js');
const tema = require('../../tema');
const { criarPainelCanal } = require('../logsJogo/painelCanal');
const F = require('../logsJogo/painelFormato');
const { garantirMembrosCarregados } = require('../membrosGuild');
const R = require('./regras');
const repo = require('./repositorio');

const L = R.LIMITES;
const canal = id => (id ? `<#${id}>` : null);
let clientAtual = null;

// ── 📘 Regras ────────────────────────────────────────────────────────────
function blocosRegras() {
  const c = config.canais;
  const ref = (id, nome) => canal(id) ?? nome;
  const fluxo = {
    color: F.COR,
    title: tema.titulo(`${tema.emoji.marca} COMO FUNCIONA O RECRUTAMENTO`),
    description: [
      `**1. Entrada.** O candidato abre o formulário no canal ${ref(c.recrutamento, 'de recrutamento')} (nome, idade, ID FiveM, telefone e área). A ficha cai para análise dos recrutadores. Quem já tem ficha em análise (até 7 dias) ou reprovação definitiva não abre outra.`,
      '',
      '**2. Análise.** Um recrutador decide a ficha; o clique duplo é barrado. Antes de aprovar confira: dados completos e coerentes, ID FiveM que confere e **fora da lista de NÃO RECRUTAR** (ID bloqueado não é aprovado), idade mínima e conduta.',
      '',
      `**3. Aprovar.** O candidato vira sócio, recebe o nick padrão (Nome - ID) e o telefone dele é divulgado à torcida. Ele envia a foto do manto no canal ${ref(c.provarManto, 'provar-manto')}; a liderança marca **CORRETO** ou **ERRADO**, e o resultado conta para **você**, que decidiu a ficha.`,
      '',
      '**4. Reprovar.** Escolha a categoria e escreva a justificativa (15 a 1000 caracteres): ela vai para o candidato. Reprovação definitiva só a liderança desfaz.',
      '',
      '**5. Depois da aprovação.** Validação de setagem pela liderança e convite do WhatsApp pelo painel próprio, sempre manual.',
      '',
      `**6. Divulgação.** Poste o flyer no canal ${ref(c.divulgacaoRecrutamento, 'de divulgação')} em rodízio: quem está há mais tempo sem postar é o próximo. Duas vezes seguidas ou mais de 7 dias sem postar gera alerta para a liderança.`,
    ].join('\n'),
    footer: { text: 'Quadro fixo mantido pelo bot' },
  };

  const adv = {
    color: F.COR,
    title: tema.titulo(`${tema.emoji.recusado} ADVERTÊNCIAS DE RECRUTADOR (AUTOMÁTICAS)`),
    description: [
      'O bot cruza a inteligência de recrutadores, o placar do manto e as fichas a cada 3 horas. Toda advertência sai com a justificativa e é registrada.',
      '',
      `**Jogou e não recrutou:** ${L.minJogadoMs / 60000}+ min jogados e nenhum recrutamento em **${L.diasSemRecrutarJogando} dias**.`,
      `**Inatividade:** nenhum jogo e nenhum recrutamento em **${L.diasInativo} dias** → você perde o cargo de recrutador (sem advertência).`,
      `**Manto errado:** **${L.ocorrencias}** mantos avaliados ERRADO em ${L.diasOcorrencias} dias nas fichas que você aprovou.`,
      `**Retenção baixa:** menos de ${L.retencaoMinima * 100}% dos recrutados permanecem (mínimo ${L.minRecrutamentosRetencao} recrutados em ${L.diasRetencao} dias).`,
      `**Ficha incompleta:** **${L.ocorrencias}** fichas aprovadas por você em ${L.diasOcorrencias} dias sem nome, idade, ID ou telefone.`,
      '',
      '**Escada:** 1ª = aviso · 2ª = aviso (em "jogou e não recrutou" você tem **2 dias** para voltar a recrutar) · 3ª = perde o cargo de recrutador.',
      `**Perdão:** a de "jogou e não recrutou" sai sozinha depois de **${L.perdaoRecrutamentos} recrutamentos**. Qualquer advertência expira em ${L.validadeDias} dias sem reincidência.`,
      `**Carência:** quem acabou de receber o cargo só é medido depois de ${L.diasSemRecrutarJogando} a ${L.diasInativo} dias.`,
      '',
      'Acompanhe quem está advertido no canal 🚨・recrutadores-advertidos.',
    ].join('\n'),
    footer: { text: 'Valores lidos das regras do bot: este quadro acompanha qualquer ajuste' },
  };
  return [{ embeds: [fluxo] }, { embeds: [adv] }];
}

const regras = criarPainelCanal({
  slug: 'regras_recrutadores',
  nomeCanal: '📘・regras-recrutadores',
  razao: 'Quadro de regras do recrutamento e das advertências de recrutador',
  intervaloMin: 360,
  montarBlocos: async () => blocosRegras(),
  canalVizinhoId: config.canais.quadroRecrutadores,
  cargosLeitura: [config.cargos.recrutador],
});

// ── 🚨 Advertidos ────────────────────────────────────────────────────────
const nivelDoCargo = (membro) => {
  const cargos = config.cargos.advRec;
  if (!Array.isArray(cargos) || cargos.length !== 3 || !cargos.every(Boolean)) return 0;
  const i = cargos.findIndex(id => membro.roles.cache.has(id));
  return i === -1 ? 0 : i + 1;
};

const ts = data => Math.floor(new Date(data).getTime() / 1000);

async function montarAdvertidos(client = clientAtual) {
  const guild = await client.guilds.fetch(config.guildId);
  await garantirMembrosCarregados(guild);
  const recrutadores = [...guild.members.cache.filter(m => m.roles.cache.has(config.cargos.recrutador)).values()];
  const [ativas, encerradas] = await Promise.all([repo.ativas(), repo.encerradasRecentes(10)]);

  const porMembro = new Map();
  for (const a of ativas) {
    if (!porMembro.has(a.discord_id)) porMembro.set(a.discord_id, []);
    porMembro.get(a.discord_id).push(a);
  }
  // Advertência manual (botão da liderança) vive só no cargo ADV de recrutador
  const manuais = recrutadores.filter(m => !porMembro.has(m.id) && nivelDoCargo(m) > 0);

  const linhasAdv = [];
  for (const [id, lista] of porMembro) {
    linhasAdv.push(`• <@${id}> — **${lista.length}ª advertência ativa**`);
    for (const a of lista) {
      const prazo = a.prazo_em ? ` · prazo <t:${ts(a.prazo_em)}:R>` : '';
      linhasAdv.push(`  ↳ ${R.REGRAS[a.regra]?.rotulo ?? a.regra} · <t:${ts(a.criada_em)}:R>${prazo}\n  ↳ ${a.motivo}`);
    }
  }
  for (const m of manuais) linhasAdv.push(`• <@${m.id}> — **${nivelDoCargo(m)}ª advertência** (registrada manualmente pela liderança)`);

  const limpos = recrutadores.filter(m => !porMembro.has(m.id) && nivelDoCargo(m) === 0);
  const linhasLimpos = limpos.map(m => `${tema.emoji.ok} <@${m.id}>`);
  const linhasEncerradas = encerradas.map(a => {
    const quando = ts(a.resolvida_em ?? a.criada_em);
    return `• <@${a.discord_id}> — ${a.status.replace('_', ' ')} · ${R.REGRAS[a.regra]?.rotulo ?? 'INATIVIDADE'} · <t:${quando}:R>`;
  });

  const cabecalho = `**Recrutadores:** ${recrutadores.length} · **Advertidos:** ${porMembro.size + manuais.length} · **Sem advertência:** ${limpos.length}`;
  const embeds = [
    ...F.embedsDeLista({
      titulo: tema.titulo(`${tema.emoji.recusado} RECRUTADORES ADVERTIDOS`), cabecalho,
      linhas: linhasAdv, vazio: 'Nenhum recrutador advertido no momento.', fonte: 'Advertências automáticas e manuais · atualiza sozinho',
    }),
    ...F.embedsDeLista({
      titulo: tema.titulo(`${tema.emoji.ativo} SEM ADVERTÊNCIA`), cabecalho: null,
      linhas: linhasLimpos, vazio: 'Todos os recrutadores estão advertidos.', fonte: 'Recrutadores com o cargo e sem advertência ativa',
    }),
    ...F.embedsDeLista({
      titulo: tema.titulo(`${tema.emoji.pendente} ÚLTIMAS RESOLUÇÕES`), cabecalho: null,
      linhas: linhasEncerradas, vazio: 'Nenhuma advertência encerrada ainda.', fonte: 'Perdoadas, expiradas, vencidas e cargos removidos',
    }),
  ];
  return F.blocosDeEmbeds(embeds);
}

const advertidos = criarPainelCanal({
  slug: 'recrutadores_advertidos',
  nomeCanal: '🚨・recrutadores-advertidos',
  razao: 'Tabela de recrutadores advertidos (automáticas e manuais)',
  intervaloMin: 30,
  debounceMs: 5 * 1000,
  montarBlocos: montarAdvertidos,
  canalVizinhoId: config.canais.quadroRecrutadores,
  cargosLeitura: [config.cargos.recrutador],
});

function iniciarPaineis(client) {
  clientAtual = client;
  regras.iniciar(client);
  advertidos.iniciar(client);
}

// Chamado quando uma advertência nasce, sai ou vence: a tabela acompanha na hora
function atualizarAdvertidos(client) {
  clientAtual = client ?? clientAtual;
  if (clientAtual) advertidos.agendarAtualizacaoReativa(clientAtual);
}

module.exports = { iniciarPaineis, atualizarAdvertidos, blocosRegras, montarAdvertidos };

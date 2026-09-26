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

// Seções que outros módulos acrescentam ao quadro de regras (ex.: mérito). Cada uma devolve um embed.
const secoesExtras = [];
function registrarSecaoRegras(fn) {
  if (!secoesExtras.includes(fn)) secoesExtras.push(fn);
}

// ── 📘 Regras ────────────────────────────────────────────────────────────
function blocosRegras() {
  const c = config.canais;
  const ref = (id, nome) => canal(id) ?? nome;
  const fluxo = {
    color: F.COR,
    title: tema.titulo(`${tema.emoji.marca} COMO FUNCIONA O RECRUTAMENTO`),
    description: [
      'O recrutamento começa **dentro do jogo** e termina aqui no Discord. Sua responsabilidade é conduzir o candidato por todas as etapas e **decidir a ficha**.',
      '',
      '**1. Abordagem (no jogo, em frente à sede).** Aborde o candidato e pergunte: nome, de onde vem, idade e se é corintiano. Segurando **Alt** aparece a opção de **convidar para o Discord** da torcida.',
      '',
      `**2. Validar o ID.** Peça o ID FiveM e consulte em ${ref(c.validarId, 'validar-id')} (veja abaixo) **antes** de mandar o candidato preencher a ficha. Se houver impedimento, não siga com o recrutamento.`,
      '',
      `**3. Ficha (Discord).** Já no servidor, o candidato abre o formulário no canal ${ref(c.recrutamento, 'de recrutamento')} (nome, idade, ID FiveM, telefone e recrutador). Quem já tem ficha em análise (até 7 dias) ou reprovação definitiva não abre outra.`,
      '',
      `**4. Manto e perguntas.** Ao enviar a ficha o candidato ganha 10 minutos para postar a foto do manto em ${ref(c.provarManto, 'provar-manto')}. A liderança marca **CORRETO** ou **ERRADO**, e o resultado conta para **você**, o recrutador que decide a ficha (manto errado repetido gera advertência). Com o manto aprovado, faça as perguntas do recrutamento dentro do jogo.`,
      '',
      `**5. Validação da setagem.** A ficha cai em ${ref(c.validarSetagem, 'validar-setagem')} (categoria de setagem), com os botões **APROVAR** e **REPROVAR**. É **aqui** que você decide, só depois do manto aprovado e das perguntas feitas. Um recrutador decide por ficha; o clique duplo é barrado.`,
      '',
      '**6. Aprovar.** O bot dá o cargo de sócio e o nick padrão (**Nome - ID**) sozinho, e o telefone do novo sócio é divulgado à torcida. Se o ID estiver em NÃO RECRUTAR, a aprovação é recusada. Errou o clique? Dá para **desfazer em até 30 minutos**.',
      '',
      '**7. Reprovar.** Escolha a categoria, escreva a justificativa (15 a 1000 caracteres, ela vai por DM ao candidato) e diga se ele **pode tentar de novo**. Reprovação definitiva só a liderança desfaz.',
      '',
      '**8. Depois.** O convite do WhatsApp sai pelo painel próprio, sempre manual.',
    ].join('\n'),
    footer: { text: 'Quadro fixo mantido pelo bot' },
  };

  const consulta = {
    color: F.COR,
    title: tema.titulo(`${tema.emoji.pendente} CANAIS DE CONSULTA: ANTES DE APROVAR`),
    description: [
      'Estes canais respondem à pergunta que decide a ficha: **esta pessoa pode ser recrutada?** Eles cruzam o histórico da torcida, então **consulte antes de aprovar**.',
      '',
      `**${ref(c.validarId, 'validar-id')}: a consulta principal.** Clique em **VALIDAR ID**, digite o ID FiveM da ficha e o bot diz se há impedimento registrado. É a verificação de que a pessoa **não tem vestígio na torcida** que a impeça de ser recrutada. Faça sempre, com o ID exato da ficha.`,
      '',
      `**${ref(c.naoRecrutar, 'nao-recrutar')}: a lista de bloqueados.** IDs impedidos de entrar, cada um com o motivo. Quem está aqui **não é aprovado**. Se souber de alguém que deveria estar na lista, avise a liderança.`,
      '',
      `**${ref(c.historicoNaoRecrutar, 'historico-nao-recrutar')}: o registro completo.** Cada bloqueio fica registrado ali, inclusive os que já foram removidos. É o que o validar-id consulta: use para ver o **motivo** e a **história** de um ID.`,
      '',
      `**${ref(c.reprovadosDefinitivos, 'reprovados-definitivos')}: quem não pode tentar de novo.** Lista os candidatos reprovados com "não pode tentar de novo". Enquanto estiverem ali, o botão de solicitar recrutamento recusa a pessoa, mesmo que ela saia e volte ao servidor. A liderança libera uma nova tentativa quando achar justo.`,
      '',
      '**Regra de bolso:** ficha vinda de alguém que você acabou de abordar → confira o **validar-id**, depois aprove. ID bloqueado ou reprovado definitivo: **não aprove**; se discordar, chame a liderança.',
    ].join('\n'),
    footer: { text: 'Quadro fixo mantido pelo bot' },
  };

  const divulgacao = {
    color: F.COR,
    title: tema.titulo(`${tema.emoji.marca} DIVULGAÇÃO`),
    description: `Poste o flyer no canal ${ref(c.divulgacaoRecrutamento, 'de divulgação')} em rodízio: quem está há mais tempo sem postar é o próximo. Duas vezes seguidas ou mais de 7 dias sem postar gera alerta para a liderança.`,
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
      `**Carência:** quem acabou de receber o cargo só é medido depois de ${L.diasSemRecrutarJogando} a ${L.diasInativo} dias, contados **a partir da promoção a recrutador** registrada nos logs do jogo.`,
      '',
      'Acompanhe quem está advertido no canal 🚨・recrutadores-advertidos.',
    ].join('\n'),
    footer: { text: 'Valores lidos das regras do bot: este quadro acompanha qualquer ajuste' },
  };
  return [{ embeds: [fluxo] }, { embeds: [consulta] }, { embeds: [divulgacao] }, { embeds: [adv] }, ...secoesExtras.map(fn => ({ embeds: [fn()] }))];
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
    // Um bloco por pessoa (uma linha por infração, detalhe em texto miúdo): não se mistura com o vizinho
    const detalhes = lista.map(a => {
      const prazo = a.prazo_em ? ` · prazo <t:${ts(a.prazo_em)}:R>` : '';
      return `> ${R.REGRAS[a.regra]?.rotulo ?? a.regra} · <t:${ts(a.criada_em)}:R>${prazo}\n> -# ${a.motivo}`;
    });
    linhasAdv.push(`<@${id}> — **${lista.length}ª ADV**\n${detalhes.join('\n')}`);
  }
  for (const m of manuais) linhasAdv.push(`<@${m.id}> — **${nivelDoCargo(m)}ª ADV** · manual (liderança)`);

  const limpos = recrutadores.filter(m => !porMembro.has(m.id) && nivelDoCargo(m) === 0);
  const linhasLimpos = limpos.map(m => `${tema.emoji.ok} <@${m.id}>`);
  const linhasEncerradas = encerradas.map(a => {
    const quando = ts(a.resolvida_em ?? a.criada_em);
    return `<@${a.discord_id}> · ${a.status.replace('_', ' ')} · ${R.REGRAS[a.regra]?.rotulo ?? 'INATIVIDADE'} · <t:${quando}:R>`;
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

module.exports = { iniciarPaineis, atualizarAdvertidos, blocosRegras, montarAdvertidos, registrarSecaoRegras };

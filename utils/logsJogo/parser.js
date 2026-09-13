// Parser dos "Registros de Atividade" que o FiveM publica por webhook.
// Puro (sem Discord nem banco) para ser testável. O que não reconhece continua
// sendo gravado como 'desconhecido' — nunca descartado. Regra nova aqui é
// aplicada retroativamente ao histórico já gravado por
// ingestao.reprocessarDesconhecidos, rodada a cada arranque do bot.
const { corrigirMojibake } = require('./estatisticas');

// O jogo manda HTML em alguns logs ("Renato Lhp <b>adicionou tag</b> #1588"),
// que colava a tag no verbo e fazia a regra não casar — some junto com o
// markdown. Mojibake ("Fabio PeÃ§a") é corrigido aqui, no ponto em que o log
// entra: nome é o que liga ID do jogo a sócio do Discord por semelhança, e
// nome quebrado nunca casa com ninguém.
function limparMarkdown(texto) {
  return corrigirMojibake(
    String(texto ?? '').replace(/<\/?[a-z][^>]*>/gi, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()
  );
}

// Rodapé: "Time: Gaviões da Fiel | Categoria: lideranca • Hoje às 20:15"
function extrairCategoria(rodape) {
  const m = String(rodape ?? '').match(/Categoria:\s*([^•|\n]+)/i);
  return m ? m[1].trim().toLowerCase() : null;
}

function extrairAtorDoTitulo(titulo) {
  const m = limparMarkdown(titulo).match(/^Registro de Atividade:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

function extrairIds(texto) {
  return [...limparMarkdown(texto).matchAll(/\(\s*ID:\s*(\d+)\s*\)/gi)].map(m => m[1]);
}

function normalizarNumero(bruto) {
  let s = bruto.replace(/\s/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.500,00
  else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, '');          // 1.500
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Dinheiro do jogo: "$ 1.500", "R$ 1.500,00", "$2500"
function extrairValor(texto) {
  const m = limparMarkdown(texto).match(/(?:R\$|US\$|\$)\s?(\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
  return m ? normalizarNumero(m[1]) : null;
}

// Formatos conhecidos. Cada exemplo novo de log vira uma regra aqui.
const REGRAS = [
  {
    acao: 'novato_entrou',
    // "O Novato Rarin Dimarolla (ID: 8914 ) entrou na sua torcida Novato."
    teste: d => /novato/i.test(d) && /entrou na sua torcida/i.test(d),
    extrair: d => ({
      atorNome: d.match(/O Novato\s+(.+?)\s*\(\s*ID:/i)?.[1]?.trim() ?? null,
      atorIdFivem: d.match(/\(\s*ID:\s*(\d+)\s*\)/i)?.[1] ?? null,
    }),
  },
  {
    acao: 'jogador_entrou',
    // "#19200 Bigode lmzz entrou no servidor." (canal logs-painel)
    teste: d => /^#\d+\s+.+\bentrou\b.*\bservidor\b/i.test(d),
    extrair: d => {
      const m = d.match(/^#(\d+)\s+(.+?)\s+entrou\b/i);
      return { atorIdFivem: m?.[1] ?? null, atorNome: m?.[2]?.trim() ?? null, categoria: 'conexao' };
    },
  },
  {
    acao: 'jogador_saiu',
    // "#19200 Bigode lmzz saiu do servidor." (canal logs-painel)
    teste: d => /^#\d+\s+.+\bsaiu\b.*\bservidor\b/i.test(d),
    extrair: d => {
      const m = d.match(/^#(\d+)\s+(.+?)\s+saiu\b/i);
      return { atorIdFivem: m?.[1] ?? null, atorNome: m?.[2]?.trim() ?? null, categoria: 'conexao' };
    },
  },
  {
    acao: 'jogador_recrutou',
    // "#15277 Tiago Magrão recrutou #19465 Gelado Silva." (canal do sistema
    // de recrutamento do próprio jogo — nada a ver com o /recrutamento do
    // Discord). Cada recrutamento novo soma 1 em SÓCIOS SETADOS (CONFERIDO À
    // MÃO) no painel de jogadores — ver events/messageCreate.js.
    teste: d => /^#\d+\s+.+\brecrutou\b\s+#\d+/i.test(d),
    extrair: d => {
      const m = d.match(/^#(\d+)\s+(.+?)\s+recrutou\s+#(\d+)\s+(.+?)\.?\s*$/i);
      return {
        atorIdFivem: m?.[1] ?? null,
        atorNome: m?.[2]?.trim() ?? null,
        alvoIdFivem: m?.[3] ?? null,
        alvoNome: m?.[4]?.trim() ?? null,
        categoria: 'recrutamento',
      };
    },
  },
  {
    acao: 'sede_trancou',
    // "#163 Gladiador LHP trancou a sede." (canal logs-painel)
    teste: d => /^#\d+\s+.+\btrancou\s+a sede\b/i.test(d),
    extrair: d => extrairAtorNumerado(d, /trancou\s+a sede/i, { categoria: 'patrimonio' }),
  },
  {
    acao: 'sede_destrancou',
    // "#13067 Cris Sabará destrancou a sede."
    teste: d => /^#\d+\s+.+\bdestrancou\s+a sede\b/i.test(d),
    extrair: d => extrairAtorNumerado(d, /destrancou\s+a sede/i, { categoria: 'patrimonio' }),
  },
  {
    acao: 'portao_trancou',
    // "#1983 Joao Vitor trancou o portão do galpão." / "... o portão externo."
    teste: d => /^#\d+\s+.+\btrancou\s+o portão\b/i.test(d),
    extrair: d => extrairAtorNumerado(d, /trancou\s+o portão/i, { categoria: 'patrimonio' }),
  },
  {
    acao: 'portao_destrancou',
    // "#7311 Bragunso Pertubado destrancou o portão externo."
    teste: d => /^#\d+\s+.+\bdestrancou\s+o portão\b/i.test(d),
    extrair: d => extrairAtorNumerado(d, /destrancou\s+o portão/i, { categoria: 'patrimonio' }),
  },
  {
    acao: 'usou_sistema_porta',
    // "O jogador Mgzin Lhp (ID: 377) usou o sistema de trancar porta." — não
    // diz se foi pra trancar ou destrancar, só que alguém usou o sistema.
    // Conta como atividade de liderança mesmo sem saber o estado resultante.
    teste: d => /usou o sistema de trancar porta/i.test(d),
    extrair: d => ({
      atorNome: d.match(/O jogador\s+(.+?)\s*\(\s*ID:/i)?.[1]?.trim() ?? null,
      atorIdFivem: d.match(/\(\s*ID:\s*(\d+)\s*\)/i)?.[1] ?? null,
      categoria: 'patrimonio',
    }),
  },
  {
    acao: 'convocou_equipe',
    // "O jogador Japa Sccp (ID: 368) convocou a equipe para a sede."
    teste: d => /convocou a equipe/i.test(d),
    extrair: d => ({
      atorNome: d.match(/O jogador\s+(.+?)\s*\(\s*ID:/i)?.[1]?.trim() ?? null,
      atorIdFivem: d.match(/\(\s*ID:\s*(\d+)\s*\)/i)?.[1] ?? null,
      categoria: 'lideranca',
    }),
  },
  {
    acao: 'promoveu_cargo',
    // "#560 Gabriel Inajar promoveu #7670 Milgrau LHP (Sócio > Recrutador)."
    // O "(X > Y)" fica intacto na descrição — quem for montar o histórico de
    // carreira relê a partir dela, não precisa de coluna nova no banco.
    teste: d => /^#\d+\s+.+\bpromoveu\s+#\d+/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /promoveu/i, { categoria: 'hierarquia' }),
  },
  {
    acao: 'rebaixou_cargo',
    // "#1535 Texugo daBaixada rebaixou #196 Miguel ZonaLeste (Diretor > Recrutador)."
    teste: d => /^#\d+\s+.+\brebaixou\s+#\d+/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /rebaixou/i, { categoria: 'hierarquia' }),
  },
  {
    acao: 'expulso_torcida',
    // "#2190 Macaco Loko removeu #3766 Paulo Vitor ()." e também com o motivo
    // preenchido: "... removeu #18493 Enzo Tody (Traidor)." O motivo é lido da
    // descrição por E.extrairEntreParenteses.
    //
    // Antes daqui só passava quem tinha parênteses VAZIOS, então toda expulsão
    // COM motivo escrito caía em 'desconhecido' e não contava no churn — 65
    // expulsões no histórico até 2026-09-13. O que separa isto de "removeu
    // blacklist/suspensão/impedimento/tag" é o #ID vir imediatamente depois do
    // verbo (lá vem a palavra da lista antes), não os parênteses.
    teste: d => /^#\d+\s+.+\bremoveu\s+#\d+/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /removeu/i, { categoria: 'saida' }),
  },
  {
    acao: 'removido_torcida_automatico',
    // "#10728 Jhow Sccp removido automaticamente da torcida (sem login há
    // mais de 10 dias)." — o próprio sistema do jogo removeu por inatividade,
    // não tem "ator" que agiu, só o alvo removido.
    teste: d => /removido automaticamente da torcida/i.test(d),
    extrair: d => {
      const m = d.match(/^#(\d+)\s+(.+?)\s+removido automaticamente/i);
      return { alvoIdFivem: m?.[1] ?? null, alvoNome: m?.[2]?.trim() ?? null, categoria: 'saida' };
    },
  },
  {
    acao: 'saiu_torcida',
    // "#906 pepe dobronx saiu da torcida." — saída voluntária.
    teste: d => /^#\d+\s+.+\bsaiu da torcida\b/i.test(d),
    extrair: d => extrairAtorNumerado(d, /saiu da torcida/i, { categoria: 'saida' }),
  },

  // ── Baú da torcida (canal logs-baú) ──────────────────────────────────────
  // Formato próprio, diferente de todo o resto: o que aconteceu e em QUAL baú
  // ficam no título ("Guardou [GDF Sócio]", "Removeu [GDF Presidência]") e a
  // descrição é um par nome/valor por linha:
  //   Usuário: `19578`  Item: `tecido`  Quantidade: `1`
  // Por isso essas duas regras olham o título também (2º argumento de teste/
  // extrair) — nenhuma outra precisa. O baú fica em `titulo` (gravado cru), de
  // onde as consultas o leem; ver repositorio.saldoBau e E.bauDoTitulo.
  // O log não traz o NOME do jogador, só o ID — quem exibe resolve o nome pelo
  // último apelido visto pra esse ID nos outros canais (repo.nomesPorIds).
  {
    acao: 'bau_guardou',
    teste: (d, t) => /^Guardou\s*\[/i.test(t) && /Usu[aá]rio:/i.test(d),
    extrair: d => extrairBau(d),
  },
  {
    acao: 'bau_removeu',
    teste: (d, t) => /^Removeu\s*\[/i.test(t) && /Usu[aá]rio:/i.test(d),
    extrair: d => extrairBau(d),
  },

  // ── Fechaduras que não são sede nem portão ───────────────────────────────
  // "O jogador Blaczx Inajar (ID: 855) trancou a arena." — e vestiario,
  // protecao, bau, novato, entrada automatica. Aqui a fechadura vai em
  // `alvoNome`, o que deixa qualquer fechadura nova do jogo aparecer sozinha no
  // painel, sem regra nova.
  //
  // Sede e portão continuam com regra própria porque o nome daquelas ações está
  // em 14 mil registros antigos (e o módulo de segurança vigia por ele) — mas
  // como aquelas regras vêm ANTES desta na lista, elas ganham o registro
  // primeiro e esta não precisa excluir nada. Uma sede que chegue no formato do
  // canal de liderança (que as regras de sede não cobrem, por exigirem "#<ID>"
  // no começo) cai aqui como fechadura "sede" em vez de virar 'desconhecido' —
  // e o painel de fechaduras junta as duas formas (ver analises.FECHADURAS).
  {
    acao: 'fechadura_destrancou',
    teste: d => /\bdestrancou\s+a\s+/i.test(d),
    extrair: d => extrairFechadura(d, /destrancou/i),
  },
  {
    acao: 'fechadura_trancou',
    teste: d => /\btrancou\s+a\s+/i.test(d),
    extrair: d => extrairFechadura(d, /trancou/i),
  },
  {
    acao: 'protecao_alternou',
    // "O jogador Cartoon Rsj (ID: 371) alternou a proteção de sede." — o log
    // não diz se ligou ou desligou, só que mexeu (mesmo caso de
    // usou_sistema_porta).
    teste: d => /alternou a prote[çc][ãa]o/i.test(d),
    extrair: d => ({ ...extrairAtorQualquer(d, /alternou/i), categoria: 'patrimonio', alvoNome: 'proteção de sede' }),
  },
  {
    acao: 'arena_bloqueou',
    // "#182 Bxlhp Inajar bloqueou arena." — bloquear a arena é outro sistema:
    // não é trancar a porta dela (fechadura_trancou), é fechar o uso.
    teste: d => /\bbloqueou\s+arena\b/i.test(d),
    extrair: d => ({ ...extrairAtorQualquer(d, /bloqueou/i), categoria: 'patrimonio', alvoNome: 'arena' }),
  },
  {
    acao: 'arena_desbloqueou',
    teste: d => /\bdesbloqueou\s+arena\b/i.test(d),
    extrair: d => ({ ...extrairAtorQualquer(d, /desbloqueou/i), categoria: 'patrimonio', alvoNome: 'arena' }),
  },

  // ── Tags (funções internas do jogo: RSJ, Arsenal, Materiais, Rádio…) ─────
  // "#1716 Akemi GDF adicionou tag #3157 Ghosting JIUTHAI (RSJ)." — a tag fica
  // entre parênteses no fim da descrição, lida por E.extrairEntreParenteses
  // (mesma escolha de promoveu_cargo: não vira coluna nova).
  {
    acao: 'tag_adicionou',
    teste: d => /\badicionou\s+tag\b/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /adicionou tag/i, { categoria: 'tag' }),
  },
  {
    acao: 'tag_removeu',
    teste: d => /\bremoveu\s+tag\b/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /removeu tag/i, { categoria: 'tag' }),
  },

  // ── Restrições: quem o jogo barra na torcida ─────────────────────────────
  // Impedimento é do jogador ("adicionou impedimento #5150 Mkzin RSJ");
  // blacklist e suspensão são da torcida ("... da torcida #15676 Rafinha").
  // Alvo "#nil nil nil" (jogador que o jogo não resolveu) não casa o #ID e sai
  // com alvo vazio — o ator continua sendo gravado (ver extrairAtorEAlvo).
  {
    acao: 'impedimento_adicionou',
    teste: d => /\badicionou\s+impedimento\b/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /adicionou impedimento/i, { categoria: 'restricao' }),
  },
  {
    acao: 'impedimento_removeu',
    teste: d => /\bremoveu\s+impedimento\b/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /removeu impedimento/i, { categoria: 'restricao' }),
  },
  {
    acao: 'blacklist_adicionou',
    teste: d => /\badicionou\s+blacklist\b/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /adicionou blacklist da torcida/i, { categoria: 'restricao' }),
  },
  {
    acao: 'blacklist_removeu',
    teste: d => /\bremoveu\s+blacklist\b/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /removeu blacklist da torcida/i, { categoria: 'restricao' }),
  },
  {
    acao: 'suspensao_adicionou',
    teste: d => /\badicionou\s+suspens[ãa]o\b/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /adicionou suspens[ãa]o da torcida/i, { categoria: 'restricao' }),
  },
  {
    acao: 'suspensao_removeu',
    teste: d => /\bremoveu\s+suspens[ãa]o\b/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /removeu suspens[ãa]o da torcida/i, { categoria: 'restricao' }),
  },

  // ── Disciplina: multa, advertência e serviços ────────────────────────────
  // Nas três ações de advertência o jogador que LEVA a punição é sempre o
  // `alvo`, mesmo quando a frase do jogo o põe como sujeito ("FINALIZOU sua
  // advertência"): é o que deixa reconstruir o estado atual de um jogador
  // olhando só o último evento dele (ver analises.advertenciasAtivas).
  {
    acao: 'multou',
    // "#14589 Guilherme Skunk multou #4072 cabeleira LHP (Não obedece...)."
    teste: d => /^#\d+\s+.+\bmultou\s+#\d+/i.test(d),
    extrair: d => extrairAtorEAlvo(d, /multou/i, { categoria: 'disciplina' }),
  },
  {
    acao: 'advertido',
    // "O jogador Mn Lhp (ID: 898) foi ADVERTIDO por Blaczx Inajar. Motivo: adv
    // 1 Servicos: 100" — motivo e serviços saem da descrição (E.extrairMotivo,
    // E.extrairServicos). Quem advertiu vem sem ID no log, só o nome.
    teste: d => /foi ADVERTIDO por/i.test(d),
    extrair: d => {
      const m = d.match(/^O\s+jogador\s+(.+?)\s*\(\s*ID:\s*(\d+)\s*\)\s+foi ADVERTIDO por\s+(.+?)\s*\.\s*Motivo:/i);
      return {
        alvoNome: m?.[1]?.trim() ?? null,
        alvoIdFivem: m?.[2] ?? null,
        atorNome: m?.[3]?.trim() ?? null,
        atorIdFivem: null,
        categoria: 'disciplina',
      };
    },
  },
  {
    acao: 'adv_finalizou',
    // "O jogador Lucas Souzinha (ID: 7285) FINALIZOU sua advertência."
    teste: d => /FINALIZOU sua advert[êe]ncia/i.test(d),
    extrair: d => {
      const ator = extrairAtorQualquer(d, /FINALIZOU/i);
      return { atorNome: null, atorIdFivem: null, alvoNome: ator.atorNome, alvoIdFivem: ator.atorIdFivem, categoria: 'disciplina' };
    },
  },
  {
    acao: 'adv_removida',
    // "O administrador Japones Inajar (ID: 2295) REMOVEU MANUALMENTE a
    // advertência do jogador Fabio Peça (ID: 331)." — perdão de advertência
    // pela liderança, o que mais interessa auditar aqui.
    teste: d => /REMOVEU MANUALMENTE a advert[êe]ncia/i.test(d),
    extrair: d => {
      const alvo = d.match(/do jogador\s+(.+?)\s*\(\s*ID:\s*(\d+)\s*\)/i);
      return {
        ...extrairAtorQualquer(d, /REMOVEU MANUALMENTE/i),
        alvoNome: alvo?.[1]?.trim() ?? null,
        alvoIdFivem: alvo?.[2] ?? null,
        categoria: 'disciplina',
      };
    },
  },

  // ── Dinheiro ─────────────────────────────────────────────────────────────
  // Dois caixas diferentes, que o painel nunca soma juntos: o BANCO DA TORCIDA
  // (depósito/saque) e o bolso do sócio (roupa, voucher, arsenal…).
  {
    acao: 'banco_depositou',
    // "O jogador ID 855 depositou R$ 100000 no banco da torcida." (às vezes o
    // jogo manda só o ID, sem nome — ver extrairAtorQualquer)
    teste: d => /depositou\s+.*no banco da torcida/i.test(d),
    extrair: d => ({ ...extrairAtorQualquer(d, /depositou/i), categoria: 'economia' }),
  },
  {
    acao: 'banco_sacou',
    // "O presidente ID 901 sacou R$ 120000 do banco da torcida."
    teste: d => /sacou\s+.*do banco da torcida/i.test(d),
    extrair: d => ({ ...extrairAtorQualquer(d, /sacou/i), categoria: 'economia' }),
  },
  {
    acao: 'comprou_roupa',
    // "O jogador Pitoco Inajar (ID: 1319) comprou 1 peça(s) de roupa por R$ 250."
    teste: d => /comprou\s+\d+\s+pe[çc]a/i.test(d),
    extrair: d => ({ ...extrairAtorQualquer(d, /comprou/i), categoria: 'economia', alvoNome: 'roupa' }),
  },
  {
    acao: 'comprou_item',
    // "#13067 Cris Sabará comprou +1 Revolver no Arsenal." / "comprou 1x Slot
    // de Tag." / "comprou Adicionar Material." / "comprou Voucher de R$35."
    // O que foi comprado vira `alvoNome` — é o agrupamento do painel de caixa.
    teste: d => /^#\d+\s+.+\bcomprou\b/i.test(d),
    extrair: d => ({
      ...extrairAtorQualquer(d, /comprou/i),
      alvoNome: d.match(/\bcomprou\s+(.+?)\s*\.?\s*$/i)?.[1]?.trim() ?? null,
      categoria: 'economia',
    }),
  },

  // ── Configuração do sistema da torcida (volume baixo, risco alto) ────────
  {
    acao: 'config_alterou',
    // "#560 Gabriel Inajar alterou a configuração de webhook_log." — quem mexe
    // no webhook mexe na própria fonte destes logs, por isso vale auditar.
    teste: d => /alterou a configura[çc][ãa]o de/i.test(d),
    extrair: d => ({
      ...extrairAtorQualquer(d, /alterou/i),
      alvoNome: d.match(/alterou a configura[çc][ãa]o de\s+(.+?)\s*\.?\s*$/i)?.[1]?.trim() ?? null,
      categoria: 'config',
    }),
  },
  {
    acao: 'tag_alterou',
    // "#163 Gladiador LHP alterou tag (R.S.J. > R.S.J.)." — é a definição da
    // tag que mudou, não quem a tem (E.extrairMudancaCargo lê o "de > para").
    teste: d => /alterou tag\s*\(/i.test(d),
    extrair: d => ({ ...extrairAtorQualquer(d, /alterou tag/i), categoria: 'config' }),
  },
  {
    acao: 'cargo_editado',
    // "O jogador ID 953 criou/editou o cargo Diretoria."
    teste: d => /criou\/editou o cargo/i.test(d),
    extrair: d => ({
      ...extrairAtorQualquer(d, /criou\/editou/i),
      alvoNome: d.match(/criou\/editou o cargo\s+(.+?)\s*\.?\s*$/i)?.[1]?.trim() ?? null,
      categoria: 'config',
    }),
  },

  // ── Canal logs-banco: moedas da torcida ──────────────────────────────────
  // Mesmo estilo do baú: o TÍTULO diz o que aconteceu e a descrição é um
  // "Chave: valor" por linha ("Torcida: gavioes / ID: 13067 / Valor: 1500000").
  // São TRÊS moedas que nunca se somam — Coins (território), Dinheiro (R$) e
  // Honra — e todas vão em `valor`: por isso toda consulta que soma `valor`
  // filtra por ação (ver repositorio.ACOES_DINHEIRO).
  {
    acao: 'coins_dominacao',
    // "Origem: Dominação (1h): Farol / Coins: +3" — cada uma é UMA hora com o
    // território dominado, então contar eventos = contar horas de domínio.
    teste: (d, t) => /^Coins$/i.test(t) && /Origem:\s*Domina/i.test(d),
    extrair: d => ({
      alvoNome: campoBanco(d, 'Origem')?.replace(/^Domina[çc][ãa]o\s*(?:\([^)]*\))?\s*:\s*/i, '') ?? null,
      valor: numeroBanco(campoBanco(d, 'Coins')),
      categoria: 'territorio',
    }),
  },
  {
    acao: 'coins_conquista',
    // "Origem: Conquista: Petrolífera / Coins: +10" — o momento em que o
    // território foi tomado (a dominação por hora vem depois).
    teste: (d, t) => /^Coins$/i.test(t) && /Origem:\s*Conquista/i.test(d),
    extrair: d => ({
      alvoNome: campoBanco(d, 'Origem')?.replace(/^Conquista\s*:\s*/i, '') ?? null,
      valor: numeroBanco(campoBanco(d, 'Coins')),
      categoria: 'territorio',
    }),
  },
  {
    acao: 'banco_depositou',
    // "Depositou dinheiro" — mesma ação do formato antigo do canal
    // logs-liderança ("depositou R$ ... no banco da torcida"), que parou.
    teste: (d, t) => /^Depositou dinheiro$/i.test(t),
    extrair: d => ({ atorIdFivem: campoBanco(d, 'ID'), atorNome: null, valor: numeroBanco(campoBanco(d, 'Valor')), categoria: 'economia' }),
  },
  {
    acao: 'banco_sacou',
    teste: (d, t) => /^Sacou dinheiro$/i.test(t),
    extrair: d => ({ atorIdFivem: campoBanco(d, 'ID'), atorNome: null, valor: numeroBanco(campoBanco(d, 'Valor')), categoria: 'economia' }),
  },
  {
    acao: 'dinheiro_adicionado',
    // "Dinheiro Adicionado / Usuário: 2 / Valor: 2000000" — dinheiro que entra
    // sem vir de jogador nenhum (staff do servidor), separado de depósito.
    teste: (d, t) => /^Dinheiro Adicionado$/i.test(t),
    extrair: d => ({ atorIdFivem: campoBanco(d, 'Usu[aá]rio'), atorNome: null, valor: numeroBanco(campoBanco(d, 'Valor')), categoria: 'economia' }),
  },
  {
    acao: 'honra_gastou',
    // "Gastou honra / ID: 560 / Valor: 1000 / Item: 1x Slot de Tag"
    teste: (d, t) => /^Gastou honra$/i.test(t),
    extrair: d => ({
      atorIdFivem: campoBanco(d, 'ID'),
      atorNome: null,
      valor: numeroBanco(campoBanco(d, 'Valor')),
      alvoNome: campoBanco(d, 'Item'),
      categoria: 'economia',
    }),
  },
  {
    acao: 'honra_adicionada',
    teste: (d, t) => /^Honra adicionada$/i.test(t),
    extrair: d => ({ atorIdFivem: campoBanco(d, 'ID'), atorNome: null, valor: numeroBanco(campoBanco(d, 'Valor')), categoria: 'economia' }),
  },

  // Formatos ANTIGOS do mesmo canal (até 2026-07-19), trocados pelos títulos de
  // cima sem sobreposição de datas (conferido no histórico inteiro do canal em
  // 2026-09-13). "Dinheiro" e "Honra" eram um título só, com o SINAL no valor
  // ("Usuário: 6 / Valor: -500"): positivo entra, negativo sai. "Banco" era o
  // prêmio em R$ de conquista ("Usuário: Conquista: Farol / Valor: 15000").
  // Viram as mesmas ações dos títulos novos (valor sempre positivo), pra que o
  // histórico some junto sem nenhum painel precisar saber que o jogo mudou o
  // texto. As regras de saída vêm antes: a de entrada não olha o sinal.
  {
    acao: 'banco_sacou',
    teste: (d, t) => /^Dinheiro$/i.test(t) && /Valor:\s*-/i.test(d),
    extrair: d => movimentoAntigo(d),
  },
  {
    acao: 'banco_depositou',
    teste: (d, t) => /^Dinheiro$/i.test(t),
    extrair: d => movimentoAntigo(d),
  },
  {
    acao: 'honra_gastou',
    teste: (d, t) => /^Honra$/i.test(t) && /Valor:\s*-/i.test(d),
    extrair: d => movimentoAntigo(d),
  },
  {
    acao: 'honra_adicionada',
    teste: (d, t) => /^Honra$/i.test(t),
    extrair: d => movimentoAntigo(d),
  },
  {
    acao: 'dinheiro_conquista',
    teste: (d, t) => /^Banco$/i.test(t) && /Usu[aá]rio:\s*Conquista/i.test(d),
    extrair: d => ({
      alvoNome: campoBanco(d, 'Usu[aá]rio')?.replace(/^Conquista\s*:\s*/i, '') ?? null,
      valor: numeroBanco(campoBanco(d, 'Valor')),
      categoria: 'economia',
    }),
  },

  // ── Baú de Recompensas (canal logs-baú) ──────────────────────────────────
  // Outro baú no mesmo canal, com formato próprio: "Baú de Recompensas [GDF] -
  // Depósito (Staff)" / "- Retirada (Torcida)", e descrição "Personagem: #13067
  // Cris Sabará / Item: Maconha / Quantidade: 500 / Data: …". A staff põe o
  // prêmio e a liderança retira. Vira as mesmas ações do baú comum (o
  // compartimento "Recompensas" sai do título, ver E.bauDoTitulo) — e, ao
  // contrário do baú comum, este log traz o nome de quem mexeu.
  {
    acao: 'bau_guardou',
    teste: (d, t) => /^Ba[úu] de Recompensas\b.*\bDep[óo]sito\b/i.test(t) && /Personagem:/i.test(d),
    extrair: d => extrairRecompensa(d),
  },
  {
    acao: 'bau_removeu',
    teste: (d, t) => /^Ba[úu] de Recompensas\b.*\bRetirada\b/i.test(t) && /Personagem:/i.test(d),
    extrair: d => extrairRecompensa(d),
  },
];

function movimentoAntigo(d) {
  const valor = numeroBanco(campoBanco(d, 'Valor'));
  return { atorIdFivem: campoBanco(d, 'Usu[aá]rio'), atorNome: null, valor: valor == null ? null : Math.abs(valor), categoria: 'economia' };
}

// "Personagem: #13067 Cris Sabará" → ID e nome de quem mexeu.
function extrairRecompensa(d) {
  const personagem = campoBanco(d, 'Personagem')?.match(/^#(\d+)\s*(.*)$/);
  return {
    atorIdFivem: personagem?.[1] ?? null,
    atorNome: personagem?.[2]?.trim() || null,
    alvoNome: campoBanco(d, 'Item'),
    valor: numeroBanco(campoBanco(d, 'Quantidade')),
    categoria: 'bau',
  };
}

// "Chave: valor" do canal logs-banco e do Baú de Recompensas, já com as linhas
// juntadas por espaço pelo limparMarkdown. O valor vai até a próxima chave
// CONHECIDA, não até o próximo ":" — porque o próprio valor pode ter ":"
// ("Origem: Dominação (1h): Farol", "Usuário: Conquista: Farol").
const CHAVES_BANCO = 'Torcida|ID|Valor|Item|Usu[aá]rio|Origem|Coins|Personagem|Quantidade|Data';

function campoBanco(d, chave) {
  const m = d.match(new RegExp(`(?:^|\\s)${chave}:\\s*(.+?)(?=\\s+(?:${CHAVES_BANCO}):|$)`, 'i'));
  const valor = m?.[1]?.trim();
  return valor ? valor : null;
}

function numeroBanco(bruto) {
  return bruto == null ? null : normalizarNumero(bruto.replace(/^\+/, ''));
}

// "#<ID> Nome <verbo...>" — o padrão mais comum do canal logs-painel: um
// ator numerado seguido do verbo que casou no teste() da regra.
function extrairAtorNumerado(d, verboRegex, extra = {}) {
  const m = d.match(new RegExp(`^#(\\d+)\\s+(.+?)\\s+${verboRegex.source}`, 'i'));
  return { atorIdFivem: m?.[1] ?? null, atorNome: m?.[2]?.trim() ?? null, ...extra };
}

// Quem agiu, nas três formas que o jogo usa pro mesmo papel:
//   "#<ID> Nome <verbo>"                  (canal logs-painel)
//   "O jogador Nome (ID: <n>) <verbo>"    (canal logs-liderança)
//   "O jogador ID <n> <verbo>"            (idem, quando o jogo perde o nome)
function extrairAtorQualquer(d, verboRegex) {
  const numerado = d.match(new RegExp(`^#(\\d+)\\s+(.+?)\\s+${verboRegex.source}`, 'i'));
  if (numerado) return { atorIdFivem: numerado[1], atorNome: numerado[2].trim() };
  const nomeado = d.match(/^O\s+(?:jogador|Novato|administrador|presidente)\s+(.+?)\s*\(\s*ID:\s*(\d+)\s*\)/i);
  if (nomeado) return { atorIdFivem: nomeado[2], atorNome: nomeado[1].trim() };
  const soId = d.match(/^O\s+(?:jogador|administrador|presidente)\s+ID\s+(\d+)\b/i);
  if (soId) return { atorIdFivem: soId[1], atorNome: null };
  return { atorIdFivem: null, atorNome: null };
}

// "<ator> <verbo> #<ID> Alvo (...)." — ator agindo sobre um alvo numerado
// (promoção, rebaixamento, expulsão, tag, impedimento, blacklist, multa).
// Ator e alvo são extraídos em separado de propósito: quando o jogo não resolve
// o alvo e manda "#nil nil nil", o ator continua gravado em vez de o registro
// inteiro sair vazio.
function extrairAtorEAlvo(d, verboRegex, extra = {}) {
  const alvo = d.match(new RegExp(`${verboRegex.source}\\s+#(\\d+)\\s+(.+?)\\s*(?:\\(|\\.|$)`, 'i'));
  return {
    ...extrairAtorQualquer(d, verboRegex),
    alvoIdFivem: alvo?.[1] ?? null,
    alvoNome: alvo?.[2]?.trim() ?? null,
    ...extra,
  };
}

// "<ator> trancou/destrancou a <fechadura>." — a fechadura vem como texto
// livre do jogo, então entra em `alvoNome` como o jogo escreveu ("vestiario",
// "entrada automatica"): fechadura nova aparece sozinha, sem regra nova.
function extrairFechadura(d, verboRegex) {
  const nome = d.match(new RegExp(`${verboRegex.source}\\s+a\\s+(.+?)\\s*\\.?\\s*$`, 'i'))?.[1]?.trim() ?? null;
  return { ...extrairAtorQualquer(d, verboRegex), alvoNome: nome, categoria: 'patrimonio' };
}

// "Usuário: 19578 Item: tecido Quantidade: 1" (canal logs-baú). Quantidade vai
// pra `valor` — é a única coluna numérica da tabela, e é ela que o saldo soma.
function extrairBau(d) {
  const m = d.match(/Usu[aá]rio:\s*(\d+)\s+Item:\s*(.+?)\s+Quantidade:\s*(\d+)/i);
  return {
    atorIdFivem: m?.[1] ?? null,
    atorNome: null,
    alvoNome: m?.[2]?.trim() ?? null,
    valor: m ? Number(m[3]) : null,
    categoria: 'bau',
  };
}

function parseRegistro(embed) {
  const titulo = limparMarkdown(embed?.title);
  const descricao = limparMarkdown(embed?.description);
  const campos = limparMarkdown((embed?.fields ?? []).map(f => `${f.name}: ${f.value}`).join(' | '));
  const textoCompleto = [descricao, campos].filter(Boolean).join(' | ');

  const base = {
    categoria: extrairCategoria(embed?.footer?.text),
    titulo: titulo || null,
    descricao: textoCompleto || null,
    atorNome: extrairAtorDoTitulo(titulo),
    atorIdFivem: null,
    alvoNome: null,
    alvoIdFivem: null,
    valor: extrairValor(textoCompleto),
  };

  // O título só importa pro baú (é onde o jogo diz o que aconteceu e em qual
  // baú); as outras regras ignoram o 2º argumento.
  const regra = REGRAS.find(r => r.teste(descricao, titulo));
  if (regra) return { ...base, ...regra.extrair(descricao, titulo), acao: regra.acao };

  // Genérico: primeiro ID é de quem agiu, segundo é do alvo
  const ids = extrairIds(textoCompleto);
  return { ...base, atorIdFivem: ids[0] ?? null, alvoIdFivem: ids[1] ?? null, acao: 'desconhecido' };
}

module.exports = { parseRegistro, limparMarkdown, extrairCategoria, extrairValor };

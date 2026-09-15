// Cálculos puros das estatísticas dos logs (sem Discord nem banco).

const FUSO = 'America/Sao_Paulo';
const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
const BLOCOS = '▁▂▃▄▅▆▇█';

const PERIODOS = {
  hoje: { dias: 1, rotulo: 'HOJE' },
  '7d': { dias: 7, rotulo: 'ÚLTIMOS 7 DIAS' },
  '30d': { dias: 30, rotulo: 'ÚLTIMOS 30 DIAS' },
  '90d': { dias: 90, rotulo: 'ÚLTIMOS 90 DIAS' },
  '180d': { dias: 180, rotulo: 'ÚLTIMOS 6 MESES' },
  '365d': { dias: 365, rotulo: 'ÚLTIMOS 12 MESES' },
  tudo: { dias: null, rotulo: 'TODO O HISTÓRICO' },
};

// Lista em ordem cronológica: do período mais recente/curto pro mais antigo/
// longo. Só janela rolante (a partir de agora) — o par "X passado" (semana/
// mês/trimestre/semestre/ano passado) saiu daqui por confundir mais do que
// ajudar: não é período civil de verdade (não é "semana começando na
// segunda"), só o bloco anterior de mesma duração, e ficava parecendo
// sinônimo de "últimos N dias" pra quem lê no Discord. "Ontem" continua
// (esse sim é sempre um dia civil fechado, sem ambiguidade). "Semana
// passada"/"mês passado" continuam existindo como período (resolverPeriodo),
// só não aparecem mais nessa lista — ver PERIODOS_FICHA em relatorios.js.
const PERIODO_CHOICES = [
  { name: 'Hoje', value: 'hoje' },
  { name: 'Ontem', value: 'ontem' },
  { name: 'Últimos 7 dias', value: '7d' },
  { name: 'Últimos 30 dias', value: '30d' },
  { name: 'Últimos 90 dias', value: '90d' },
  { name: 'Últimos 6 meses', value: '180d' },
  { name: 'Últimos 12 meses', value: '365d' },
  { name: 'Todo o histórico', value: 'tudo' },
];

const formatadorDia = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

// Dia civil em São Paulo, "YYYY-MM-DD"
function chaveDia(data) {
  return formatadorDia.format(new Date(data));
}

// São Paulo é UTC-3 fixo (sem horário de verão desde 2019)
function inicioDoDiaSP(data) {
  return new Date(`${chaveDia(data)}T00:00:00-03:00`);
}

const formatadorHora = new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', hour12: false });

// Hora civil em São Paulo, "YYYY-MM-DD HHh"
function chaveHora(data) {
  const hora = formatadorHora.format(new Date(data)).replace(/\D/g, '').padStart(2, '0');
  return `${chaveDia(data)} ${hora}h`;
}

function inicioDaHoraSP(data) {
  const [dia, horaRotulo] = chaveHora(data).split(' ');
  return new Date(`${dia}T${horaRotulo.replace('h', '')}:00:00-03:00`);
}

// Início da semana civil (segunda 00h, fuso SP) que contém `data`. Diferente
// de resolverPeriodo('7d'), que é janela rolante de 7 dias — isso aqui é a
// semana de calendário de verdade: zera na virada de domingo pra segunda,
// não vai "descontando" um recrutamento de cada vez conforme envelhece.
function inicioDaSemanaSP(data) {
  const meiaNoite = inicioDoDiaSP(data);
  const diaSemana = meiaNoite.getUTCDay(); // 0=domingo .. 6=sábado
  const diasDesdeSegunda = (diaSemana + 6) % 7; // segunda=0 .. domingo=6
  return new Date(meiaNoite.getTime() - diasDesdeSegunda * DIA_MS);
}

// Baldes de tempo consecutivos cobrindo [início, fim), no tamanho `passoMs`
function gerarBaldes(inicio, fim, passoMs, chaveFn, inicioBaldeFn) {
  const baldes = [];
  let cursor = inicioBaldeFn(inicio).getTime();
  const fimMs = new Date(fim).getTime();
  for (let i = 0; i < 3660 && cursor < fimMs; i++) {
    baldes.push({ chave: chaveFn(cursor), fim: cursor + passoMs });
    cursor += passoMs;
  }
  return baldes;
}

// Períodos "civis" fechados: o dia/semana/mês anterior por completo, não uma
// janela rolante. São o par de "hoje"/"últimos 7 dias"/"últimos 30 dias" —
// dá pra comparar "essa semana" com "a semana passada" de verdade.
const PERIODOS_FECHADOS = {
  ontem: (agora) => {
    const fim = inicioDoDiaSP(agora);
    return { rotulo: 'ONTEM', inicio: new Date(fim.getTime() - DIA_MS), fim };
  },
  semana_passada: (agora) => {
    const atual = resolverPeriodo('7d', agora);
    return { rotulo: 'SEMANA PASSADA', inicio: atual.anteriorInicio, fim: atual.anteriorFim };
  },
  mes_passado: (agora) => {
    const atual = resolverPeriodo('30d', agora);
    return { rotulo: 'MÊS PASSADO', inicio: atual.anteriorInicio, fim: atual.anteriorFim };
  },
};

// Janela atual e a anterior de mesma duração, para comparar sem distorção
function resolverPeriodo(chave = '7d', agora = new Date()) {
  if (PERIODOS_FECHADOS[chave]) {
    const { rotulo, inicio, fim } = PERIODOS_FECHADOS[chave](agora);
    return { chave, rotulo, inicio, fim, anteriorInicio: null, anteriorFim: null };
  }
  const valida = PERIODOS[chave] ? chave : '7d';
  const def = PERIODOS[valida];
  const fim = new Date(agora);
  if (!def.dias) {
    return { chave: valida, rotulo: def.rotulo, inicio: null, fim, anteriorInicio: null, anteriorFim: null };
  }
  const inicio = new Date(inicioDoDiaSP(agora).getTime() - (def.dias - 1) * DIA_MS);
  const deslocamento = def.dias * DIA_MS;
  return {
    chave: valida,
    rotulo: def.rotulo,
    inicio,
    fim,
    anteriorInicio: new Date(inicio.getTime() - deslocamento),
    anteriorFim: new Date(fim.getTime() - deslocamento),
  };
}

// Preenche com zero os dias sem registro, do início ao fim (inclusive)
function serieDiaria(linhas, inicio, fim) {
  const porDia = new Map(linhas.map(l => [l.dia, Number(l.total)]));
  const ultimo = chaveDia(fim);
  const serie = [];
  let cursor = inicioDoDiaSP(inicio).getTime();
  for (let i = 0; i < 3660; i++) {
    const dia = chaveDia(cursor);
    serie.push({ dia, total: porDia.get(dia) ?? 0 });
    if (dia >= ultimo) break;
    cursor += DIA_MS;
  }
  return serie;
}

function agruparEmBaldes(valores, largura) {
  if (valores.length <= largura) return valores.slice();
  const tamanho = Math.ceil(valores.length / largura);
  const baldes = [];
  for (let i = 0; i < valores.length; i += tamanho) {
    baldes.push(valores.slice(i, i + tamanho).reduce((a, b) => a + b, 0));
  }
  return baldes;
}

function sparkline(valores, largura = 30) {
  if (!valores.length) return '';
  const baldes = agruparEmBaldes(valores, largura);
  const max = Math.max(...baldes);
  if (max === 0) return BLOCOS[0].repeat(baldes.length);
  return baldes
    .map(v => (v === 0 ? BLOCOS[0] : BLOCOS[Math.max(1, Math.round((v / max) * (BLOCOS.length - 1)))]))
    .join('');
}

function variacao(atual, anterior) {
  if (anterior == null) return null;
  if (anterior === 0) return atual === 0 ? '= igual ao período anterior' : '▲ período anterior sem registros';
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  if (pct === 0) return '= igual ao período anterior';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs período anterior`;
}

// Nick padrão do recrutamento: "S GDF | Nome - 1234"
function idFivemDoNick(nick) {
  const m = String(nick ?? '').match(/-\s*(\d{1,8})\s*$/);
  return m ? m[1] : null;
}

// "(Sócio > Recrutador)" fica intacto na `descricao` dos logs de
// promoveu_cargo/rebaixou_cargo (ver parser.js) — quem monta o histórico de
// carreira relê daqui em vez de guardar "de"/"para" em coluna própria.
function extrairMudancaCargo(descricao) {
  const m = String(descricao ?? '').match(/\(([^()>]+?)\s*>\s*([^()]+?)\)\.?\s*$/);
  return m ? { de: m[1].trim(), para: m[2].trim() } : null;
}

// Texto entre os ÚLTIMOS parênteses da descrição. É onde o jogo põe o que não
// tem lugar próprio: a tag de tag_adicionou ("(RSJ)"), o motivo de multou
// ("(zaralho na sede)") e o "de > para" de promoveu_cargo — nenhum deles virou
// coluna nova no banco (mesma decisão de extrairMudancaCargo).
function extrairEntreParenteses(descricao) {
  const m = String(descricao ?? '').match(/\(([^()]*)\)\.?\s*$/);
  const texto = m?.[1]?.trim();
  return texto ? texto : null;
}

// "... Motivo: não escutou call Serviços: 300" — o motivo vai até "Serviços:"
// (quando houver) e os serviços são a pena em si, em quantidade.
function extrairMotivo(descricao) {
  const d = String(descricao ?? '');
  const m = d.match(/Motivo:\s*(.+?)\s*(?:Servi[çc]os:|$)/i);
  const texto = m?.[1]?.trim();
  return texto ? texto : null;
}

function extrairServicos(descricao) {
  const m = String(descricao ?? '').match(/Servi[çc]os:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

// "Guardou [GDF Sócio]" → "GDF Sócio". Qual baú mexeu só existe no título do
// log (ver parser.extrairBau). No "Baú de Recompensas [GDF] - Retirada (...)" o
// colchete é da torcida, não do compartimento — ali o baú é "Recompensas".
// repositorio.saldoBau faz a mesma conta em SQL: mudar um, mudar o outro.
function bauDoTitulo(titulo) {
  const t = String(titulo ?? '');
  if (/^Ba[úu] de Recompensas\b/i.test(t)) return 'Recompensas';
  const m = t.match(/\[(.+?)\]/);
  return m ? m[1].trim() : null;
}

// Log lido como latin1 no caminho até o Discord ("Fabio PeÃ§a" em vez de "Fabio
// Peça"). Só mexe no texto quando o sinal do erro está lá (Ã/Â seguido de byte
// de continuação) e desiste se a reinterpretação produzir caractere inválido —
// texto são nunca é tocado.
const SINAL_MOJIBAKE = /[ÃÂ][-¿]/;

function corrigirMojibake(texto) {
  const s = String(texto ?? '');
  if (!SINAL_MOJIBAKE.test(s)) return s;
  try {
    const corrigido = Buffer.from(s, 'latin1').toString('utf8');
    return corrigido.includes('�') ? s : corrigido;
  } catch {
    return s;
  }
}

const formatadorNumero = new Intl.NumberFormat('pt-BR');
const formatadorDinheiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function formatarNumero(n) {
  return formatadorNumero.format(Number(n) || 0);
}

function formatarDinheiro(n) {
  return `$ ${formatadorDinheiro.format(Number(n) || 0)}`;
}

// Duração em ms → "45min", "3h20min", "2d5h" (unidade zerada não aparece)
function formatarDuracao(ms) {
  const min = Math.round(Math.max(0, ms) / 60000);
  if (min < 60) return `${min}min`;
  const horas = Math.floor(min / 60);
  const restoMin = min % 60;
  if (horas < 24) return restoMin ? `${horas}h${restoMin}min` : `${horas}h`;
  const dias = Math.floor(horas / 24);
  const restoHoras = horas % 24;
  return restoHoras ? `${dias}d${restoHoras}h` : `${dias}d`;
}

function formatarDiaCurto(chave) {
  const [, mes, dia] = String(chave).split('-');
  return `${dia}/${mes}`;
}

const formatadorDataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

// "12/09/2026 14:32" no fuso de São Paulo — usado pra apontar QUANDO um
// recorde (ex.: maior bonde já registrado) aconteceu, não só o valor.
function formatarDataHora(data) {
  return formatadorDataHora.format(new Date(data));
}

function truncar(texto, max) {
  const s = String(texto ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Sem acento, minúsculo — pra "buscar por nome" achar "Peça" digitando "peca".
// Mesma normalização que presencaInteracoes.js já fazia por conta própria;
// fatorada aqui pra todo canal-painel com busca por texto reaproveitar.
function normalizarBusca(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

module.exports = {
  PERIODO_CHOICES,
  HORA_MS,
  DIA_MS,
  chaveDia,
  inicioDoDiaSP,
  chaveHora,
  inicioDaHoraSP,
  inicioDaSemanaSP,
  gerarBaldes,
  resolverPeriodo,
  serieDiaria,
  sparkline,
  variacao,
  idFivemDoNick,
  extrairMudancaCargo,
  extrairEntreParenteses,
  extrairMotivo,
  extrairServicos,
  bauDoTitulo,
  corrigirMojibake,
  formatarNumero,
  formatarDinheiro,
  formatarDuracao,
  formatarDiaCurto,
  formatarDataHora,
  truncar,
  normalizarBusca,
};

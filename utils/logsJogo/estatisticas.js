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
// longo, alternando janela rolante (a partir de agora) com o período
// fechado equivalente (o intervalo imediatamente anterior, mesma duração) —
// mesmo par que já existia pra semana/mês, agora também pra trimestre,
// semestre e ano. Cresce sozinho conforme os logs também vão crescendo.
const PERIODO_CHOICES = [
  { name: 'Hoje', value: 'hoje' },
  { name: 'Ontem', value: 'ontem' },
  { name: 'Últimos 7 dias', value: '7d' },
  { name: 'Semana passada', value: 'semana_passada' },
  { name: 'Últimos 30 dias', value: '30d' },
  { name: 'Mês passado', value: 'mes_passado' },
  { name: 'Últimos 90 dias', value: '90d' },
  { name: 'Trimestre passado', value: 'trimestre_passado' },
  { name: 'Últimos 6 meses', value: '180d' },
  { name: 'Semestre passado', value: 'semestre_passado' },
  { name: 'Últimos 12 meses', value: '365d' },
  { name: 'Ano passado', value: 'ano_passado' },
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
  trimestre_passado: (agora) => {
    const atual = resolverPeriodo('90d', agora);
    return { rotulo: 'TRIMESTRE PASSADO', inicio: atual.anteriorInicio, fim: atual.anteriorFim };
  },
  semestre_passado: (agora) => {
    const atual = resolverPeriodo('180d', agora);
    return { rotulo: 'SEMESTRE PASSADO', inicio: atual.anteriorInicio, fim: atual.anteriorFim };
  },
  ano_passado: (agora) => {
    const atual = resolverPeriodo('365d', agora);
    return { rotulo: 'ANO PASSADO', inicio: atual.anteriorInicio, fim: atual.anteriorFim };
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

function truncar(texto, max) {
  const s = String(texto ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

module.exports = {
  PERIODO_CHOICES,
  HORA_MS,
  DIA_MS,
  chaveDia,
  inicioDoDiaSP,
  chaveHora,
  inicioDaHoraSP,
  gerarBaldes,
  resolverPeriodo,
  serieDiaria,
  sparkline,
  variacao,
  idFivemDoNick,
  extrairMudancaCargo,
  formatarNumero,
  formatarDinheiro,
  formatarDuracao,
  formatarDiaCurto,
  truncar,
};

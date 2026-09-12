// Regras puras das rifas (sem Discord nem banco). Dinheiro do jogo: sem gateway nem
// taxa, e quem gere a rifa confere o pagamento. O número é a chave; a disputa entre
// dois compradores pelo mesmo número é da chave primária (rifa_id, numero), nunca daqui.
const crypto = require('crypto');

const MINUTOS_RESERVA = 15;
const MAX_NUMEROS_POR_COMPRA = 50;
const MIN_NUMEROS = 10;
const MAX_NUMEROS = 10000;
const LIMIAR_SORTEIO_PCT = 70;
// Acima desta ocupação, sortear por tentativa e erro degenera: materializa os livres
const OCUPACAO_DENSA = 0.8;

const METODOS_SORTEIO = {
  SISTEMA: {
    rotulo: 'Sorteio pelo bot',
    descricao: 'O hash da semente foi publicado antes da venda. No sorteio a semente é revelada e qualquer pessoa recalcula o resultado.',
  },
  MANUAL: {
    rotulo: 'Sorteio ao vivo',
    descricao: 'A torcida sorteia ao vivo e registra o número com evidência. É registro do que aconteceu, não prova.',
  },
};
const METODO_CHOICES = Object.entries(METODOS_SORTEIO).map(([value, m]) => ({ name: m.rotulo, value }));

// Escolhida na criação e exibida na rifa: decidir depois do sorteio é onde a rifa honesta vira briga
const REGRAS_NAO_VENDIDO = {
  PROXIMO_VENDIDO: { rotulo: 'o prêmio vai para o próximo número vendido' },
  REPETIR_SORTEIO: { rotulo: 'o sorteio é repetido' },
};
const REGRA_NAO_VENDIDO_CHOICES = [
  { name: 'Próximo número vendido', value: 'PROXIMO_VENDIDO' },
  { name: 'Repetir o sorteio', value: 'REPETIR_SORTEIO' },
];

const STATUS_RIFA = {
  ABERTA: { rotulo: 'Vendendo', emoji: '🟢' },
  ENCERRADA: { rotulo: 'Vendas encerradas', emoji: '🟡' },
  SORTEADA: { rotulo: 'Sorteada', emoji: '🏆' },
  CANCELADA: { rotulo: 'Cancelada', emoji: '❌' },
};

const TRANSICOES = {
  ABERTA: ['ENCERRADA', 'CANCELADA'],
  ENCERRADA: ['SORTEADA', 'CANCELADA'],
  SORTEADA: [],
  CANCELADA: [],
};

function podeTransicionar(de, para) {
  return (TRANSICOES[de] ?? []).includes(para);
}

function validarCriacao({ totalNumeros, preco, limitePorPessoa }) {
  if (!Number.isInteger(totalNumeros) || totalNumeros < MIN_NUMEROS || totalNumeros > MAX_NUMEROS) {
    return { ok: false, mensagem: `❌ A RIFA PRECISA TER DE ${MIN_NUMEROS} A ${MAX_NUMEROS} NÚMEROS.` };
  }
  if (!(Number(preco) > 0)) return { ok: false, mensagem: '❌ PREÇO INVÁLIDO.' };
  if (limitePorPessoa != null && (!Number.isInteger(limitePorPessoa) || limitePorPessoa < 1 || limitePorPessoa > totalNumeros)) {
    return { ok: false, mensagem: '❌ O LIMITE POR PESSOA PRECISA SER DE 1 ATÉ O TOTAL DE NÚMEROS.' };
  }
  return { ok: true };
}

// Sem limite informado, ninguém leva mais de 10% da rifa: um só comprando tudo mata a venda
function limitePadrao(totalNumeros) {
  return Math.max(1, Math.ceil(totalNumeros / 10));
}

function formatarNumero(numero, totalNumeros) {
  return String(numero).padStart(String(totalNumeros).length, '0');
}

// "7, 13, 20-22" → [7, 13, 20, 21, 22]
function parseNumeros(texto, totalNumeros) {
  const limpo = String(texto ?? '').replace(/\s*-\s*/g, '-').trim();
  if (!limpo) return { erro: '❌ INFORME AO MENOS UM NÚMERO.' };
  const excesso = { erro: `❌ NO MÁXIMO ${MAX_NUMEROS_POR_COMPRA} NÚMEROS POR COMPRA.` };
  const numeros = new Set();
  for (const parte of limpo.split(/[\s,;]+/).filter(Boolean)) {
    const m = parte.match(/^(\d{1,6})(?:-(\d{1,6}))?$/);
    if (!m) return { erro: `❌ NÃO ENTENDI "${parte}". SEPARE OS NÚMEROS POR VÍRGULA E USE HÍFEN PARA FAIXAS (EX.: 7, 13, 20-22).` };
    const de = Number(m[1]);
    const ate = m[2] ? Number(m[2]) : de;
    if (ate < de) return { erro: `❌ A FAIXA ${parte} ESTÁ INVERTIDA.` };
    if (de < 1 || ate > totalNumeros) return { erro: `❌ ${parte} ESTÁ FORA DA RIFA (1 A ${totalNumeros}).` };
    if (ate - de + 1 > MAX_NUMEROS_POR_COMPRA) return excesso;
    for (let n = de; n <= ate; n++) numeros.add(n);
    if (numeros.size > MAX_NUMEROS_POR_COMPRA) return excesso;
  }
  return { numeros: [...numeros].sort((a, b) => a - b) };
}

// [1, 2, 3, 7, 9, 10] → ["01-03", "07", "09-10"]
function faixasCompactas(numeros, totalNumeros) {
  const f = n => formatarNumero(n, totalNumeros);
  const ordenados = [...numeros].sort((a, b) => a - b);
  const faixas = [];
  for (let i = 0; i < ordenados.length; i++) {
    const inicio = ordenados[i];
    while (i + 1 < ordenados.length && ordenados[i + 1] === ordenados[i] + 1) i++;
    faixas.push(inicio === ordenados[i] ? f(inicio) : `${f(inicio)}-${f(ordenados[i])}`);
  }
  return faixas;
}

function numerosLivres(totalNumeros, ocupados) {
  const livres = [];
  for (let n = 1; n <= totalNumeros; n++) if (!ocupados.has(n)) livres.push(n);
  return livres;
}

// null = sem teto. Conta o que já é da pessoa: pago + reserva viva
function saldoLimite(limitePorPessoa, jaTem) {
  if (limitePorPessoa == null) return null;
  return Math.max(0, limitePorPessoa - jaTem);
}

function aceitaVenda(rifa, agora = new Date()) {
  if (rifa.status !== 'ABERTA') return false;
  return !rifa.encerra_em || new Date(rifa.encerra_em).getTime() > agora.getTime();
}

// Quanto falta, em NÚMEROS, para divulgar a data do sorteio. "Faltam 53 números" é
// acionável na porta do estádio; "faltam 13%" não é.
function progressoLimiar({ totalNumeros, vendidos, pct = LIMIAR_SORTEIO_PCT }) {
  const alvo = Math.ceil((totalNumeros * pct) / 100);
  const faltam = Math.max(0, alvo - vendidos);
  return { pct, alvo, faltam, atingido: faltam === 0 };
}

function cruzouLimiar({ totalNumeros, antes, depois, pct = LIMIAR_SORTEIO_PCT }) {
  return !progressoLimiar({ totalNumeros, vendidos: antes, pct }).atingido
    && progressoLimiar({ totalNumeros, vendidos: depois, pct }).atingido;
}

function progressoVenda({ totalNumeros, vendidos }) {
  const v = Math.min(vendidos, totalNumeros);
  return { vendidos: v, restantes: totalNumeros - v, percentual: Math.round((v / Math.max(1, totalNumeros)) * 1000) / 10 };
}

function barraProgresso(fracao, largura = 12) {
  const cheios = Math.round(Math.min(1, Math.max(0, fracao)) * largura);
  return '▰'.repeat(cheios) + '▱'.repeat(largura - cheios);
}

function totalCompra(preco, quantidade) {
  return Math.round(Number(preco) * quantidade * 100) / 100;
}

const aleatorioSeguro = () => crypto.randomInt(2 ** 32) / 2 ** 32;

// Modo aleatório: pede quantidade, não números. `tomados` são os números ocupados.
function sortearNumerosLivres(totalNumeros, tomados, quantidade, aleatorio = aleatorioSeguro) {
  const alvo = Math.min(quantidade, Math.max(0, totalNumeros - tomados.size));
  if (tomados.size / totalNumeros >= OCUPACAO_DENSA) {
    const livres = numerosLivres(totalNumeros, tomados);
    for (let i = livres.length - 1; i > 0; i--) {
      const j = Math.floor(aleatorio() * (i + 1));
      [livres[i], livres[j]] = [livres[j], livres[i]];
    }
    return livres.slice(0, alvo);
  }
  const escolhidos = new Set();
  let tentativas = 0;
  while (escolhidos.size < alvo && tentativas < alvo * 20 + 50) {
    tentativas++;
    const candidato = 1 + Math.floor(aleatorio() * totalNumeros);
    if (!tomados.has(candidato)) escolhidos.add(candidato);
  }
  return [...escolhidos];
}

function sha256(texto) {
  return crypto.createHash('sha256').update(String(texto)).digest('hex');
}

// Commit-reveal: o hash vai para a mensagem da rifa antes do primeiro número vendido.
// A semente fica só no banco até o sorteio: quem gere a rifa pelo Discord não a vê.
// O compromisso impede escolher o vencedor depois da venda; não protege contra quem
// tem acesso direto ao banco do bot.
function gerarCompromisso() {
  const semente = crypto.randomBytes(32).toString('hex');
  return { semente, hash: sha256(semente) };
}

function conferirCompromisso(semente, hash) {
  return sha256(semente) === hash;
}

// Congela o que foi vendido: responde "venderam o número depois do sorteio?"
function hashListaPagos(pagos) {
  return sha256([...pagos].sort((a, b) => a - b).join(','));
}

// Vencedor = lista[HMAC-SHA256(semente, "<rifa>:<lista>") mod N]. Sempre um número pago,
// e qualquer pessoa com a semente revelada e a lista recalcula.
function sorteioSistema({ semente, rifaId, pagos }) {
  if (!pagos.length) return null;
  const lista = [...pagos].sort((a, b) => a - b);
  const mensagem = `${rifaId}:${lista.join(',')}`;
  const hmac = crypto.createHmac('sha256', semente).update(mensagem).digest('hex');
  const indice = Number(BigInt(`0x${hmac}`) % BigInt(lista.length));
  return { indice, numero: lista[indice], hmac, mensagem, hashLista: sha256(lista.join(',')) };
}

// Sorteio ao vivo: número sorteado não vendido segue a regra da criação. PROXIMO_VENDIDO
// anda para cima e dá a volta na faixa; REPETIR_SORTEIO devolve null (sorteie de novo).
function resolverVencedorManual(numeroSorteado, pagos, totalNumeros, regra) {
  if (!pagos.length) return null;
  const vendidos = new Set(pagos);
  if (vendidos.has(numeroSorteado)) return numeroSorteado;
  if (regra === 'REPETIR_SORTEIO') return null;
  for (let passo = 1; passo <= totalNumeros; passo++) {
    const candidato = ((numeroSorteado - 1 + passo) % totalNumeros) + 1;
    if (vendidos.has(candidato)) return candidato;
  }
  return null;
}

// Motivos em texto: botão negado sem explicação é o que gera reclamação
function bloqueiosParaSortear({ status, metodo, compromissoHash, vendidos, pendentes }) {
  const bloqueios = [];
  if (status !== 'ENCERRADA') bloqueios.push('Encerre as vendas antes de sortear (`/rifa encerrar`).');
  if (vendidos === 0) bloqueios.push('Nenhum número foi pago.');
  if (pendentes > 0) {
    bloqueios.push(`Há ${pendentes} compra${pendentes !== 1 ? 's' : ''} aguardando pagamento ou conferência. Confirme ou recuse antes, para ninguém que pagou ficar fora do sorteio.`);
  }
  if (metodo === 'SISTEMA' && !compromissoHash) bloqueios.push('Falta o compromisso publicado antes da venda.');
  return bloqueios;
}

// O livro-caixa diz "entrou X"; isto diz se a rifa fechou no azul
function resultadoRifa({ arrecadado, custoPremio = null }) {
  const custo = custoPremio ?? 0;
  return { arrecadado, custoPremio, liquido: Math.round((arrecadado - custo) * 100) / 100 };
}

// Denominador é o que foi pago, não o total: o sorteio corre entre os vendidos
function chanceDeGanhar({ meus, vendidos }) {
  if (vendidos <= 0) return null;
  return Math.min(1, Math.max(0, meus) / vendidos);
}

function formatarChance(chance) {
  if (chance == null) return '—';
  if (chance === 0) return '0%';
  if (chance < 0.01) return 'menos de 1%';
  return `${Math.round(chance * 100)}%`;
}

function textoAuditoria(rifa, pagos) {
  const lista = [...pagos].sort((a, b) => a - b).join(',');
  const linhas = [
    `RIFA #${rifa.id} — ${rifa.titulo}`,
    `Prêmio: ${rifa.premio}`,
    `Método: ${METODOS_SORTEIO[rifa.metodo_sorteio]?.rotulo ?? rifa.metodo_sorteio}`,
    `Sorteada em: ${new Date(rifa.sorteada_em ?? Date.now()).toISOString()}`,
    '',
    `Números pagos (${pagos.length}), em ordem crescente:`,
    lista,
    'Hash da lista (SHA-256 do texto acima):',
    rifa.hash_lista_final,
    '',
  ];
  if (rifa.metodo_sorteio === 'SISTEMA') {
    linhas.push(
      'Compromisso publicado antes da venda (SHA-256 da semente):',
      rifa.compromisso_hash,
      'Semente revelada:',
      rifa.semente,
      'Confira: SHA-256(semente) deve ser igual ao compromisso.',
      '',
      'Cálculo do vencedor:',
      `  mensagem = "${rifa.id}:<lista acima>"`,
      '  hmac     = HMAC-SHA256(chave = semente em texto, mensagem)',
      '  índice   = inteiro(hmac em hexadecimal) mod quantidade de números pagos (começa em 0)',
      '  vencedor = lista[índice]',
      '',
      'Conferência em Node.js (cole a lista entre as aspas):',
      `  node -e "const c=require('crypto');const s='${rifa.semente}';const l='LISTA';const h=c.createHmac('sha256',s).update('${rifa.id}:'+l).digest('hex');const a=l.split(',');console.log(a[Number(BigInt('0x'+h)%BigInt(a.length))])"`,
      '',
    );
  } else {
    linhas.push(
      `Número sorteado ao vivo: ${rifa.numero_sorteado}`,
      `Se o número sorteado não foi vendido, ${REGRAS_NAO_VENDIDO[rifa.regra_nao_vendido]?.rotulo ?? rifa.regra_nao_vendido}.`,
      `Evidência: ${rifa.evidencia || '(imagem arquivada pelo bot)'}`,
      '',
    );
  }
  linhas.push(`NÚMERO VENCEDOR: ${rifa.numero_vencedor}`);
  return linhas.join('\n');
}

module.exports = {
  MINUTOS_RESERVA,
  MAX_NUMEROS_POR_COMPRA,
  MIN_NUMEROS,
  MAX_NUMEROS,
  LIMIAR_SORTEIO_PCT,
  METODOS_SORTEIO,
  METODO_CHOICES,
  REGRAS_NAO_VENDIDO,
  REGRA_NAO_VENDIDO_CHOICES,
  STATUS_RIFA,
  podeTransicionar,
  validarCriacao,
  limitePadrao,
  formatarNumero,
  parseNumeros,
  faixasCompactas,
  numerosLivres,
  saldoLimite,
  aceitaVenda,
  progressoLimiar,
  cruzouLimiar,
  progressoVenda,
  barraProgresso,
  totalCompra,
  sortearNumerosLivres,
  sha256,
  gerarCompromisso,
  conferirCompromisso,
  hashListaPagos,
  sorteioSistema,
  resolverVencedorManual,
  bloqueiosParaSortear,
  resultadoRifa,
  chanceDeGanhar,
  formatarChance,
  textoAuditoria,
};

// Diagnóstico do servidor contra o tenant: o bot tem as permissões certas? Os
// IDs do tenant existem de verdade? Os canais de log estão na categoria certa?
// Puro (recebe uma visão simples do servidor); discord.js só entra em
// `visaoDoServidor`, que traduz o Guild real para essa visão.
const { PermissionFlagsBits: P } = require('discord.js');
const tema = require('../../tema');

// Permissão → por que o bot precisa dela e quais módulos a usam ('*' = todos).
const PERMISSOES = [
  { flag: P.ViewChannel, nome: 'Ver canais', motivo: 'ler e responder nos canais', modulos: '*' },
  { flag: P.SendMessages, nome: 'Enviar mensagens', motivo: 'publicar painéis, alertas e respostas', modulos: '*' },
  { flag: P.EmbedLinks, nome: 'Inserir links (embeds)', motivo: 'painéis são embeds', modulos: '*' },
  { flag: P.AttachFiles, nome: 'Anexar arquivos', motivo: 'carteirinha, gráficos e transcript', modulos: '*' },
  { flag: P.ReadMessageHistory, nome: 'Ler histórico', motivo: 'sincronizar logs e achar mensagens fixas', modulos: '*' },
  { flag: P.ManageChannels, nome: 'Gerenciar canais', motivo: 'criar canais de painel, de área e de ticket', modulos: ['logsJogo', 'departamentos', 'ticket', 'rifas', 'loja', 'memoria'] },
  { flag: P.ManageRoles, nome: 'Gerenciar cargos', motivo: 'dar/tirar cargos de sócio, advertência e áreas', modulos: ['recrutamento', 'advertencia', 'advertenciaRecrutador', 'departamentos', 'carteirinha'] },
  { flag: P.ManageNicknames, nome: 'Gerenciar apelidos', motivo: 'colocar o prefixo e o ID do jogo no apelido do sócio', modulos: ['recrutamento', 'logsJogo'] },
  { flag: P.ManageMessages, nome: 'Gerenciar mensagens', motivo: 'apagar mensagens de spam e reeditar mensagens fixas', modulos: ['antiSpam'] },
  { flag: P.ModerateMembers, nome: 'Silenciar membros (castigo)', motivo: 'castigar conta que espalha golpe', modulos: ['antiSpam'] },
  { flag: P.BanMembers, nome: 'Banir membros', motivo: 'botão BANIR do alerta de spam', modulos: ['antiSpam'] },
];

// permissoesDoBot: qualquer objeto com .has(flag) (o `permissions` do GuildMember do bot)
function avaliarPermissoes(permissoesDoBot, idsAtivos) {
  const ativos = idsAtivos instanceof Set ? idsAtivos : new Set(idsAtivos);
  return PERMISSOES
    .filter(p => p.modulos === '*' || p.modulos.some(m => ativos.has(m)))
    .map(p => ({
      permissao: p.nome,
      ok: Boolean(permissoesDoBot.has(p.flag)) || Boolean(permissoesDoBot.has(P.Administrator)),
      motivo: p.motivo,
    }));
}

// O bot só mexe em cargo que está ABAIXO do cargo mais alto dele.
// cargosGerenciados: [{ id, name, position }] ; posicaoDoBot: number
function avaliarPosicaoDoCargoDoBot(posicaoDoBot, cargosGerenciados) {
  return cargosGerenciados
    .filter(c => c.position >= posicaoDoBot)
    .map(c => ({ cargo: c.name, id: c.id, posicao: c.position, posicaoDoBot }));
}

// Todo ID de cargo/canal/categoria do tenant precisa existir no servidor.
function avaliarIdsDoTenant(tenant, servidor) {
  const cargos = new Map((servidor.roles ?? []).map(r => [r.id, r]));
  const canais = new Map((servidor.channels ?? []).map(c => [c.id, c]));
  const problemas = [];
  const conferir = (caminho, id, tipo) => {
    if (!id) return; // null = "ainda não criado", coberto pelas exigências dos módulos
    const achado = tipo === 'cargo' ? cargos.get(id) : canais.get(id);
    if (!achado) {
      const noutroTipo = tipo === 'cargo' ? canais.has(id) : cargos.has(id);
      problemas.push({ caminho, id, problema: noutroTipo ? `é ${tipo === 'cargo' ? 'um canal' : 'um cargo'}, não ${tipo === 'cargo' ? 'um cargo' : 'um canal'}` : 'não existe neste servidor' });
    }
  };

  for (const [k, v] of Object.entries(tenant.cargos ?? {})) {
    for (const [i, id] of (Array.isArray(v) ? v : [v]).entries()) conferir(Array.isArray(v) ? `cargos.${k}[${i}]` : `cargos.${k}`, id, 'cargo');
  }
  for (const [k, v] of Object.entries(tenant.canais ?? {})) conferir(`canais.${k}`, v, 'canal');
  for (const [k, v] of Object.entries(tenant.categorias ?? {})) conferir(`categorias.${k}`, v, 'canal');
  (tenant.lideranca ?? []).forEach((id, i) => conferir(`lideranca[${i}]`, id, 'cargo'));
  (tenant.hierarquia ?? []).forEach((h, i) => conferir(`hierarquia[${i}]`, h.id, 'cargo'));
  (tenant.departamentos ?? []).forEach((d, i) => conferir(`departamentos[${i}].canalId`, d.canalId, 'canal'));
  const lj = tenant.logsJogo ?? {};
  (lj.canais ?? []).forEach((id, i) => conferir(`logsJogo.canais[${i}]`, id, 'canal'));
  conferir('logsJogo.categoriaLogs', lj.categoriaLogs, 'canal');
  conferir('logsJogo.canalAlertas', lj.canalAlertas, 'canal');
  conferir('logsJogo.canalPainelJogadores', lj.canalPainelJogadores, 'canal');
  return problemas;
}

// Canal de log fora da categoria de logs contamina painéis (incidente de
// 2026-09-13: canal de OUTRA comunidade misturado). Aqui só avisa; quem barra
// é ingestao.sincronizarCanal.
function avaliarCanaisDeLog(tenant, servidor) {
  const lj = tenant.logsJogo ?? {};
  const canais = new Map((servidor.channels ?? []).map(c => [c.id, c]));
  const problemas = [];
  for (const id of lj.canais ?? []) {
    const c = canais.get(id);
    if (c && lj.categoriaLogs && c.parentId !== lj.categoriaLogs) {
      problemas.push({ canal: c.name, id, problema: 'fora da categoria de logs configurada — a ingestão vai recusar este canal' });
    }
  }
  return problemas;
}

// Cargos que o bot precisa poder gerenciar (por posição) — os do tenant que ele concede/remove.
function cargosGerenciadosPeloBot(tenant) {
  const c = tenant.cargos ?? {};
  return [c.socio, c.provarManto, c.reprovadoRecrutamento, c.visitante, c.recrutador, ...(c.adv ?? []), ...(c.advRec ?? [])].filter(Boolean);
}

// Guild do discord.js → visão simples usada pelas funções acima.
function visaoDoServidor(guild) {
  return {
    roles: [...guild.roles.cache.values()].map(r => ({ id: r.id, name: r.name, position: r.position })),
    channels: [...guild.channels.cache.values()].map(c => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId ?? null })),
  };
}

// Junta tudo num relatório: { linhas: [texto], problemas: número }
function montarDiagnostico({ tenant, plataforma, servidor, permissoesDoBot, posicaoDoBot }) {
  const linhas = [];
  let problemas = 0;
  const ok = t => linhas.push(`${tema.emoji.ok} ${t}`);
  const ruim = t => { problemas++; linhas.push(`${tema.emoji.recusado} ${t}`); };

  linhas.push(`**TENANT:** \`${tenant.slug}\`${plataforma.modoInstalacao ? ' — **MODO INSTALAÇÃO**' : ''}`);
  linhas.push(`**MÓDULOS LIGADOS (${plataforma.ativos.length}):** ${plataforma.ativos.map(m => m.id).join(', ')}`);
  if (plataforma.desligados.length) linhas.push(`**DESLIGADOS (${plataforma.desligados.length}):** ${plataforma.desligados.map(m => m.id).join(', ')}`);
  linhas.push('');

  linhas.push('**PERMISSÕES DO BOT**');
  const permissoes = avaliarPermissoes(permissoesDoBot, plataforma.idsAtivos);
  const faltam = permissoes.filter(p => !p.ok);
  if (!faltam.length) ok(`todas as ${permissoes.length} permissões necessárias`);
  for (const p of faltam) ruim(`falta **${p.permissao}** — ${p.motivo}`);

  if (!plataforma.modoInstalacao) {
    const posicoes = new Map(servidor.roles.map(r => [r.id, r]));
    const gerenciados = cargosGerenciadosPeloBot(tenant).map(id => posicoes.get(id)).filter(Boolean);
    const acima = avaliarPosicaoDoCargoDoBot(posicaoDoBot, gerenciados);
    linhas.push('', '**POSIÇÃO DO CARGO DO BOT**');
    if (!acima.length) ok('o cargo do bot está acima de todos os cargos que ele concede/remove');
    for (const c of acima) ruim(`o cargo **${c.cargo}** está no mesmo nível ou acima do cargo do bot — suba o cargo do bot`);

    linhas.push('', '**IDS DO TENANT NO SERVIDOR**');
    const ids = avaliarIdsDoTenant(tenant, servidor);
    if (!ids.length) ok('todos os IDs configurados existem');
    for (const i of ids.slice(0, 25)) ruim(`\`${i.caminho}\` (${i.id}) ${i.problema}`);
    if (ids.length > 25) ruim(`… e mais ${ids.length - 25} ID(s) com problema`);

    const logs = avaliarCanaisDeLog(tenant, servidor);
    linhas.push('', '**CANAIS DE LOG**');
    if (!logs.length) ok('todos os canais de log estão na categoria configurada');
    for (const l of logs) ruim(`#${l.canal}: ${l.problema}`);
  }
  return { linhas, problemas };
}

module.exports = {
  avaliarPermissoes, avaliarPosicaoDoCargoDoBot, avaliarIdsDoTenant, avaliarCanaisDeLog,
  cargosGerenciadosPeloBot, visaoDoServidor, montarDiagnostico, PERMISSOES,
};

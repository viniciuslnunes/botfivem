// Contrato de uma FONTE DE LOGS (fontes/<id>/index.js): o adapter que traduz o
// que um servidor de jogo publica por webhook para o registro canônico que o
// resto do bot entende (tabela logs_jogo, alertas, painéis). Painéis e alertas
// só conhecem o registro canônico; nunca o texto do jogo.
//
//   module.exports = {
//     id: 'hoolibras',                // igual ao nome da pasta
//     nome: 'Hoolibras',              // como aparece em mensagens ("sem log de X pro <nome>")
//     parseRegistro(embed) {},        // embed cru do Discord → registro canônico (abaixo)
//     nomePatrimonio(nomeDoItem) {},  // rótulo de peça de patrimônio, ou null se não é
//   };
//
// Registro canônico devolvido por parseRegistro (todo campo sempre presente):
//   acao        string  — do vocabulário ACOES_CANONICAS, ou 'desconhecido' (nunca descartar)
//   categoria   string|null — agrupador do log (ver CATEGORIAS_CANONICAS)
//   atorNome, alvoNome     string|null
//   atorIdFivem, alvoIdFivem string|null (dígitos)
//   valor       number|null — dinheiro ou quantidade
//   titulo, descricao      string|null (texto já limpo)
//
// Contrato do baú (limitação conhecida): as consultas de saldo por baú leem o
// nome do compartimento entre colchetes do `titulo` ("Guardou [Baú Sócio]"),
// então uma fonte precisa produzir esse título nas ações bau_*.
// Ver docs/contratos/eventos-canonicos.md.

// Vocabulário de ações que painéis e alertas conhecem. Uma ação nova só vira
// funcionalidade quando um painel/alerta a consome; enquanto isso, a fonte
// pode usar 'desconhecido' e reprocessar depois (ingestao.reprocessarDesconhecidos).
const ACOES_CANONICAS = new Set([
  'adv_finalizou', 'adv_removida', 'advertido', 'arena_bloqueou', 'arena_desbloqueou',
  'banco_depositou', 'banco_sacou', 'bau_guardou', 'bau_removeu', 'blacklist_adicionou', 'blacklist_removeu',
  'cargo_editado', 'coins_conquista', 'coins_dominacao', 'comprou_item', 'comprou_roupa', 'config_alterou',
  'convocou_equipe', 'dinheiro_adicionado', 'dinheiro_conquista', 'expulso_torcida',
  'fechadura_destrancou', 'fechadura_trancou', 'honra_adicionada', 'honra_gastou',
  'impedimento_adicionou', 'impedimento_removeu', 'jogador_entrou', 'jogador_recrutou', 'jogador_saiu',
  'multou', 'novato_entrou', 'patrimonio_guardou', 'patrimonio_removeu', 'portao_destrancou', 'portao_trancou',
  'promoveu_cargo', 'protecao_alternou', 'rebaixou_cargo', 'removido_torcida_automatico', 'saiu_torcida',
  'sede_destrancou', 'sede_trancou', 'suspensao_adicionou', 'suspensao_removeu',
  'tag_adicionou', 'tag_alterou', 'tag_removeu', 'usou_sistema_porta',
  'desconhecido',
]);

const CATEGORIAS_CANONICAS = new Set([
  'bau', 'conexao', 'config', 'disciplina', 'economia', 'hierarquia', 'lideranca', 'patrimonio',
  'recrutamento', 'restricao', 'saida', 'tag', 'territorio',
]);

const CAMPOS_TEXTO = ['atorNome', 'alvoNome', 'titulo', 'descricao', 'categoria'];
const CAMPOS_ID = ['atorIdFivem', 'alvoIdFivem'];

// Forma de um registro canônico. Devolve a lista de problemas (vazia = ok).
// `categoria` fora do vocabulário NÃO é erro: o rodapé do jogo pode trazer
// categoria nova, e o painel de categorias mostra o que vier.
function validarRegistro(r) {
  const erros = [];
  if (r === null || typeof r !== 'object') return ['registro deve ser um objeto'];
  if (typeof r.acao !== 'string' || !r.acao) erros.push('acao obrigatória (use "desconhecido" quando não reconhece)');
  else if (!ACOES_CANONICAS.has(r.acao)) erros.push(`acao "${r.acao}" fora do vocabulário canônico`);
  for (const k of CAMPOS_TEXTO) {
    if (!(k in r)) erros.push(`${k} ausente (use null)`);
    else if (r[k] !== null && typeof r[k] !== 'string') erros.push(`${k} deve ser texto ou null`);
  }
  for (const k of CAMPOS_ID) {
    if (!(k in r)) erros.push(`${k} ausente (use null)`);
    else if (r[k] !== null && !/^\d+$/.test(String(r[k]))) erros.push(`${k} deve ser só dígitos ou null, veio ${JSON.stringify(r[k])}`);
  }
  if (!('valor' in r)) erros.push('valor ausente (use null)');
  else if (r.valor !== null && !(typeof r.valor === 'number' && Number.isFinite(r.valor))) erros.push('valor deve ser número finito ou null');
  return erros;
}

function validarFonte(f, pasta) {
  const erros = [];
  if (f === null || typeof f !== 'object') return ['a fonte deve exportar um objeto'];
  if (typeof f.id !== 'string' || !f.id) erros.push('id obrigatório');
  else if (pasta && f.id !== pasta) erros.push(`id "${f.id}" difere da pasta "${pasta}"`);
  if (typeof f.nome !== 'string' || !f.nome) erros.push('nome obrigatório');
  if (typeof f.parseRegistro !== 'function') erros.push('parseRegistro deve ser função');
  if (typeof f.nomePatrimonio !== 'function') erros.push('nomePatrimonio deve ser função');
  return erros;
}

module.exports = { ACOES_CANONICAS, CATEGORIAS_CANONICAS, validarRegistro, validarFonte };

// Monta a plataforma de um tenant: resolve quais módulos sobem (ou falha com a
// lista completa de problemas) e expõe o que o resto do bot precisa. Fábrica
// pura para poder testar com manifestos falsos; o de produção é plataforma/index.js.
const { resolverModulos } = require('./resolver');

function criarPlataforma({ manifestos, tenant, tema }) {
  // Modo instalação (tenant.instalacao === true): a torcida ainda não mapeou
  // cargos e canais, então só sobem os módulos marcados `instalacao: true`
  // (o /setup, que ajuda a descobrir e criar o que falta). Exigências e
  // dependências dos demais não são cobradas: eles nem carregam.
  const modoInstalacao = tenant.instalacao === true;
  const candidatos = modoInstalacao ? manifestos.filter(m => m.instalacao === true) : manifestos;
  if (modoInstalacao && candidatos.length === 0) {
    throw new Error(`Tenant "${tenant.slug}" está em modo instalação, mas nenhum módulo declara instalacao: true`);
  }
  const tenantParaResolver = modoInstalacao ? { ...tenant, modulos: undefined } : tenant;
  const { ativos, erros } = resolverModulos(candidatos, { tenant: tenantParaResolver, tema });
  if (erros.length) {
    throw new Error(`Módulos inválidos para o tenant "${tenant.slug}":\n - ${erros.join('\n - ')}`);
  }

  const idsAtivos = new Set(ativos.map(m => m.id));
  const desligados = manifestos.filter(m => !idsAtivos.has(m.id));

  // Entregue como último argumento de todo hook (ver plataforma/executar.js).
  const contexto = Object.freeze({
    tenant,
    moduloAtivo: id => idsAtivos.has(id),
    // Painéis de log ligados, na ordem dos módulos: quem o pipeline de logs acorda.
    paineisDeLog: () => ativos.filter(m => m.painelLog).map(m => m.painelLog),
  });

  // Carrega o código dos módulos ligados (registra handlers) e os comandos
  // deles. Módulo desligado não é sequer require()d.
  function carregarModulos(client, { carregarComando = nome => require(`../commands/${nome}.js`) } = {}) {
    client.commands = new Map();
    for (const m of ativos) {
      if (typeof m.carregar === 'function') m.carregar();
      for (const nome of m.comandos || []) {
        const command = carregarComando(nome);
        if (!command?.data || typeof command.execute !== 'function') {
          throw new Error(`commands/${nome}.js (módulo "${m.id}") precisa exportar data e execute`);
        }
        if (client.commands.has(command.data.name)) {
          throw new Error(`comando "${command.data.name}" registrado duas vezes (módulo "${m.id}")`);
        }
        client.commands.set(command.data.name, command);
      }
    }
  }

  return { ativos, desligados, idsAtivos, contexto, carregarModulos, modoInstalacao };
}

module.exports = { criarPlataforma };

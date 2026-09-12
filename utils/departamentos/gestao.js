const config = require('../../config/index.js');
const { ehPresidencia } = require('../permissoes');
const { registrarLogGestao } = require('../logGestao');
const { buscarDepartamento, listarDepartamentos } = require('./repositorio');
const { decidirMudancaArea, papelAtual } = require('./regras');

// Incluir, promover, rebaixar ou remover alguém de uma área. Devolve a mensagem de resposta.
async function mudarArea(interaction, { acao, slug, usuario, papel = 'membro' }) {
  const area = await buscarDepartamento(slug);
  if (!area?.ativo || !area.cargo_membro_id || !area.cargo_gestor_id) {
    return '❌ ÁREA NÃO ENCONTRADA OU AINDA SEM ESTRUTURA. UM ADMINISTRADOR PRECISA RODAR `/departamentos setup`.';
  }
  const alvo = await interaction.guild.members.fetch(usuario.id).catch(() => null);
  if (!alvo) return '❌ MEMBRO NÃO ENCONTRADO NO SERVIDOR.';

  const ator = interaction.member;
  const decisao = decidirMudancaArea({
    acao,
    papel,
    atorPresidencia: ehPresidencia(ator),
    atorGestorDaArea: ator.roles.cache.has(area.cargo_gestor_id),
    alvoSocio: alvo.roles.cache.has(config.cargos.socio),
    alvoPapelAtual: papelAtual({
      temMembro: alvo.roles.cache.has(area.cargo_membro_id),
      temGestor: alvo.roles.cache.has(area.cargo_gestor_id),
    }),
  });
  if (!decisao.ok) return decisao.mensagem;

  const cargoDoPapel = p => (p === 'gestor' ? area.cargo_gestor_id : area.cargo_membro_id);
  const motivo = `Departamentos: ${decisao.resumo} por ${ator.user.tag}`;
  if (decisao.adicionar.length) await alvo.roles.add(decisao.adicionar.map(cargoDoPapel), motivo);
  const remover = decisao.remover.map(cargoDoPapel).filter(id => alvo.roles.cache.has(id));
  if (remover.length) await alvo.roles.remove(remover, motivo);

  await registrarLogGestao(interaction.client, {
    titulo: `🏛️ ${area.nome.toUpperCase()} — ${decisao.resumo.toUpperCase()}`,
    ator: ator.id,
    campos: [
      { name: 'MEMBRO', value: `<@${alvo.id}>`, inline: true },
      { name: 'ÁREA', value: `${area.emoji} ${area.nome}`, inline: true },
    ],
  });
  return `🦅 ${alvo} — ${decisao.resumo.toUpperCase()} EM **${area.nome.toUpperCase()}**.`;
}

// Desligado da torcida (perdeu o cargo SÓCIO) sai de todas as áreas
async function removerTodasAsAreas(client, membro) {
  const areas = await listarDepartamentos({ apenasAtivos: true });
  const doMembro = areas.filter(a => membro.roles.cache.has(a.cargo_membro_id) || membro.roles.cache.has(a.cargo_gestor_id));
  if (!doMembro.length) return;

  const cargos = doMembro.flatMap(a => [a.cargo_membro_id, a.cargo_gestor_id]).filter(id => membro.roles.cache.has(id));
  await membro.roles.remove(cargos, 'Desligado da torcida: perdeu o cargo SÓCIO');
  await registrarLogGestao(client, {
    titulo: '🏛️ ÁREAS REMOVIDAS NO DESLIGAMENTO',
    cor: 0xFF0000,
    campos: [
      { name: 'MEMBRO', value: `<@${membro.id}>`, inline: true },
      { name: 'ÁREAS', value: doMembro.map(a => a.nome).join(', '), inline: true },
    ],
  });
}

module.exports = { mudarArea, removerTodasAsAreas };

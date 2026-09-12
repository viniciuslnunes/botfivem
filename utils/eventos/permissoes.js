const { ehLideranca } = require('../permissoes');
const { listarDepartamentos, buscarDepartamento } = require('../departamentos/repositorio');

// Criar evento: liderança ou gestor de qualquer área.
// Gerir um evento (presença, cancelar, escala): liderança, quem criou ou gestor da área dona.
// "Dono" do evento não concede nada fora daquele evento.

async function podeCriarEventos(member) {
  if (ehLideranca(member)) return true;
  const areas = await listarDepartamentos({ apenasAtivos: true });
  return areas.some(a => member.roles.cache.has(a.cargo_gestor_id));
}

async function podeGerirEvento(member, evento) {
  if (!member || !evento) return false;
  if (ehLideranca(member) || evento.criado_por_id === member.id) return true;
  if (!evento.area_slug) return false;
  const area = await buscarDepartamento(evento.area_slug);
  return Boolean(area?.cargo_gestor_id && member.roles.cache.has(area.cargo_gestor_id));
}

module.exports = { podeCriarEventos, podeGerirEvento };

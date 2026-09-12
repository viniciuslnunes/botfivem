// Fichas de recrutamento com decisão em curso (trava contra clique duplo).
// Em memória: o bot roda numa instância só.
const emAndamento = new Set();

module.exports = {
  decisaoEmAndamento: fichaId => emAndamento.has(fichaId),
  travarFicha(fichaId) {
    if (emAndamento.has(fichaId)) return false;
    emAndamento.add(fichaId);
    return true;
  },
  liberarFicha: fichaId => emAndamento.delete(fichaId),
};

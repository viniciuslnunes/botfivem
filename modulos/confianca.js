module.exports = {
  id: 'confianca',
  descricao: 'Nível de confiança do sócio (cosmético), calculado de presença em eventos, recrutamento e rifas',
  padrao: true,
  requer: ['eventos'],
  comandos: ['confianca'],
  carregar() {
    // Assina a marcação de presença dos eventos (aoMarcarPresenca) ao carregar
    require('../utils/confianca/servico');
  },
};

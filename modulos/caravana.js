module.exports = {
  id: 'caravana',
  descricao: 'Caravanas para jogos fora: veículos, vagas, embarque de ida e volta',
  padrao: true,
  requer: ['departamentos', 'eventos', 'escala', 'financeiro'],
  // O comando registra o próprio handler (prefixo "car") ao carregar.
  comandos: ['caravana'],
};

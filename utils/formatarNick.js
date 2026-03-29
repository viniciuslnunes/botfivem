// Exemplo de função utilitária para formatação de nick

function formatarNick(nome, idFiveM) {
  const prefixo = 'S GDF | ';
  const sufixo = ` - ${idFiveM}`;
  const maxNome = 32 - prefixo.length - sufixo.length;
  const nomeCortado = nome.slice(0, maxNome);
  return `${prefixo}${nomeCortado}${sufixo}`;
}

module.exports = { formatarNick };

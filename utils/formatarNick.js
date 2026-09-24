// Exemplo de função utilitária para formatação de nick
const tema = require('../tema');

function formatarNick(nome, idFiveM) {
  const prefixo = tema.marca.nickPrefixo;
  const sufixo = ` - ${idFiveM}`;
  const maxNome = 32 - prefixo.length - sufixo.length;
  const nomeCortado = nome.slice(0, maxNome);
  return `${prefixo}${nomeCortado}${sufixo}`;
}

// Troca só o "- 1234" no fim do apelido (ou acrescenta, se não tiver nenhum)
// — mesma sintaxe que estatisticas.js#idFivemDoNick lê de volta. Diferente de
// formatarNick acima (que reformata o nick inteiro no padrão de recrutamento
// novo), esta preserva o resto do apelido como já está — usada em qualquer
// fluxo que vincula/corrige o ID de um membro que já está no servidor com
// nick do jeito dele (presença, IDs sem Discord). Corta o nome se precisar
// pra caber no limite de 32 caracteres do Discord.
function aplicarIdNoNick(nickAtual, novoId) {
  const semId = String(nickAtual ?? '').replace(/\s*-\s*\d{1,8}\s*$/, '').trimEnd();
  const sufixo = ` - ${novoId}`;
  const base = semId || 'Sem nome';
  return `${base.slice(0, Math.max(0, 32 - sufixo.length))}${sufixo}`;
}

module.exports = { formatarNick, aplicarIdNoNick };

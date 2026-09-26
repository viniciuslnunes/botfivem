# Contrato: canal de atualizações

Todo o que muda para quem usa o servidor (novidade, melhoria, correção, regra de
negócio) sai sozinho no canal **🤖・atualizações** (`canais.atualizacoes`). Sem
canal (`null`), nada é postado.

## Como registrar uma atualização

Um arquivo por entrega em `atualizacoes/AAAA-MM-DD-slug.js` (o nome do arquivo é o `id`):

```js
module.exports = {
  id: '2026-09-26-regra-erro-de-manto',
  data: '2026-09-26',
  tipo: 'regra',            // novo | melhoria | correcao | regra
  titulo: 'Quem responde por um manto errado',       // até 100
  resumo: 'Uma frase do que aconteceu.',            // até 500
  itens: ['Cada ponto, sem jargão técnico.'],        // 1 a 8, até 220 cada
  quem: 'Todos os recrutadores.',                    // opcional, até 200
  modulos: ['recrutamento'],                         // [] = todas as torcidas
};
```

## Regras

- **Escreva para quem usa o servidor**, não para quem programa: o que mudou, o que
  vale agora, quem é afetado. Nada de nome de arquivo, função ou tabela.
- **`modulos`**: a entrada só sai em torcida que tem algum desses módulos ligados.
  Vazio = todas. Módulo que não existe reprova o teste.
- **`regra`** é para mudança de regra de negócio (o que vale, quem responde). Ela
  também deve estar em `docs/contratos/regras-negocio.md`.
- Sai **ao subir o bot**, da mais antiga para a mais nova, uma mensagem por entrada.
  O que já saiu fica em `bot_config` (`atualizacoes_postadas`): nada se repete e,
  se cair no meio, a subida seguinte continua de onde parou.
- **Servidor novo**: só sai o que tem até 7 dias; o histórico anterior é dado como
  visto, sem despejar o canal.
- Nunca se edita uma entrada já postada: corrigir é uma entrada nova.
- Cor e marca vêm do tema (nada verde). Menções ficam fechadas.

Código: `utils/atualizacoes/` (`regras.js` puro, `catalogo.js`, `publicador.js`),
módulo `modulos/atualizacoes.js`. Teste: `test/atualizacoes.test.js`.

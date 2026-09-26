# Contrato: tema (cor, emoji, marca, assets)

> Quem manda: `tema/` (base + validação) e `tenants/<slug>/tema.js` (o que cada
> torcida sobrescreve). Nenhum módulo escreve cor, emoji de estado, nome de
> torcida ou caminho de imagem — pede ao tema. O guardião
> (`test/conformidade.test.js`) falha se escrever.

## Como usar

```js
const tema = require('../tema');           // (../../tema em subpasta)

new EmbedBuilder()
  .setColor(tema.cor.perigo)                // número 0xRRGGBB
  .setTitle(tema.titulo('📦 BAÚ DA TORCIDA')) // "📦 BAÚ DA TORCIDA — <marca.nome>"
  .setThumbnail(tema.urlLogo());
canal.send({ embeds: [embed], files: [tema.logo()] });
texto = `${tema.emoji.ok} PRESENÇA CONFIRMADA`;
```

Helpers: `tema.titulo(x)`, `tema.tituloSegmentado(x)`, `tema.logo()`,
`tema.urlLogo()`, `tema.anexo(arquivo)`, `tema.urlAnexo(arquivo)`,
`tema.asset(arquivo)` (caminho absoluto em `tenants/<slug>/assets/`).

## Tokens

**`cor`** (inteiro, cor de embed): `primaria` (borda padrão), `perigo`
(alerta grave, cancelado, vencido), `aviso` (atenção, pendente), `destaque`
(contraste com a primária), `neutro` (encerrado, sem estado).

**`emoji`** (estado): `ok` (confirmação: botões CONFIRMAR/ACEITAR, "presença
confirmada"), `ativo` (vigente, online, vendendo, embarcado), `inativo`,
`perigo`, `aviso`, `alerta` (atenção suave: vencendo, encerrada, gravidade média), `pendente`, `recusado`, `marca` (assinatura da torcida).

**`imagem`** (`#rrggbb`, gráficos e canvas): `fundo`, `grade`, `gradeForte`,
`texto`, `textoFraco`, `barra`, `barraZero`, `media`, `destaque`, `disputa`.

**`cartao`** (carteirinha): `fundo`, `tinta`, `tintaSuave`, `sobreTinta`,
`borda`, `placeholderFundo`, `placeholderTexto`.

**`transcricao`** (HTML do transcript de ticket, réplica do visual escuro do
Discord): `fundoPagina`, `fundoCabecalho`, `fundoHover`, `painel`, `linha`,
`texto`, `textoFraco`, `textoForte`, `metaFraco`, `metaForte`, `rodape`,
`destaque`, `selo`, `link`.

**`marca`**: `nome`, `nomeSegmentado`, `nomeCurto`, `nomeNormal`,
`nomeNormalFivem`, `nomeTorcida`, `de` (preposição+artigo: "dos", "da"; dela
saem `dosNome` e `dosNormal`), `sigla`, `nickPrefixo`, `logo`, `capa`, `faixa`,
`textos.parceiros`, `carteirinha.{subtitulo,fundacao,assinatura.{nome,cargo}}`
e o opcional `elenco.{titulo,nome,sigla,logo}`.

## Matiz proibido

`proibido: { matizes: ['verde'] }` no tema do tenant faz o bot **recusar subir**
se qualquer token de cor ou emoji de estado cair nesse matiz. Matizes:
`vermelho laranja amarelo verde ciano azul roxo rosa`. Cinza, preto e branco
não têm matiz. Os Gaviões proíbem verde (regra da torcida); uma torcida de
mancha verde deixa `proibido: { matizes: [] }` e troca o resto.

## Tons proibidos (preto, branco, cinza) e contraste

`proibido: { matizes: [...], tons: ['preto'] }`: `tons` aceita `preto`, `branco`,
`cinza`. Preto = luminosidade ≤ 13% e pouca saturação; branco = ≥ 92%; cinza = sem
saturação no meio. Vale para toda cor e para os emojis (⚫⬛🖤 / ⚪⬜🤍). Uma torcida
que não usa preto (Mancha, Máfia Azul) declara `tons: ['preto']`; uma que não usa
azul (Galocura) declara `matizes: ['azul']`. **A base (`tema/base.js`) é preta e
branca**: token que o tenant não declarar e que violar a proibição derruba a subida
com a mensagem "herdado da base, declare em tenants/<slug>/tema.js".

Contraste mínimo (WCAG) conferido na subida: `imagem.texto`/`fundo` 4.5:1,
`imagem.textoFraco`/`fundo` 3:1, `cartao.tinta`/`fundo` 4.5:1,
`cartao.sobreTinta`/`tinta` 4.5:1, `transcricao.texto`/`fundoPagina` 4.5:1. Paleta
ilegível não sobe.

Emoji de cor (🔴🟡⚫⚪🔵🖤❤️…) literal em código é violação (`emojiCor` do guardião):
use `tema.emoji.*`.

## Acrescentar um token

1. Valor de partida em `tema/base.js` (e, se for obrigatório, em
   `tema/validacao.js`).
2. Valor da torcida em `tenants/<slug>/tema.js` quando diferir.
3. Listar aqui (o teste `test/docs.test.js` confere que todo token do base
   aparece neste arquivo).
4. Usar no módulo. Nunca copiar o valor.

## Regras que o guardião cobra

Fora de `config/`, `tenants/`, `tema/`, `fontes/`: nenhum literal de cor
(`0x…`, `#rrggbb`, `rgb()`, `#rgb` em CSS), nenhum emoji 🟢 ✅ 💚 🟩, nenhuma marca
de torcida ou servidor de jogo, nenhum ID de Discord entre aspas, nenhum caminho
`img/`. Contagem por arquivo em `test/conformidade.baseline.json` (hoje zero em
tudo): só pode diminuir.

# Fluxo: <nome>

- **Slug:** <slug>
- **Estado:** desenho | em implementação | com aprovação manual | automático
- **Dono humano:** <cargo/área responsável>
- **Torcidas:** <quais tenants usam>

## Objetivo
<uma frase: o que muda para quem usa>

## Gatilho
<evento exato: canal, botão, log; como é a chave de idempotência>

## Etapas
| # | Etapa | Entrada | Saída | Estado ao terminar | Falha vira |
|---|---|---|---|---|---|

## Estados
`pendente → processando → aguardando_aprovacao → concluido | falhou | descartado`
<acrescente só o que este fluxo precisar>

## Saída (efeito no mundo)
<o que é publicado/alterado, onde, e como se desfaz>

## Aprovação
<quem aprova, onde, e quando o fluxo pode virar automático>

## Dependências externas
| Serviço | Para quê | Credencial (variável) | Sem ela |
|---|---|---|---|

## Limites
<volume por dia, cota de API, custo, tempo máximo por etapa>

## Onde aparece no Discord
<canal-painel de fila/falhas; qual padrão de docs/padroes.md reaproveita>

## Riscos e perguntas em aberto

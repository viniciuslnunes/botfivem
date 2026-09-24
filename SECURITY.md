# Segurança

## Segredos

- `DISCORD_TOKEN` e `DATABASE_URL` só em variável de ambiente ou secret do
  orquestrador. O `.env` está no `.gitignore`; nunca o versione, nunca o cole em
  ticket, chat ou log.
- O bot só usa o token em `client.login` e no registro de comandos; não o
  imprime. Tokens de integrações futuras (redes sociais etc.) seguem a mesma
  regra: variável de ambiente, nunca em `tenants/`.
- Token vazou → **Reset Token** no portal do Discord e atualize a instância na hora.

## Isolamento entre torcidas

Uma instância por torcida: token, banco e processo próprios. Não há dado nem
conexão compartilhados em runtime, então uma torcida não enxerga a outra. Os
dados de cada torcida (IDs, marca, assets) ficam no tenant dela; para vender,
mantenha-os fora do repositório do produto (`TENANTS_DIR`).

## Banco

- **TLS**: `DATABASE_SSL=verify` (com `DATABASE_CA` se preciso) valida o
  certificado. O padrão `no-verify` é o comportamento histórico e **não protege
  contra interceptação**; o bot avisa no log quando o usa com banco remoto.
- Uma conexão ociosa que cai não derruba o processo (o pool trata o erro).
- Migrações são só aditivas; nada apaga dado.
- Teste e script nunca tocam o banco real (`npm test` usa PGlite e stubs).

## Permissões

- Dê ao bot o mínimo: `/setup diagnostico` lista as permissões que cada módulo
  ligado usa e o que falta. A lista é o que o código exige; se algum fluxo
  falhar por permissão que ela não cobre, trate como bug do diagnóstico.
- O `/setup` (incluindo criar cargos e canais) é só para Administradores,
  conferido no handler. Os canais que ele cria nascem privados (só liderança e o bot), exceto os
  públicos por natureza (ticket, carteirinha, mural, hierarquia, elenco).
- Em todo fluxo, a permissão é conferida **no handler** (`utils/permissoes.js`),
  nunca só escondendo botão.
- O bot precisa dos intents privilegiados **Server Members** e **Message Content**.

## Dados pessoais

O bot guarda IDs do Discord, o telefone e a idade informados no recrutamento, e
os logs de atividade do jogo. Quem opera a torcida é o responsável por esses
dados (LGPD): defina retenção, quem acessa o banco e como atender pedido de
exclusão. O produto não implementa (ainda) exportação/anonimização automática.

## Superfície exposta

- `GET /health` (opcional, `HEALTH_PORT`): só slug, booleans e números; mantenha
  em rede interna.
- Não há painel web nem API pública.

## Dependências

`npm audit` e `npm outdated` a cada release; o CI roda lint e testes. Atualize o
`discord.js` e o `pg` com atenção (mudanças de API do Discord).

## Reportar problema

Vulnerabilidade: avise o mantenedor em privado (não abra issue pública com o
detalhe) e informe versão, passos e impacto.

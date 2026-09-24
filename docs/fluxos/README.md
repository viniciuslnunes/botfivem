# Arquitetura de fluxos automatizados

> Estado: **desenho** (2026-09-24). Nada aqui está implementado em código ainda;
> o primeiro fluxo a sair do papel é o de mídias sociais
> (`docs/fluxos/midias-sociais.md`). Os padrões de UI do bot continuam valendo
> (`docs/padroes.md`); este documento cobre o que acontece **fora** da tela:
> entrada, processamento, saída.

## O que é um fluxo

Uma cadeia com três partes fixas:

```
GATILHO  →  ETAPAS  →  SAÍDA
(evento)    (jobs)     (efeito no mundo)
```

Exemplos previstos: clipe postado no Discord vira post nas redes (mídias);
recrutamento aprovado vira carteirinha e cargo (já existe, sem esse nome);
evento criado vira convocação e lembrete (agenda/escala).

## Princípios

1. **Reativo, com rede de segurança.** O gatilho é um evento (mensagem num
   canal, botão, log novo), tratado na hora; um ciclo por tempo varre o que
   escapou. É o mesmo par que o `painelCanal` já usa (evento + intervalo).
2. **Etapa é job, não código encadeado.** Cada etapa lê e grava o estado do
   fluxo no Postgres e pode ser repetida. O bot não segura um download de 200 MB
   dentro de um handler de interação.
3. **Idempotência.** Cada execução tem uma chave natural (ex.: id da mensagem do
   Discord). Reprocessar a mesma chave não duplica post, cobrança ou cargo.
4. **Estado explícito.** `pendente → processando → aguardando_aprovacao →
   concluido | falhou | descartado`. Nada de "sumiu": se falhou, aparece num
   canal-painel com o motivo. Nunca marcar `concluido` antes de a saída ter de
   fato funcionado (padrões 1.5).
5. **Humano no laço onde há risco.** Publicar em rede pública, mexer em dinheiro
   ou cargo passa por aprovação (botão, conferido no handler) até a liderança
   decidir que aquele fluxo pode ser automático. O modo automático é uma
   configuração por fluxo e por torcida, não uma mudança de código.
6. **Dependência externa opcional degrada, não quebra.** Cada integração (API de
   rede social, serviço de vídeo, IA) fica atrás de `estaConfigurado()`. Sem
   credencial, o fluxo para em `aguardando_configuracao` e avisa; o bot sobe.
7. **Torcida é dado.** Marca, cores, canais, horários e textos vêm de
   `tenants/<slug>/`. O código do fluxo é o mesmo para qualquer torcida.
8. **Auditável.** Cada transição de estado gera registro (quem, quando, o quê),
   reaproveitando `utils/logGestao.js`.
9. **Segredo fora do repositório.** Tokens de rede social só em variável de
   ambiente; nunca em `tenants/`, nunca em log.
10. **Custo e cota são requisito.** Todo fluxo declara o limite (posts/dia,
    chamadas de IA, cota de API) e o que acontece ao estourar.

## Anatomia no repositório

```
fluxos/
  _modelo/fluxo.md             # copie para criar um fluxo novo
  <slug>/fluxo.md              # manifesto: gatilho, etapas, estados, dono, limites
utils/fluxos/                  # (a criar) motor genérico: fila, estados, retry
utils/<modulo>/                # código específico do fluxo, como os outros módulos
tenants/<slug>/fluxos/<fluxo>/ # o que é da torcida: página, textos, imagens
docs/fluxos/<fluxo>.md         # decisões, riscos e perguntas em aberto
```

O motor genérico só nasce quando o **segundo** fluxo pedir. O primeiro é escrito
direto, seguindo estes princípios; a extração vem depois, com dois exemplos reais.

## Como criar um fluxo novo

1. `arquiteto-fluxos` preenche `fluxos/<slug>/fluxo.md` a partir do modelo e lista
   as perguntas em aberto para o usuário.
2. Usuário responde e aprova o manifesto.
3. `implementacao` codifica com escopo mínimo: gatilho primeiro, uma etapa por vez,
   cada uma com teste de regra pura.
4. `qa-conformidade` roda `npm test`, `npm run lint`, `npm run conformidade` e
   confere o manifesto contra o código.
5. Liderança valida em modo com aprovação manual; só depois liga o automático.

## Fora de escopo por enquanto

Fila externa (Redis/BullMQ), orquestrador de workflow, painel web. O Postgres já
existe e a carga esperada (dezenas de itens por dia) não justifica mais peças.
Rever se o volume ou o número de fluxos crescer.

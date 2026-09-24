# Fluxo: mídias sociais

> Estado: **planejamento** (2026-09-24). Reunião de apresentação: sábado, 19h.
> Página de onboarding já publicada em
> `tenants/gavioes/fluxos/midias-sociais/apresentacao.html`.

## Objetivo

Clipes que a torcida posta no Discord viram conteúdo publicado no YouTube,
YouTube Shorts, TikTok e Instagram, 2 a 3 por dia, com o mínimo de trabalho
manual. Além do resultado, o departamento é um lugar para as pessoas **aprender a
operar o fluxo**, então o processo precisa ser legível, não uma caixa-preta.

## Desenho

```
#midias (Discord)  →  detectar link/vídeo  →  baixar  →  cortar/editar  →  fila de aprovação  →  publicar (agendado)
     gatilho            etapa 1               etapa 2      etapa 3            etapa 4              saída
```

| Etapa | O que faz | Estado ao terminar |
|---|---|---|
| Gatilho | Mensagem em `#midias` com link do Medal ou anexo de vídeo | `pendente` |
| 1. Detectar | Extrai a URL, ignora duplicata (chave: id da mensagem) | `processando` |
| 2. Baixar | Obtém o arquivo original | `processando` |
| 3. Editar | Gera os cortes e monta o vídeo no padrão visual da torcida (IA) | `aguardando_aprovacao` |
| 4. Aprovar | Responsável da rede confere no canal-painel (botão) | `agendado` ou `descartado` |
| Saída | Publica no horário programado em cada rede | `concluido` ou `falhou` |

Cadência: 2 a 3 publicações por dia, em horários fixos definidos no tenant.

## Papéis

- **Um representante por rede** (YouTube, Shorts, TikTok, Instagram): aprova,
  acompanha resultado e comentários, propõe ajuste de estilo.
- **Quem posta clipe:** qualquer membro autorizado no canal `#midias`.
- **Responsável pelo fluxo:** mantém a configuração e o padrão visual.

## Modo de operação

Começa **com aprovação manual** em todas as publicações. Só vira automático por
rede, depois de um período de conferência, por decisão da liderança.

## Perguntas em aberto (resolver antes de codar)

1. **Medal:** como obter o arquivo a partir do link (download público do clipe?
   API?). Verificar termos de uso antes de automatizar download.
2. **Editor por IA:** qual ferramenta faz o corte e a edição (os vídeos de
   estudo usam Claude Code para editar). Roda no servidor do bot ou numa máquina
   à parte? Vídeo pesado não deve rodar no mesmo processo do bot.
3. **APIs de publicação:** cada rede tem regras próprias. YouTube exige projeto e
   cota de upload; TikTok e Instagram exigem app aprovado e conta profissional
   para publicar por API. **Verificar a situação atual de cada uma** antes de
   prometer publicação 100% automática; pode ser que uma rede comece semi-manual
   (o bot entrega o arquivo pronto e a legenda para o representante postar).
4. **Direitos:** música de fundo e conteúdo de terceiros em clipe de jogo.
5. **Onde roda:** o bot está no Railway. Processamento de vídeo tem custo de
   CPU, disco e tempo; decidir se fica em serviço separado.
6. **Canal de apresentação no Discord** para as respostas do formulário.

## Riscos

- Publicação errada é pública e difícil de desfazer: por isso a aprovação inicial.
- Cota ou bloqueio de API derrubando um dia de postagem: fluxo precisa avisar,
  não falhar em silêncio (padrões 1.6).
- Token de rede social vazando: só em variável de ambiente.

## Marcos

1. Sábado: apresentar o plano e formar a equipe (um representante por rede).
2. Definir as perguntas em aberto acima.
3. Protótipo: gatilho + detecção + fila visível no Discord, sem publicar.
4. Edição automática com aprovação manual.
5. Publicação por rede, uma de cada vez.


const { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const recrutamentoButtons = require('./utils/recrutamentoButtons');
require('dotenv').config();
// ...existing code...

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// Carregar comandos slash
const commands = new Map();
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.set(command.data.name, command);
}

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command) return;
        // Se for o /recrutar, mostrar modal
        if (interaction.commandName === 'recrutar') {
            const modal = new ModalBuilder()
                .setCustomId('modal_recrutamento')
                .setTitle('Formulário de Recrutamento');
            const nomeInput = new TextInputBuilder()
                .setCustomId('nome')
                .setLabel('Nome')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            const idadeInput = new TextInputBuilder()
                .setCustomId('idade')
                .setLabel('Idade')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            const idFiveMInput = new TextInputBuilder()
                .setCustomId('id_fivem')
                .setLabel('ID FiveM')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            const telefoneInput = new TextInputBuilder()
                .setCustomId('telefone')
                .setLabel('Telefone')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            const recrutadorInput = new TextInputBuilder()
                .setCustomId('recrutador')
                .setLabel('Recrutador')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            modal.addComponents(
                new ActionRowBuilder().addComponents(nomeInput),
                new ActionRowBuilder().addComponents(idadeInput),
                new ActionRowBuilder().addComponents(idFiveMInput),
                new ActionRowBuilder().addComponents(telefoneInput),
                new ActionRowBuilder().addComponents(recrutadorInput)
            );
            await interaction.showModal(modal);
            return;
        }
        // Outros comandos
        try {
            await command.execute(interaction);
        } catch (err) {
            console.error(err);
            await interaction.reply({ content: 'Erro ao executar comando.', ephemeral: true });
        }
    }

    // Handler para submissão do modal
    if (interaction.isModalSubmit() && interaction.customId === 'modal_recrutamento') {
        const nome = interaction.fields.getTextInputValue('nome');
        const idade = interaction.fields.getTextInputValue('idade');
        const id_fivem = interaction.fields.getTextInputValue('id_fivem');
        const telefone = interaction.fields.getTextInputValue('telefone');
        const recrutador = interaction.fields.getTextInputValue('recrutador');
        const user = interaction.user;
        const canalAnalise = interaction.guild.channels.cache.get(config.canais.analise);
        if (!canalAnalise) return interaction.reply({ content: 'Canal de análise não encontrado.', flags: 64 });
        const embed = {
            color: 0x3498db,
            title: '📋 Nova Solicitação de Recrutamento',
            fields: [
                { name: 'Nome', value: nome, inline: false },
                { name: 'Idade', value: idade, inline: false },
                { name: 'ID FiveM', value: id_fivem, inline: false },
                { name: 'Telefone', value: telefone, inline: false },
                { name: 'Recrutador', value: recrutador, inline: false },
                { name: 'ID | Discord', value: `${user.id} | <@${user.id}>`, inline: false }
            ]
        };
        await interaction.reply({ content: 'Sua solicitação foi enviada para análise! Aguarde as próximas instruções.', flags: 64 });
        // O resto do fluxo roda em background para evitar timeout
        (async () => {
            await canalAnalise.send({ embeds: [embed], components: recrutamentoButtons });
            try {
                const guildMember = await interaction.guild.members.fetch(user.id);
                await guildMember.roles.add('1487347860734218250'); // PROVAR MANTO
                // Avisar no canal provar-manto
                const canalProvarManto = interaction.guild.channels.cache.get('1461524452608053405');
                if (canalProvarManto) {
                    await canalProvarManto.send({
                        content: `👔 <@${user.id}>, você tem 10 minutos para enviar o manto (imagem) aqui neste canal! Após esse prazo, o cargo será removido automaticamente.`
                    });
                }
                // Agendar remoção do cargo e aviso em validar-setagem
                setTimeout(async () => {
                    try {
                        await guildMember.roles.remove('1487347860734218250');
                        const canalValidarSetagem = interaction.guild.channels.cache.get('1442240838699712623');
                        if (canalValidarSetagem) {
                            await canalValidarSetagem.send({
                                content: `✅ <@${user.id}> finalizou o tempo de PROVAR MANTO. Pronto para validação de setagem!`
                            });
                        }
                    } catch (err) {
                        console.error('Erro ao remover cargo PROVAR MANTO ou avisar:', err);
                    }
                }, 10 * 60 * 1000); // 10 minutos
            } catch (err) {
                console.error('Erro ao atribuir cargo PROVAR MANTO:', err);
            }
        })();
    }

    // Handler para botões de aprovação/reprovação
    if (interaction.isButton()) {
        if (interaction.customId === 'aprovar_recrutamento') {
            // Extrair dados do candidato do embed
            const embed = interaction.message.embeds[0];
            const idField = embed.fields.find(f => f.name.startsWith('ID | Discord'));
            const candidatoId = idField ? idField.value.split(' ')[0] : null;
            const nomeField = embed.fields.find(f => f.name === 'Nome');
            const idFiveMField = embed.fields.find(f => f.name === 'ID FiveM');
            const nome = nomeField ? nomeField.value : '';
            const id_fivem = idFiveMField ? idFiveMField.value : '';
            // Dar cargo de sócio e alterar nick
            try {
                const guildMember = await interaction.guild.members.fetch(candidatoId);
                await guildMember.roles.add(config.cargos.socio);
                // Alterar nick para o padrão
                const novoNick = `S GDF | ${nome} - ${id_fivem}`;
                await guildMember.setNickname(novoNick);
            } catch (err) {
                await interaction.update({
                    content: `⚠️ Não foi possível atribuir o cargo de sócio ou alterar o nick de <@${candidatoId}>. Verifique se o usuário está no servidor e se o bot tem permissão.`,
                    embeds: interaction.message.embeds,
                    components: []
                });
                return;
            }
            await interaction.update({
                content: '✅ Recrutamento aprovado! Por favor, envie o manto (imagem) deste candidato como resposta nesta conversa. O processo só será concluído após o envio da imagem.',
                embeds: interaction.message.embeds,
                components: []
            });
            // Coletar próxima mensagem com imagem
            const filter = m => m.attachments.size > 0 && m.attachments.first().contentType && m.attachments.first().contentType.startsWith('image/');
            const channel = interaction.channel;
            channel.awaitMessages({ filter, max: 1, time: 120000, errors: ['time'] })
                .then(async collected => {
                    const mantoMsg = collected.first();
                    // Confirmação visual
                    await channel.send({ content: `🧥 Manto recebido para <@${candidatoId}>! Processo concluído.`, reply: { messageReference: mantoMsg.id } });
                })
                .catch(() => {
                    channel.send('⏰ Tempo esgotado! O manto não foi enviado. Recomece o processo se necessário.');
                });
        } else if (interaction.customId === 'reprovar_recrutamento') {
            await interaction.update({ content: '❌ Recrutamento reprovado.', embeds: interaction.message.embeds, components: [] });
        }
    }
});
client.once('clientReady', () => {
    console.log(`Bot online como ${client.user.tag}`);
});

client.on('messageCreate', message => {
    if (message.content === '!ping') {
        message.reply('Pong!');
    }
    if (message.content === '!sociais') {
        message.channel.send({
            embeds: [
                {
                    color: 0x3498db, // azul
                    title: '🌐 REDES SOCIAIS',
                    description: 'Acesse todas as nossas redes sociais aqui:\n\n[Clique aqui](https://linktr.ee/gavioesdafielfivem)',
                    thumbnail: {
                        url: 'attachment://gavioesdafielfivem_logo.png'
                    }
                }
            ],
            files: [
                {
                    attachment: './img/gavioesdafielfivem_logo.png',
                    name: 'gavioesdafielfivem_logo.png'
                }
            ]
        });
    }

    if (message.content === '!parceiros') {
        const embed = {
            color: 0x23272A,
            title: '🤝 PARCEIROS DOS GAVIÕES DA FIEL - FIVEM',
            description: 'A FIEL é gigante, e só cresce porque temos ao nosso lado parceiros que apoiam a nossa paixão pelo Corinthians.\nClique nos botões abaixo e conheça cada um deles!',
            image: {
                url: 'attachment://gavioesdafielfivem_logo.png'
            }
        };
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('BX STORE')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.gg/gtbXKJamP4'),
            new ButtonBuilder()
                .setLabel('SCCP DISCORD')
                .setStyle(ButtonStyle.Link)
                .setURL('https://discord.gg/sccp'),
            new ButtonBuilder()
                .setLabel('FUT CORINTHIANS')
                .setStyle(ButtonStyle.Link)
                .setURL('https://www.tiktok.com/@fut_corinthians')
        );
        message.channel.send({
            embeds: [embed],
            components: [row],
            files: [
                {
                    attachment: './img/gavioesdafielfivem_logo.png',
                    name: 'gavioesdafielfivem_logo.png'
                }
            ]
        });
    }
});

client.login(process.env.BOT_TOKEN);

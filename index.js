require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

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
                    color: 0x23272A, // cor escura
                    title: ':globe_with_meridians: Nossos Sociais',
                    description: 'Acesse todas as nossas redes sociais aqui:\n\n[Clique aqui](https://linktr.ee/gavioesdafielfivem)',
                    thumbnail: {
                        url: 'https://cdn.discordapp.com/attachments/1222327899786694736/1222369642320263218/gavioesdafielfivem.png'
                    }
                }
            ]
        });
    }
});

client.login(process.env.BOT_TOKEN);

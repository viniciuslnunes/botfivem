// Handler de eventos: ready
module.exports = (client) => {
  client.once('clientReady', () => {
    console.log(`Bot online como ${client.user.tag}`);
  });
};

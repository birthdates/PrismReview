const { createClient } = require('redis');
const env = require('dotenv').config({path: [['.env', '.env.local']]}).parsed;
const TelegramBot = require('node-telegram-bot-api');
const OWNER_IDS = env.OWNER_IDS.split(',').map(id => parseInt(id));
const GROUP_CHAT = env.GROUP_ID;
const token = env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, {polling: true});
const REDIS_KEY = "review:bot:users";

bot.on("polling_error", console.log);

const isOwner = (id) => {
  return OWNER_IDS.includes(id);
}

const getClient = async () => {
    const client = createClient({ legacyMode: true });
    if (client && client.status === 'ready') {
      return client;
    }
    
    client.connect();
    return client;
}

const capitalizeFirstLetter = (str) => {
  return str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const args = msg.text.toString().toLowerCase().split(' ');
  if (!args[0].includes("/")) {
    return;
  }
  const cmd = args[0].substring(1);
  // remove first char
  args.shift();
  switch (cmd) {
    case "whitelist":
      const id = msg.from.id;
      if (!isOwner(id)) {
        bot.sendMessage(chatId, 'You are not allowed to use this command');
        return;
      }

      if (args.length < 1) {
        bot.sendMessage(chatId, 'Please enter the user id');
        return;
      }

      const rClient = await getClient();
      await rClient.sAdd(REDIS_KEY, id.toString());
      bot.sendMessage(chatId, `User ${id} has been whitelisted`);
      break;
    case 'review':
      if (args.length < 3) {
        bot.sendMessage(chatId, 'Please fill out the arguments.');
        return;
      }
      const userId = msg.from.id;
      // check if userid is in redis
      const client = await getClient();
      const exists = await client.v4.sIsMember(REDIS_KEY, userId.toString());
      if (!isOwner(userId) && !exists) {
        bot.sendMessage(chatId, 'You need to make an order before you can review us!');
        return;
      }
    

      let indexTillFirstNumber = 0;
      for (let i = 0; i < args.length; i++) {
        if (!isNaN(args[i])) {
          indexTillFirstNumber = i;
          break;
        }
      }

      // let purcased be all the way up to indexTillFirstNumber
      let purchased = args[0];
      for (let i = 1; i <= indexTillFirstNumber+1; i++) {
        purchased += ' ' + args[i];
      }
      args.shift();
      purchased = purchased.length > 30 ? purchased.substring(0, 30) : purchased;

      const rating = parseFloat(args[indexTillFirstNumber + (purchased.includes(" ") ? -1 : +1)]).toFixed(1);
      if (rating < 0 || rating > 10) {
        bot.sendMessage(chatId, 'Please enter a valid rating (0-10)');
        return;
      }
      args.shift();   

      // Check if review is anom
      let review = args.join(' ');
      const anonMsgs = ["anon", "anonymous", "anom", "y", "n", "m", "s", "o", "u", "sly", "n"];
      let anom = false;
      for (let i = 0; i < anonMsgs.length; i++) {
        if (review.endsWith(anonMsgs[i])) {
          anom = true;
          break;
        }
      }

      // remove anom msg from end of review
      if (anom) {
        for (let i = 0; i < anonMsgs.length; i++) {
          if (review.endsWith(anonMsgs[i])) {
            review = review.substring(0, review.length - anonMsgs[i].length);
            break;
          }
        }
      }

      // format review
      review = (review.length > 1000 ? review.substring(0, 1000) : review);
      review = capitalizeFirstLetter(review);
      await bot.sendMessage(chatId, `Purchased: ${purchased}\nRating: ${rating}/10\nReview: ${review}🌟\nThank you for your review!`);
      
      await client.sRem(REDIS_KEY, userId);
      bot.sendMessage(GROUP_CHAT, "```REVIEW New review from " + (anom ? "Anonymous" : "@" + msg.from.username) + "\nRating 🌟: " + rating + "/10\nReview: " + review + "\nPurchased: " + purchased + "```", {
        parse_mode: 'MarkdownV2'
      });
      break;
  }
});
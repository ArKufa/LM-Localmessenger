const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Discord Webhook URL (замените на свой)
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/your-webhook-url';

// Discord Bot Token (опционально)
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Хранилище в памяти
const activeUsers = new Map();
const userSockets = new Map();
const messageHistory = {
  'general': [],
  'ooc': [],
  'faction': [],
  'trade': [],
  'events': []
};

// Каналы как в Discord
const channels = [
  { id: 'general', name: 'общий-чат', icon: '💬', type: 'text' },
  { id: 'ooc', name: 'оос-чат', icon: '🎭', type: 'text' },
  { id: 'faction', name: 'фракции', icon: '⚔️', type: 'text' },
  { id: 'trade', name: 'торговля', icon: '💰', type: 'text' },
  { id: 'events', name: 'ивенты', icon: '🎉', type: 'text' },
  { id: 'voice', name: 'войс-чат', icon: '🔊', type: 'voice' }
];

// Функция отправки сообщения в Discord
async function sendToDiscord(messageData) {
  if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.includes('discord.com')) return;

  try {
    const embed = {
      title: `💬 Новое сообщение в ${messageData.channel}`,
      description: messageData.content,
      color: 0x5865F2, // Discord blue
      fields: [
        {
          name: '👤 Отправитель',
          value: `${messageData.character} (${messageData.sender})`,
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    };

    await axios.post(DISCORD_WEBHOOK_URL, {
      content: `📨 **LM Messenger**: ${messageData.character} написал в ${messageData.channel}`,
      embeds: [embed]
    });
  } catch (error) {
    console.error('❌ Ошибка отправки в Discord:', error.message);
  }
}

// Функция получения сообщений из Discord (если есть бот)
async function setupDiscordBot() {
  if (!DISCORD_BOT_TOKEN) return;

  try {
    // Здесь можно настроить Discord Bot для получения сообщений
    console.log('🤖 Discord Bot подключен');
  } catch (error) {
    console.error('❌ Ошибка подключения Discord Bot:', error.message);
  }
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'LM-Local Messenger с Discord интеграцией',
    discord: DISCORD_WEBHOOK_URL ? 'Webhook настроен' : 'Webhook не настроен',
    usersOnline: activeUsers.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/channels', (req, res) => {
  res.json(channels);
});

app.get('/api/messages/:channel', (req, res) => {
  const { channel } = req.params;
  res.json(messageHistory[channel] || []);
});

app.get('/api/online-users', (req, res) => {
  const onlineUsers = Array.from(activeUsers.values());
  res.json(onlineUsers);
});

// Socket.io соединения
io.on('connection', (socket) => {
  console.log('🔗 Новое подключение:', socket.id);

  socket.on('user_join', async (userData) => {
    const user = {
      id: socket.id,
      username: userData.username,
      character: userData.character,
      avatar: userData.avatar || userData.username.charAt(0).toUpperCase(),
      status: 'online',
      joinedAt: new Date()
    };

    activeUsers.set(socket.id, user);
    userSockets.set(userData.username, socket.id);

    // Отправляем уведомление в Discord о новом пользователе
    if (DISCORD_WEBHOOK_URL) {
      try {
        await axios.post(DISCORD_WEBHOOK_URL, {
          content: `🟢 **${user.character}** присоединился к LM Messenger`
        });
      } catch (error) {
        console.error('Ошибка отправки в Discord:', error.message);
      }
    }

    socket.broadcast.emit('user_joined', user);
    io.emit('online_users_update', Array.from(activeUsers.values()));

    // Приветственное сообщение
    const welcomeMessage = {
      id: Date.now(),
      sender: 'system',
      character: 'Система',
      avatar: '🤖',
      content: `Добро пожаловать в чат, **${user.character}**! 🎉`,
      channel: 'general',
      created_at: new Date().toISOString(),
      is_system: true
    };

    if (!messageHistory.general) messageHistory.general = [];
    messageHistory.general.push(welcomeMessage);
    socket.emit('new_message', welcomeMessage);

    console.log(`✅ ${user.character} присоединился к чату`);
  });

  socket.on('send_message', async (messageData) => {
    const user = activeUsers.get(socket.id);
    if (!user) return;

    const message = {
      id: Date.now(),
      sender: user.username,
      character: user.character,
      avatar: user.avatar,
      content: messageData.content,
      channel: messageData.channel || 'general',
      created_at: new Date().toISOString(),
      is_system: false
    };

    // Сохраняем сообщение
    const channel = messageData.channel || 'general';
    if (!messageHistory[channel]) messageHistory[channel] = [];
    messageHistory[channel].push(message);

    // Отправляем всем в мессенджере
    io.emit('new_message', message);

    // Отправляем в Discord
    await sendToDiscord(message);

    // Обработка команд
    if (messageData.content.startsWith('/')) {
      handleCommand(messageData.content, user, socket);
    }
  });

  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      activeUsers.delete(socket.id);
      userSockets.delete(user.username);

      // Уведомление о выходе в Discord
      if (DISCORD_WEBHOOK_URL) {
        axios.post(DISCORD_WEBHOOK_URL, {
          content: `🔴 **${user.character}** покинул LM Messenger`
        }).catch(console.error);
      }

      socket.broadcast.emit('user_left', user);
      io.emit('online_users_update', Array.from(activeUsers.values()));

      console.log(`👋 ${user.character} покинул чат`);
    }
  });
});

// Обработка команд
function handleCommand(command, user, socket) {
  const [cmd, ...args] = command.slice(1).split(' ');
  let response = '';

  switch (cmd.toLowerCase()) {
    case 'help':
      response = `**📋 Доступные команды:**\n\`/help\` - Список команд\n\`/online\` - Онлайн пользователи\n\`/roll [число]\` - Бросок кубика\n\`/me [действие]\` - RP действие`;
      break;
    case 'online':
      const onlineCount = activeUsers.size;
      const users = Array.from(activeUsers.values()).map(u => u.character).join(', ');
      response = `**👥 Онлайн: ${onlineCount}**\n${users}`;
      break;
    case 'roll':
      const max = parseInt(args[0]) || 100;
      const result = Math.floor(Math.random() * max) + 1;
      response = `🎲 **${user.character}** бросает кубик: **${result}**`;
      break;
    case 'me':
      const action = args.join(' ');
      response = `* **${user.character}** ${action}`;
      break;
    default:
      response = `❌ Неизвестная команда: \`/${cmd}\``;
  }

  const systemMessage = {
    id: Date.now(),
    sender: 'system',
    character: 'Система',
    avatar: '⚙️',
    content: response,
    channel: 'general',
    created_at: new Date().toISOString(),
    is_system: true
  };

  if (!messageHistory.general) messageHistory.general = [];
  messageHistory.general.push(systemMessage);
  socket.emit('new_message', systemMessage);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 LM-Local Messenger с Discord интеграцией запущен на порту ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`💬 Discord Webhook: ${DISCORD_WEBHOOK_URL ? 'Настроен' : 'Не настроен'}`);
  setupDiscordBot();
});

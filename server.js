const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

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

// Проверяем существование папки public и файлов
const publicDir = path.join(__dirname, 'public');
console.log('📁 Public directory path:', publicDir);

// Обслуживаем статические файлы
app.use(express.static(publicDir));

// Попытка подключения к Supabase
let supabase = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('✅ Supabase клиент инициализирован');
  } else {
    console.log('⚠️ Supabase переменные окружения не установлены. Используется режим без базы данных.');
  }
} catch (error) {
  console.log('⚠️ Supabase недоступен. Используется режим без базы данных.');
}

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

// Боты системы
const systemBots = {
  'rp_helper': {
    name: 'RP Helper',
    character: 'Системный Помощник',
    avatar: '🤖',
    description: 'Помощник по RP правилам'
  },
  'game_master': {
    name: 'Game Master',
    character: 'Мастер Игры',
    avatar: '🎮',
    description: 'Гейммастер сервера'
  }
};

// Каналы
const channels = [
  { id: 'general', name: 'Общий чат', description: 'Основной чат для общения' },
  { id: 'ooc', name: 'OOC чат', description: 'Out of Character общение' },
  { id: 'faction', name: 'Фракции', description: 'Общение между фракциями' },
  { id: 'trade', name: 'Торговля', description: 'Торговля и обмен' },
  { id: 'events', name: 'События', description: 'Ивенты и мероприятия' }
];

// Вспомогательные функции для работы с данными
const database = {
  async saveUser(user) {
    if (supabase) {
      try {
        const { error } = await supabase
          .from('users')
          .upsert({
            username: user.username,
            character: user.character,
            avatar: user.avatar,
            is_online: true,
            last_seen: new Date().toISOString()
          });
        return !error;
      } catch (error) {
        console.error('❌ Ошибка сохранения пользователя в Supabase:', error.message);
        return false;
      }
    }
    return true;
  },

  async saveMessage(message) {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('messages')
          .insert([message])
          .select()
          .single();
        return { data, error };
      } catch (error) {
        console.error('❌ Ошибка сохранения сообщения в Supabase:', error.message);
        return { error };
      }
    } else {
      const channel = message.channel || 'general';
      if (!messageHistory[channel]) messageHistory[channel] = [];
      
      const messageWithId = {
        ...message,
        id: Date.now() + Math.random()
      };
      
      messageHistory[channel].push(messageWithId);
      
      if (messageHistory[channel].length > 100) {
        messageHistory[channel] = messageHistory[channel].slice(-50);
      }
      
      return { data: messageWithId };
    }
  },

  async loadMessages(channel) {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('channel', channel)
          .order('created_at', { ascending: true })
          .limit(100);
        return { data, error };
      } catch (error) {
        console.error('❌ Ошибка загрузки сообщений из Supabase:', error.message);
        return { error };
      }
    } else {
      return { data: messageHistory[channel] || [] };
    }
  },

  async updateUserOffline(username) {
    if (supabase) {
      try {
        const { error } = await supabase
          .from('users')
          .update({
            is_online: false,
            last_seen: new Date().toISOString()
          })
          .eq('username', username);
        return !error;
      } catch (error) {
        console.error('❌ Ошибка обновления статуса пользователя:', error.message);
        return false;
      }
    }
    return true;
  }
};

// API Routes
app.get('/api/health', async (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'LM-Local Messenger Server is running',
    database: supabase ? 'Supabase Connected' : 'In-Memory Mode',
    usersOnline: activeUsers.size,
    timestamp: new Date().toISOString()
  });
});

// Главная страница - отдаем index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Получение каналов
app.get('/api/channels', (req, res) => {
  res.json(channels);
});

// Получение истории сообщений
app.get('/api/messages/:channel', async (req, res) => {
  try {
    const { channel } = req.params;
    const { data, error } = await database.loadMessages(channel);
    
    if (error) throw error;
    
    res.json(data || []);
  } catch (error) {
    console.error('Ошибка загрузки сообщений:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получение онлайн пользователей
app.get('/api/online-users', (req, res) => {
  const onlineUsers = Array.from(activeUsers.values());
  res.json(onlineUsers);
});

// Обработка Socket.io соединений
io.on('connection', (socket) => {
  console.log('🔗 Новое подключение:', socket.id);

  socket.on('user_join', async (userData) => {
    try {
      const user = {
        id: socket.id,
        username: userData.username,
        character: userData.character,
        avatar: userData.avatar || userData.username.charAt(0).toUpperCase(),
        joinedAt: new Date(),
        lastSeen: new Date()
      };

      activeUsers.set(socket.id, user);
      userSockets.set(userData.username, socket.id);

      await database.saveUser(user);

      socket.broadcast.emit('user_joined', user);
      updateOnlineUsers();

      const welcomeMessage = {
        sender: 'system',
        character: systemBots.rp_helper.character,
        avatar: systemBots.rp_helper.avatar,
        content: `Добро пожаловать в чат, ${user.character}! Используйте /help для списка команд.`,
        channel: 'general',
        created_at: new Date().toISOString(),
        is_bot: true
      };

      const { data: savedMessage } = await database.saveMessage(welcomeMessage);
      if (savedMessage) {
        socket.emit('new_message', savedMessage);
      }
      
      console.log(`✅ Пользователь ${user.character} присоединился к чату`);

    } catch (error) {
      console.error('❌ Ошибка при присоединении пользователя:', error);
      socket.emit('join_error', { error: 'Не удалось присоединиться к чату' });
    }
  });

  socket.on('send_message', async (messageData) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user) {
        socket.emit('message_error', { error: 'Пользователь не найден' });
        return;
      }

      const message = {
        sender: user.username,
        character: user.character,
        avatar: user.avatar,
        content: messageData.content,
        channel: messageData.channel || 'general',
        created_at: new Date().toISOString(),
        is_bot: false
      };

      const { data: savedMessage, error } = await database.saveMessage(message);

      if (error) throw error;

      io.emit('new_message', savedMessage || message);

      if (messageData.content.startsWith('/')) {
        handleBotCommand(messageData.content, user, socket);
      }

    } catch (error) {
      console.error('❌ Ошибка отправки сообщения:', error);
      socket.emit('message_error', { error: 'Не удалось отправить сообщение' });
    }
  });

  socket.on('disconnect', async () => {
    const user = activeUsers.get(socket.id);
    
    if (user) {
      activeUsers.delete(socket.id);
      userSockets.delete(user.username);

      await database.updateUserOffline(user.username);

      socket.broadcast.emit('user_left', user);
      updateOnlineUsers();

      console.log(`👋 Пользователь ${user.character} покинул чат`);
    }
  });

  socket.on('ping', () => {
    socket.emit('pong', { timestamp: new Date().toISOString() });
  });
});

function handleBotCommand(command, user, socket) {
  const [cmd, ...args] = command.slice(1).split(' ');
  const response = {};

  switch (cmd.toLowerCase()) {
    case 'help':
      response.content = `
📋 **Доступные команды:**
/help - Показать это сообщение
/rules - Правила RP сервера  
/roll [число] - Бросок кубика (по умолчанию 100)
/me [действие] - Описание действия
/time - Текущее игровое время
/weather - Текущая погода
/online - Список онлайн игроков
      `;
      response.bot = 'rp_helper';
      break;

    case 'rules':
      response.content = `
📜 **Правила RP сервера:**
1. 🎭 Уважайте других игроков и их RP
2. 📖 Следуйте установленному лору сервера
3. 🚫 Не используйте метагейминг
4. 💬 Используйте /me для описания действий
5. ⚡ Администрация всегда права!
      `;
      response.bot = 'rp_helper';
      break;

    case 'roll':
      const max = parseInt(args[0]) || 100;
      const result = Math.floor(Math.random() * max) + 1;
      response.content = `🎲 **${user.character}** бросает кубик D${max}: **${result}**!`;
      response.bot = 'game_master';
      break;

    case 'me':
      const action = args.join(' ');
      if (!action) {
        response.content = '❌ Использование: /me [действие]';
        response.bot = 'rp_helper';
      } else {
        response.content = `* **${user.character}** ${action}`;
        response.bot = 'game_master';
      }
      break;

    case 'time':
      const times = ['🌅 Утро', '☀️ День', '🌇 Вечер', '🌙 Ночь'];
      const randomTime = times[Math.floor(Math.random() * times.length)];
      response.content = `🕒 Сейчас на сервере: ${randomTime}`;
      response.bot = 'game_master';
      break;

    case 'weather':
      const weathers = ['☀️ Солнечно', '🌧️ Дождливо', '🌫️ Туманно', '☁️ Пасмурно', '💨 Ветрено'];
      const randomWeather = weathers[Math.floor(Math.random() * weathers.length)];
      response.content = `🌤️ Погода: ${randomWeather}`;
      response.bot = 'game_master';
      break;

    case 'online':
      const onlineCount = activeUsers.size;
      const usersList = Array.from(activeUsers.values()).map(u => u.character).join(', ');
      response.content = `👥 **Онлайн игроков:** ${onlineCount}\n${usersList}`;
      response.bot = 'rp_helper';
      break;

    default:
      response.content = `❌ Неизвестная команда: **/${cmd}**. Используйте **/help** для списка команд.`;
      response.bot = 'rp_helper';
  }

  sendBotMessage(response.bot, response.content, socket);
}

async function sendBotMessage(botId, content, socket) {
  const bot = systemBots[botId];
  if (!bot) return;

  const botMessage = {
    sender: botId,
    character: bot.character,
    avatar: bot.avatar,
    content: content,
    channel: 'general',
    created_at: new Date().toISOString(),
    is_bot: true
  };

  const { data: savedMessage } = await database.saveMessage(botMessage);
  if (savedMessage) {
    socket.emit('new_message', savedMessage);
  }
}

function updateOnlineUsers() {
  const onlineUsers = Array.from(activeUsers.values());
  io.emit('online_users_update', onlineUsers);
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 LM-Local Messenger Server запущен на порту ${PORT}`);
  console.log(`📡 WebSocket сервер готов к подключениям`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`💾 Режим базы данных: ${supabase ? 'Supabase' : 'In-Memory'}`);
});

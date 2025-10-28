const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
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
app.use(express.static('public'));

// Supabase клиент
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Хранилище активных пользователей
const activeUsers = new Map();
const userSockets = new Map();

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

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'LM-Local Messenger Server is running',
    timestamp: new Date().toISOString()
  });
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Получение истории сообщений
app.get('/api/messages/:channel', async (req, res) => {
  try {
    const { channel } = req.params;
    
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    
    res.json(messages.reverse());
  } catch (error) {
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
  console.log('Новое подключение:', socket.id);

  // Присоединение пользователя к чату
  socket.on('user_join', async (userData) => {
    const user = {
      id: socket.id,
      username: userData.username,
      character: userData.character,
      avatar: userData.avatar || userData.username.charAt(0).toUpperCase(),
      joinedAt: new Date()
    };

    // Сохраняем пользователя
    activeUsers.set(socket.id, user);
    userSockets.set(userData.username, socket.id);

    // Обновляем в Supabase
    await updateUserOnlineStatus(user, true);

    // Уведомляем всех о новом пользователе
    socket.broadcast.emit('user_joined', user);
    
    // Отправляем текущий список онлайн пользователей
    const onlineUsers = Array.from(activeUsers.values());
    io.emit('online_users_update', onlineUsers);

    // Приветственное сообщение от бота
    const welcomeMessage = {
      id: Date.now(),
      sender: 'system',
      character: systemBots.rp_helper.character,
      avatar: systemBots.rp_helper.avatar,
      content: `Добро пожаловать в чат, ${user.character}! Используйте /help для списка команд.`,
      channel: 'general',
      created_at: new Date(),
      is_bot: true
    };

    socket.emit('new_message', welcomeMessage);
    
    console.log(`Пользователь ${user.character} присоединился к чату`);
  });

  // Обработка новых сообщений
  socket.on('send_message', async (messageData) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user) return;

      const message = {
        sender: user.username,
        character: user.character,
        avatar: user.avatar,
        content: messageData.content,
        channel: messageData.channel || 'general',
        created_at: new Date()
      };

      // Сохраняем сообщение в Supabase
      const { data: savedMessage, error } = await supabase
        .from('messages')
        .insert([message])
        .select()
        .single();

      if (error) throw error;

      // Отправляем сообщение всем
      io.emit('new_message', savedMessage);

      // Обработка команд для ботов
      if (messageData.content.startsWith('/')) {
        handleBotCommand(messageData.content, user, socket);
      }

    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
      socket.emit('message_error', { error: 'Не удалось отправить сообщение' });
    }
  });

  // Обработка отключения
  socket.on('disconnect', async () => {
    const user = activeUsers.get(socket.id);
    
    if (user) {
      // Удаляем из активных пользователей
      activeUsers.delete(socket.id);
      userSockets.delete(user.username);

      // Обновляем статус в Supabase
      await updateUserOnlineStatus(user, false);

      // Уведомляем всех о выходе пользователя
      socket.broadcast.emit('user_left', user);

      // Обновляем список онлайн пользователей
      const onlineUsers = Array.from(activeUsers.values());
      io.emit('online_users_update', onlineUsers);

      console.log(`Пользователь ${user.character} покинул чат`);
    }
  });
});

// Обработка команд ботов
function handleBotCommand(command, user, socket) {
  const [cmd, ...args] = command.slice(1).split(' ');
  const response = {};

  switch (cmd.toLowerCase()) {
    case 'help':
      response.content = `
📋 Доступные команды:
/help - Показать это сообщение
/rules - Правила RP сервера
/roll [число] - Бросок кубика (по умолчанию 100)
/me [действие] - Описание действия
/time - Текущее игровое время
/weather - Текущая погода
      `;
      response.bot = 'rp_helper';
      break;

    case 'rules':
      response.content = `
📜 Правила RP сервера:
1. Уважайте других игроков
2. Следуйте лору сервера
3. Не метагеймить
4. Используйте /me для действий
5. Администрация всегда права!
      `;
      response.bot = 'rp_helper';
      break;

    case 'roll':
      const max = parseInt(args[0]) || 100;
      const result = Math.floor(Math.random() * max) + 1;
      response.content = `🎲 ${user.character} бросает кубик D${max}: выпало ${result}!`;
      response.bot = 'game_master';
      break;

    case 'me':
      const action = args.join(' ');
      response.content = `* ${user.character} ${action}`;
      response.bot = 'game_master';
      break;

    case 'time':
      const times = ['Утро', 'День', 'Вечер', 'Ночь'];
      const randomTime = times[Math.floor(Math.random() * times.length)];
      response.content = `🕒 Сейчас на сервере: ${randomTime}`;
      response.bot = 'game_master';
      break;

    case 'weather':
      const weathers = ['Солнечно', 'Дождливо', 'Туманно', 'Пасмурно'];
      const randomWeather = weathers[Math.floor(Math.random() * weathers.length)];
      response.content = `🌤️ Погода: ${randomWeather}`;
      response.bot = 'game_master';
      break;

    default:
      response.content = `Неизвестная команда: /${cmd}. Используйте /help для списка команд.`;
      response.bot = 'rp_helper';
  }

  // Отправляем ответ от бота
  const botMessage = {
    id: Date.now(),
    sender: response.bot,
    character: systemBots[response.bot].character,
    avatar: systemBots[response.bot].avatar,
    content: response.content,
    channel: 'general',
    created_at: new Date(),
    is_bot: true
  };

  socket.emit('new_message', botMessage);
}

// Обновление статуса пользователя в Supabase
async function updateUserOnlineStatus(user, isOnline) {
  try {
    const { error } = await supabase
      .from('users')
      .upsert({
        username: user.username,
        character: user.character,
        avatar: user.avatar,
        is_online: isOnline,
        last_seen: new Date()
      });

    if (error) throw error;
  } catch (error) {
    console.error('Ошибка обновления статуса пользователя:', error);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 LM-Local Messenger Server запущен на порту ${PORT}`);
});

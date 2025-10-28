const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

// Supabase клиент
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Discord Webhook (опционально)
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Военные звания
const militaryRanks = [
  'Рядовой', 'Ефрейтор', 'Младший сержант', 'Сержант', 'Старший сержант',
  'Прапорщик', 'Старший прапорщик', 'Младший лейтенант', 'Лейтенант', 'Старший лейтенант',
  'Капитан', 'Майор', 'Подполковник', 'Полковник', 'Генерал'
];

// Военные подразделения
const militaryUnits = [
  { id: 'command', name: 'Командование', code: 'CMD', description: 'Центр управления операциями' },
  { id: 'assault', name: 'Штурмовой отряд', code: 'ASLT', description: 'Штурмовые операции' },
  { id: 'recon', name: 'Разведка', code: 'RECON', description: 'Разведывательные операции' },
  { id: 'support', name: 'Поддержка', code: 'SUPP', description: 'Огневая поддержка' },
  { id: 'medical', name: 'Медики', code: 'MED', description: 'Медицинская служба' }
];

// Инициализация базы данных
async function initializeDatabase() {
  try {
    // Создаем таблицу пользователей
    const { error: usersError } = await supabase
      .from('users')
      .select('*')
      .limit(1);

    if (usersError && usersError.message.includes('does not exist')) {
      console.log('⚠️ Создайте таблицы в Supabase используя SQL из README');
    } else {
      console.log('✅ Supabase подключен успешно');
    }
  } catch (error) {
    console.error('❌ Ошибка инициализации базы данных:', error.message);
  }
}

// Функция отправки в Discord
async function sendToDiscord(message) {
  if (!DISCORD_WEBHOOK_URL) return;
  
  try {
    const axios = require('axios');
    await axios.post(DISCORD_WEBHOOK_URL, {
      content: `🎖️ **${message.rank} ${message.character_name}**: ${message.content}`
    });
  } catch (error) {
    console.error('❌ Ошибка отправки в Discord:', error.message);
  }
}

// API Routes
app.get('/api/health', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('count').limit(1);
    
    res.json({ 
      status: 'OK', 
      message: 'LM Military Messenger с Supabase',
      database: error ? 'Connection Error' : 'Supabase Connected',
      usersOnline: activeUsers.size,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Регистрация пользователя
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, character_name, rank, unit } = req.body;

    if (!username || !password || !character_name) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }

    // Проверяем, существует ли пользователь
    const { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
    }

    // Создаем пользователя
    const { data: user, error } = await supabase
      .from('users')
      .insert([
        {
          username,
          password, // В реальном приложении нужно хэшировать пароль!
          character_name,
          rank: rank || 'Рядовой',
          unit: unit || 'command',
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) throw error;

    res.json({ 
      success: true, 
      message: 'Регистрация успешна',
      user: { id: user.id, username: user.username, character_name: user.character_name, rank: user.rank }
    });

  } catch (error) {
    console.error('❌ Ошибка регистрации:', error);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

// Авторизация пользователя
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Введите имя пользователя и пароль' });
    }

    // Ищем пользователя
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
    }

    res.json({ 
      success: true, 
      message: 'Авторизация успешна',
      user: { 
        id: user.id, 
        username: user.username, 
        character_name: user.character_name, 
        rank: user.rank,
        unit: user.unit
      }
    });

  } catch (error) {
    console.error('❌ Ошибка авторизации:', error);
    res.status(500).json({ error: 'Ошибка авторизации' });
  }
});

// Получение сообщений
app.get('/api/messages/:channel', async (req, res) => {
  try {
    const { channel } = req.params;

    const { data: messages, error } = await supabase
      .from('messages')
      .select(`
        *,
        user:users (character_name, rank, unit)
      `)
      .eq('channel', channel)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) throw error;

    // Форматируем сообщения
    const formattedMessages = messages.map(msg => ({
      id: msg.id,
      character_name: msg.user.character_name,
      rank: msg.user.rank,
      content: msg.content,
      channel: msg.channel,
      is_system: msg.is_system,
      is_encrypted: msg.is_encrypted,
      created_at: msg.created_at
    }));

    res.json(formattedMessages);

  } catch (error) {
    console.error('❌ Ошибка загрузки сообщений:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получение онлайн пользователей
app.get('/api/online-users', (req, res) => {
  const onlineUsers = Array.from(activeUsers.values());
  res.json(onlineUsers);
});

// Получение военных подразделений
app.get('/api/military-units', (req, res) => {
  res.json(militaryUnits);
});

// Получение военных званий
app.get('/api/military-ranks', (req, res) => {
  res.json(militaryRanks);
});

// Хранилище активных пользователей
const activeUsers = new Map();

// Socket.io
io.on('connection', (socket) => {
  console.log('🎖️ Новое военное подключение:', socket.id);

  socket.on('military_join', async (userData) => {
    try {
      const user = {
        id: socket.id,
        user_id: userData.id,
        username: userData.username,
        character_name: userData.character_name,
        rank: userData.rank,
        unit: userData.unit,
        status: 'online',
        joinedAt: new Date()
      };

      activeUsers.set(socket.id, user);

      // Системное сообщение о подключении
      const systemMessage = {
        character_name: 'СИСТЕМА',
        rank: 'КОМАНДОВАНИЕ',
        content: `🎖️ ${user.rank} ${user.character_name} присоединился к сети`,
        channel: 'command',
        is_system: true,
        created_at: new Date().toISOString()
      };

      // Сохраняем системное сообщение в базу
      const { error } = await supabase
        .from('messages')
        .insert([
          {
            user_id: user.user_id,
            channel: 'command',
            content: systemMessage.content,
            is_system: true,
            created_at: new Date().toISOString()
          }
        ]);

      if (!error) {
        socket.broadcast.emit('new_message', systemMessage);
      }

      io.emit('online_users_update', Array.from(activeUsers.values()));

      // Отправляем в Discord если настроен webhook
      await sendToDiscord({
        character_name: user.character_name,
        rank: user.rank,
        content: `присоединился к военной сети`
      });

      console.log(`✅ ${user.rank} ${user.character_name} присоединился к чату`);

    } catch (error) {
      console.error('❌ Ошибка подключения пользователя:', error);
      socket.emit('join_error', { error: 'Ошибка подключения к чату' });
    }
  });

  socket.on('send_military_message', async (messageData) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user) return;

      const message = {
        user_id: user.user_id,
        channel: messageData.channel || 'command',
        content: messageData.content,
        is_encrypted: messageData.encrypted || false,
        is_system: false,
        created_at: new Date().toISOString()
      };

      // Сохраняем сообщение в базу
      const { data: savedMessage, error } = await supabase
        .from('messages')
        .insert([message])
        .select(`
          *,
          user:users (character_name, rank, unit)
        `)
        .single();

      if (error) throw error;

      // Форматируем сообщение для клиента
      const clientMessage = {
        id: savedMessage.id,
        character_name: savedMessage.user.character_name,
        rank: savedMessage.user.rank,
        content: savedMessage.content,
        channel: savedMessage.channel,
        is_encrypted: savedMessage.is_encrypted,
        is_system: savedMessage.is_system,
        created_at: savedMessage.created_at
      };

      // Отправляем всем в мессенджере
      io.emit('new_message', clientMessage);

      // Отправляем в Discord (только незашифрованные сообщения)
      if (!messageData.encrypted && DISCORD_WEBHOOK_URL) {
        await sendToDiscord({
          character_name: user.character_name,
          rank: user.rank,
          content: messageData.content
        });
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

      // Системное сообщение о выходе
      const systemMessage = {
        character_name: 'СИСТЕМА',
        rank: 'КОМАНДОВАНИЕ',
        content: `⚠️ ${user.rank} ${user.character_name} покинул сеть`,
        channel: 'command',
        is_system: true,
        created_at: new Date().toISOString()
      };

      // Сохраняем системное сообщение в базу
      await supabase
        .from('messages')
        .insert([
          {
            user_id: user.user_id,
            channel: 'command',
            content: systemMessage.content,
            is_system: true,
            created_at: new Date().toISOString()
          }
        ]);

      socket.broadcast.emit('new_message', systemMessage);
      io.emit('online_users_update', Array.from(activeUsers.values()));

      // Уведомление в Discord
      await sendToDiscord({
        character_name: user.character_name,
        rank: user.rank,
        content: `покинул военную сеть`
      });

      console.log(`👋 ${user.rank} ${user.character_name} покинул чат`);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🎖️ Военный мессенджер запущен на порту ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`💾 База данных: Supabase`);
  initializeDatabase();
});

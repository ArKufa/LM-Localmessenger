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
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище в памяти
const activeUsers = new Map();
const messages = {
  'command': [],
  'assault': [],
  'recon': [],
  'support': [], 
  'medical': []
};

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

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'LM Military Messenger',
    database: 'In-Memory',
    usersOnline: activeUsers.size,
    timestamp: new Date().toISOString()
  });
});

// Получение сообщений
app.get('/api/messages/:channel', (req, res) => {
  const { channel } = req.params;
  res.json(messages[channel] || []);
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

// Socket.io
io.on('connection', (socket) => {
  console.log('🎖️ Новое военное подключение:', socket.id);

  socket.on('military_join', (userData) => {
    try {
      const user = {
        id: socket.id,
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
        id: Date.now(),
        character_name: 'СИСТЕМА',
        rank: 'КОМАНДОВАНИЕ',
        content: `🎖️ ${user.rank} ${user.character_name} присоединился к сети`,
        channel: 'command',
        is_system: true,
        created_at: new Date().toISOString()
      };

      // Сохраняем системное сообщение
      if (!messages.command) messages.command = [];
      messages.command.push(systemMessage);

      // Отправляем всем
      socket.broadcast.emit('new_message', systemMessage);
      io.emit('online_users_update', Array.from(activeUsers.values()));

      console.log(`✅ ${user.rank} ${user.character_name} присоединился к чату`);

    } catch (error) {
      console.error('❌ Ошибка подключения пользователя:', error);
      socket.emit('join_error', { error: 'Ошибка подключения к чату' });
    }
  });

  socket.on('send_military_message', (messageData) => {
    try {
      const user = activeUsers.get(socket.id);
      if (!user) return;

      const message = {
        id: Date.now(),
        character_name: user.character_name,
        rank: user.rank,
        content: messageData.content,
        channel: messageData.channel || 'command',
        is_encrypted: messageData.encrypted || false,
        is_system: false,
        created_at: new Date().toISOString()
      };

      // Сохраняем сообщение
      const channel = messageData.channel || 'command';
      if (!messages[channel]) messages[channel] = [];
      messages[channel].push(message);

      // Ограничиваем историю сообщений
      if (messages[channel].length > 100) {
        messages[channel] = messages[channel].slice(-50);
      }

      // Отправляем всем в мессенджере
      io.emit('new_message', message);

    } catch (error) {
      console.error('❌ Ошибка отправки сообщения:', error);
      socket.emit('message_error', { error: 'Не удалось отправить сообщение' });
    }
  });

  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      activeUsers.delete(socket.id);

      // Системное сообщение о выходе
      const systemMessage = {
        id: Date.now(),
        character_name: 'СИСТЕМА',
        rank: 'КОМАНДОВАНИЕ',
        content: `⚠️ ${user.rank} ${user.character_name} покинул сеть`,
        channel: 'command',
        is_system: true,
        created_at: new Date().toISOString()
      };

      if (!messages.command) messages.command = [];
      messages.command.push(systemMessage);

      socket.broadcast.emit('new_message', systemMessage);
      io.emit('online_users_update', Array.from(activeUsers.values()));

      console.log(`👋 ${user.rank} ${user.character_name} покинул чат`);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🎖️ Военный мессенджер запущен на порту ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`💾 База данных: In-Memory`);
  console.log(`🔐 Регистрация: Отключена`);
});

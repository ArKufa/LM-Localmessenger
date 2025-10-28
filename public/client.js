// client.js - Клиентская логика LM-Local Messenger

// Подключение к WebSocket серверу
const socket = io();

// Состояние приложения
let currentUser = null;
let currentChannel = 'general';
let onlineUsers = [];

// Элементы DOM
const loginScreen = document.getElementById('loginScreen');
const app = document.getElementById('app');
const loginButton = document.getElementById('loginButton');
const loginError = document.getElementById('loginError');
const usernameInput = document.getElementById('username');
const characterInput = document.getElementById('character');
const currentUserElement = document.getElementById('currentUser');
const userAvatar = document.getElementById('userAvatar');
const channelList = document.getElementById('channelList');
const currentChannelElement = document.getElementById('currentChannel');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const userList = document.getElementById('userList');
const onlineCount = document.getElementById('onlineCount');

// Функция входа в систему
loginButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const character = characterInput.value.trim();

    if (!username || !character) {
        loginError.textContent = 'Пожалуйста, заполните все поля';
        return;
    }

    if (username.length < 2 || character.length < 2) {
        loginError.textContent = 'Имя и персонаж должны быть не менее 2 символов';
        return;
    }

    // Сохраняем информацию о пользователе
    currentUser = {
        username,
        character,
        avatar: username.charAt(0).toUpperCase()
    };

    // Обновляем интерфейс
    currentUserElement.textContent = `${character} (${username})`;
    userAvatar.textContent = currentUser.avatar;

    // Переключаем экраны
    loginScreen.style.display = 'none';
    app.style.display = 'block';

    // Подключаемся к серверу через WebSocket
    socket.emit('user_join', currentUser);
    
    // Загружаем историю сообщений
    loadMessages();
});

// Обработка новых сообщений от сервера
socket.on('new_message', (message) => {
    addMessageToUI(message);
    scrollToBottom();
});

// Обновление списка онлайн пользователей
socket.on('online_users_update', (users) => {
    onlineUsers = users;
    updateOnlineUsersUI();
});

// Пользователь присоединился
socket.on('user_joined', (user) => {
    addSystemMessage(`${user.character} присоединился к чату`);
});

// Пользователь вышел
socket.on('user_left', (user) => {
    addSystemMessage(`${user.character} покинул чат`);
});

// Ошибка соединения
socket.on('connect_error', (error) => {
    console.error('Ошибка подключения:', error);
    loginError.textContent = 'Ошибка подключения к серверу';
});

// Успешное подключение
socket.on('connect', () => {
    console.log('✅ Подключено к серверу');
    loginError.textContent = '';
    
    // Загружаем онлайн пользователей
    fetch('/api/online-users')
        .then(response => response.json())
        .then(users => {
            onlineUsers = users;
            updateOnlineUsersUI();
        })
        .catch(error => {
            console.error('Ошибка загрузки онлайн пользователей:', error);
        });
});

// Обработка отправки сообщений
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const content = messageInput.value.trim();
    
    if (!content) return;
    
    // Отправляем сообщение через WebSocket
    socket.emit('send_message', {
        content: content,
        channel: currentChannel
    });
    
    // Очищаем поле ввода
    messageInput.value = '';
}

// Смена канала
channelList.addEventListener('click', (e) => {
    if (e.target.classList.contains('channel-item')) {
        // Убираем активный класс у всех каналов
        document.querySelectorAll('.channel-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Добавляем активный класс выбранному каналу
        e.target.classList.add('active');
        
        // Меняем канал
        const newChannel = e.target.dataset.channel;
        switchChannel(newChannel);
    }
});

// Функция переключения канала
async function switchChannel(channel) {
    currentChannel = channel;
    currentChannelElement.textContent = getChannelName(channel);
    
    // Очищаем сообщения
    messagesContainer.innerHTML = '';
    
    // Загружаем сообщения для нового канала
    await loadMessages();
}

// Функция получения имени канала
function getChannelName(channel) {
    const channelNames = {
        'general': 'Общий чат',
        'ooc': 'OOC чат',
        'faction': 'Фракции',
        'trade': 'Торговля',
        'events': 'События'
    };
    
    return channelNames[channel] || channel;
}

// Функция загрузки сообщений
async function loadMessages() {
    try {
        const response = await fetch(`/api/messages/${currentChannel}`);
        if (!response.ok) throw new Error('Network response was not ok');
        
        const messages = await response.json();
        
        // Очищаем контейнер сообщений
        messagesContainer.innerHTML = '';

        // Добавляем сообщения в интерфейс
        messages.forEach(message => {
            addMessageToUI(message);
        });

        // Прокручиваем вниз
        scrollToBottom();
    } catch (error) {
        console.error('Ошибка загрузки сообщений:', error);
        addSystemMessage('Не удалось загрузить историю сообщений');
    }
}

// Функция добавления сообщения в UI
function addMessageToUI(message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    
    if (message.is_bot) {
        messageElement.classList.add('bot');
    } else if (message.sender === currentUser?.username) {
        messageElement.classList.add('own');
    } else {
        messageElement.classList.add('other');
    }
    
    const messageTime = new Date(message.created_at).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    messageElement.innerHTML = `
        <div class="message-header">
            <span class="message-sender">${message.character}</span>
            <span class="message-time">${messageTime}</span>
        </div>
        <div class="message-content">${message.content}</div>
    `;
    
    messagesContainer.appendChild(messageElement);
}

// Функция добавления системного сообщения
function addSystemMessage(content) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('system-notification');
    messageElement.textContent = content;
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
}

// Функция обновления UI списка онлайн пользователей
function updateOnlineUsersUI() {
    userList.innerHTML = '';
    onlineCount.textContent = onlineUsers.length;
    
    onlineUsers.forEach(user => {
        const userElement = document.createElement('li');
        userElement.classList.add('user-item');
        
        userElement.innerHTML = `
            <div class="status-indicator"></div>
            <div class="user-avatar">${user.avatar}</div>
            <div class="user-info">
                <div class="user-name">${user.character}</div>
                <div class="user-username">${user.username}</div>
            </div>
        `;
        
        userList.appendChild(userElement);
    });
}

// Функция прокрутки вниз
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Автофокус на поле ввода после загрузки
document.addEventListener('DOMContentLoaded', function() {
    if (messageInput) {
        messageInput.focus();
    }
});

// Обработка ошибок сообщений
socket.on('message_error', (data) => {
    addSystemMessage(`Ошибка: ${data.error}`);
});

// Обработка ошибок входа
socket.on('join_error', (data) => {
    loginError.textContent = data.error;
});

// Пинг для поддержания соединения
setInterval(() => {
    if (socket.connected) {
        socket.emit('ping');
    }
}, 30000);

socket.on('pong', (data) => {
    console.log('Pong received:', data.timestamp);
});

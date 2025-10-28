// Подключение к WebSocket серверу
const socket = io('http://localhost:3000'); // Замените на ваш URL сервера

// Функция входа в систему (обновленная)
loginButton.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const character = characterInput.value.trim();

    if (!username || !character) {
        loginError.textContent = 'Пожалуйста, заполните все поля';
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
    await loadMessages();
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

// Обработка отправки сообщений (обновленная)
async function sendMessage() {
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

// Обработка приватных сообщений
socket.on('private_message_received', (message) => {
    // Показываем уведомление о приватном сообщении
    showPrivateMessageNotification(message);
});

function showPrivateMessageNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(76, 175, 80, 0.9);
        color: white;
        padding: 15px;
        border-radius: 5px;
        z-index: 1000;
        max-width: 300px;
    `;
    notification.innerHTML = `
        <strong>Приватное сообщение от ${message.from_character}</strong>
        <p>${message.content}</p>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

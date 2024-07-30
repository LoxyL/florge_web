const apiKey = 'YOUR_OPENAI_API_KEY'; // Replace with your actual API key

async function sendMessage() {
    const userInput = document.getElementById('user-input').value;
    const maxTokens = document.getElementById('max-tokens').value;

    if (userInput.trim() === '') return;

    addMessage('user', userInput);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: userInput }],
            max_tokens: parseInt(maxTokens)
        })
    });

    const data = await response.json();
    const botResponse = data.choices[0].message.content.trim();

    addMessage('bot', botResponse);

    document.getElementById('user-input').value = '';
}

function addMessage(sender, message) {
    const chatMessages = document.getElementById('chat-messages');
    const messageElement = document.createElement('div');
    messageElement.classList.add(sender);
    messageElement.textContent = message;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.style.display === 'none') {
        sidebar.style.display = 'block';
    } else {
        sidebar.style.display = 'none';
    }
}
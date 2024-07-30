
const textarea = document.getElementById('message-send-GPT');


textarea.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

textarea.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        send();
    }
});
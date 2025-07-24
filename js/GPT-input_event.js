
const textarea = document.getElementById('message-send-GPT');


textarea.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

textarea.addEventListener('keydown', function(event) {
    if (event.isComposing) {
        return;
    }
    if (event.key === 'Enter') {
        if (event.ctrlKey || event.shiftKey) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + '\n' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 1;
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        } else {
            event.preventDefault();
            send();
        }
    }
});
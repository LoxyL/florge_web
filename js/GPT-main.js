import {DialogGPT} from './dialogGPT.js';

const dialog = new DialogGPT();

function send() {
    dialog.send();
}

function newChat() {
    dialog.newChat();
}

function switchRecord(id) {
    dialog.switchRecord(id);
}

window.send = send;
window.newChat = newChat;
window.switchRecord = switchRecord;
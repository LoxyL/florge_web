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

function deleteRecord(id) {
    dialog.deleteRecord(id);
}

window.send = send;
window.newChat = newChat;
window.switchRecord = switchRecord;
window.deleteRecord = deleteRecord;
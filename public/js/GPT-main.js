import {DialogGPT} from './dialogGPT.js';

window.isInteracting = false;
const dialog = new DialogGPT();
window.dialog = dialog; // Keep for HTML onclicks
export { dialog }; // Export for other modules

function send() {
    if(isInteracting) return;
    streamStop();
    dialog.send();
}

function newChat() {
    if(isInteracting) return;
    streamStop();
    dialog.newChat();
}

function switchRecord(id) {
    if(isInteracting) return;
    streamStop();
    dialog.switchRecord(id);
}

function deleteRecord(id) {
    if(isInteracting) return;
    streamStop();
    dialog.deleteRecord(id);
}

function streamStop() {
    dialog.streamStop();
}

function regenerateOverview() {
    if(isInteracting) return;
    dialog.regenerateOverview();
}

window.send = send;
window.newChat = newChat;
window.switchRecord = switchRecord;
window.deleteRecord = deleteRecord;
window.streamStop = streamStop;
window.regenerateOverview = regenerateOverview;
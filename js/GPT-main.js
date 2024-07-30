import {DialogGPT} from './dialogGPT.js';

const dialog = new DialogGPT();

function send() {
    dialog.send();
}

window.send = send;
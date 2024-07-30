import {BotGPT} from "./botGPT.js";

export class DialogGPT {
	constructor() {
		this.dialog_num = 0;
		this.bot = new BotGPT();
	}

	_getInputGPT() {
		var inputElement = document.getElementById("message-send-GPT");
		var inputValue = inputElement.value;
		inputElement.value = "";
		
		inputElement.style.height = 'auto';
		inputElement.style.height = (this.scrollHeight) + 'px';

		return inputValue.trim();
	}

	_processTextDisplay(text) {
		const md = new markdownit({
			highlight: function(code, lang) {
				if (lang && hljs.getLanguage(lang)) {
					return hljs.highlight(code, { language: lang }).value;
				}
				return hljs.highlightAuto(code).value;
			}
		});

		var html = md.render(text);
		return html;
	}

	_send_message(inputValue) {
		var userSet = document.createElement("div");
		userSet.setAttribute("id", 'chat-container-GPT-messages-user-'+this.dialog_num);
		userSet.setAttribute("class", "chat-container-GPT-messages-user");

		var userIcon = document.createElement("div");
		userIcon.setAttribute("class", "chat-container-GPT-messages-user-icon");
		userIcon.innerHTML = "U";

		var userBubble = document.createElement("div");
		userBubble.setAttribute("class", "chat-container-GPT-messages-user-bubble");
		userBubble.innerHTML = this._processTextDisplay(inputValue);

		userSet.appendChild(userIcon);
		userSet.appendChild(userBubble);
		
		var chatContainer = document.getElementById("chat-container-GPT-messages");
		chatContainer.appendChild(userSet);
	}

	_receive_message(inputValue) {
		var contentIter = this.bot.interact(inputValue);
		for (piece in contentIter) {
			console.log(piece);
		}
	}

	send() {
		var inputValue = getInputGPT();
		if(inputValue !== ""){
			this._send_message(inputValue);
			this._receive_message(inputValue);
		} 
	}
}
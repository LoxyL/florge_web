import {BotGPT, AgentGPT} from "./botGPT.js";

export class DialogGPT {
	constructor() {
		this.dialog_num = 0;
		this.bot = new BotGPT();
		this.agent = new AgentGPT();
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

	async _receive_message(inputValue) {
		var contentIter = this.bot.interact(inputValue);
		var receive_content = "";
		
		var chatContainer = document.getElementById("chat-container-GPT-messages");

		var botSet = document.createElement("div");
		botSet.setAttribute("id", 'chat-container-GPT-messages-bot-'+this.dialog_num);
		botSet.setAttribute("class", "chat-container-GPT-messages-bot");

		var botIcon = document.createElement("div");
		botIcon.setAttribute("class", "chat-container-GPT-messages-bot-icon");
		botIcon.innerHTML = "B";

		var botBubble = document.createElement("div");
		botBubble.setAttribute("class", "chat-container-GPT-messages-bot-bubble");
		botBubble.innerHTML = this._processTextDisplay("...");

		botSet.appendChild(botIcon);
		botSet.appendChild(botBubble);
		chatContainer.appendChild(botSet);

		for await (const piece of contentIter) {
			if (piece == undefined) continue;
			receive_content += piece;
			botBubble.innerHTML = this._processTextDisplay(receive_content);
		}
		console.log("[INFO]Done receive content.");
	}

	async send() {
		var inputValue = this._getInputGPT();
		if(inputValue !== ""){
			console.log("[INFO]Send content: ", inputValue);
			this._send_message(inputValue);
			this._receive_message(inputValue);
			this.dialog_num += 1;
		} 
	}
}
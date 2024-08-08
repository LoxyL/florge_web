import {BotGPT, AgentGPT} from "./botGPT.js";

export class DialogGPT {
	constructor() {
		this.dialog_num = 0;
		this.bot = new BotGPT();
		this.agent = new AgentGPT();
		this.current_record_id = 0;
		this._loadRecordList();
		this.useAgent = true;
	}

	_getInputGPT() {
		let inputElement = document.getElementById("message-send-GPT");
		let inputValue = inputElement.value;
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

		let html = md.render(text);
		return html;
	}

	_clear() {
		this.dialog_num = 0;
		const container = document.getElementById('chat-container-GPT-messages');
		container.innerHTML = '';
		this.bot = new BotGPT();
	}

	_codeInteract() {
		const menu = document.getElementById('code-interact');

		const codeBlocks = document.querySelectorAll('.chat-container-GPT-messages-bot-bubble pre');
		let currentCodeBlock;
		
		codeBlocks.forEach(block => {
			block.addEventListener('contextmenu', function(event) {
				event.preventDefault();
				const nameContainer = menu.firstElementChild;
				let name = block.firstChild.className.replace('language-', '');
				// console.log(nameContainer.innerHTML);
				nameContainer.innerHTML = name;
				menu.style.display = 'flex';
				menu.style.opacity = '1';
				menu.style.visibility = 'visible';
				menu.style.left = `${event.pageX}px`;
				menu.style.top = `${event.pageY}px`;
				currentCodeBlock = block;
			});
		});

		document.getElementById('code-copy').addEventListener('click', function() {
			const code = currentCodeBlock.innerText;
			navigator.clipboard.writeText(code)
				.catch(err => {
					console.error('Copy failed:', err);
				});
			menu.style.display = 'none';
		});

		window.addEventListener('click', function() {
			menu.style.opacity = '0';
			menu.style.visibility = 'hidden';
		});
	}

	_send_message(inputValue) {
		const userSet = document.createElement("div");
		userSet.setAttribute("id", 'chat-container-GPT-messages-user-'+this.dialog_num);
		userSet.setAttribute("class", "chat-container-GPT-messages-user");

		const userIcon = document.createElement("div");
		userIcon.setAttribute("class", "chat-container-GPT-messages-user-icon");
		userIcon.innerHTML = "U";

		const userBubble = document.createElement("div");
		userBubble.setAttribute("class", "chat-container-GPT-messages-user-bubble");
		userBubble.innerHTML = this._processTextDisplay(inputValue);

		userSet.appendChild(userIcon);
		userSet.appendChild(userBubble);
		
		const chatContainer = document.getElementById("chat-container-GPT-messages");
		chatContainer.appendChild(userSet);

		chatContainer.scrollTop = chatContainer.scrollHeight;
	}

	async _receive_message(inputValue) {
		let contentIter = this.bot.interact(inputValue);
		let receive_content = "";
		
		const chatContainer = document.getElementById("chat-container-GPT-messages");

		const botSet = document.createElement("div");
		botSet.setAttribute("id", 'chat-container-GPT-messages-bot-'+this.dialog_num);
		botSet.setAttribute("class", "chat-container-GPT-messages-bot");

		const botIcon = document.createElement("div");
		botIcon.setAttribute("class", "chat-container-GPT-messages-bot-icon");
		botIcon.innerHTML = "B";

		const botBubble = document.createElement("div");
		botBubble.setAttribute("class", "chat-container-GPT-messages-bot-bubble");
		botBubble.innerHTML = this._processTextDisplay("...");

		botSet.appendChild(botIcon);
		botSet.appendChild(botBubble);
		chatContainer.appendChild(botSet);
		chatContainer.scrollTop = chatContainer.scrollHeight;

		for await (const piece of contentIter) {
			if (piece == undefined) continue;
			receive_content += piece;
			botBubble.innerHTML = this._processTextDisplay(receive_content);
			renderMathInElement(botSet, {
				delimiters: [
					{left: "$$", right: "$$", display: true},
					{left: "$", right: "$", display: false}
				]
			});

			chatContainer.scrollTop = chatContainer.scrollHeight;
		}

		this._codeInteract();
		console.log("[INFO]Done receive content.");
	}

	streamStop() {
		this.bot.streamAbort();
	}

	_switchToStopButton() {
		document.getElementById("send-button").style.display = 'none';
		document.getElementById("stop-button").style.display = 'block';
	}

	_switchToSendButton() {
		document.getElementById("send-button").style.display = 'block';
		document.getElementById("stop-button").style.display = 'none';
	}

	async send() {
		let inputValue = this._getInputGPT();
		if(inputValue !== ""){
			window.isInteracting = true;
			this._switchToStopButton();
			console.log("[INFO]Send content: ", inputValue);
			this._send_message(inputValue);
			this.dialog_num += 1;
			await this._receive_message(inputValue);
			this.dialog_num += 1;
			await this._saveRecordContent();
			await this._nameRecord();
			this._switchToSendButton();
			window.isInteracting = false;
		} 
	}

	async _getRecordData() {
		try {
			const response = await fetch('http://localhost:30962/gpt/record');
			const data = await response.json();
			return data;
		} catch (error) {
			console.log('[INFO]Error reading record:', error);
			return undefined;
		}
	}

	async _saveRecordData(data) {
		try {
			fetch('http://localhost:30962/gpt/record', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(data)
			});
		} catch (error) {
			console.error('Error:', error);
		}
	}

	async _loadRecordList() {
		const recordList = await this._getRecordData();
		if(!recordList || recordList.recordIds.length == 0){
			const newRecordList = {
				recordIds: [0],
				recordTitles: ['New Chat'],
				recordContents: [[]]
			};
			await this._saveRecordData(newRecordList);
			this._loadRecordList();
			return;
		}
		this.current_record_id = recordList.recordIds[0];

		const recordContainer = document.getElementById('record-container-GPT');
		recordContainer.innerHTML = '';
		for(let i=0; i<recordList.recordIds.length; i++){
			let newRecord = document.createElement('button');
			newRecord.setAttribute('id', `record-GPT-${recordList.recordIds[i]}`);
			newRecord.setAttribute('class', 'record-option');
			newRecord.setAttribute('onclick', `switchRecord(${recordList.recordIds[i]})`)
			newRecord.innerHTML = `<div>${recordList.recordTitles[i]}</div>`;
			
			let deleteButton = document.createElement('button');
			deleteButton.setAttribute('class', 'record-option-delete');
			deleteButton.setAttribute('onclick', `deleteRecord(${recordList.recordIds[i]})`)
			deleteButton.innerHTML = '&times';

			newRecord.appendChild(deleteButton);
			recordContainer.appendChild(newRecord);
		}

		this.switchRecord(this.current_record_id);
	}

	async _saveRecordContent() {
		let context = JSON.parse(JSON.stringify(this.bot.body.messages));
		context.shift();
		const recordList = await this._getRecordData();;
		let index = recordList.recordIds.indexOf(this.current_record_id);
		recordList.recordContents[index] = context;
		await this._saveRecordData(recordList);
	}
	
	async newChat() {
		this._clear();
		const recordList = await this._getRecordData();
		console.log('Done');
		this.current_record_id += 1;
		recordList.recordIds.unshift(this.current_record_id);
		recordList.recordTitles.unshift('New Chat');
		recordList.recordContents.unshift([]);
		await this._saveRecordData(recordList);
		await this._saveRecordContent();
		await this._loadRecordList();
		this._loadRecordContent();
	}

	async deleteRecord(id) {
		const recordList = await this._getRecordData();
		let index = recordList.recordIds.indexOf(id);
		recordList.recordIds.splice(index, 1);
		recordList.recordTitles.splice(index, 1);
		recordList.recordContents.splice(index, 1);
		await this._saveRecordData(recordList);
		this._loadRecordList();
	}

	async switchRecord(id){
		try {
			this.current_record_id = id;
			this._loadRecordContent();

			const options = document.getElementsByClassName('record-option');
			for(let i=0; i<options.length; i++){
				options[i].className = options[i].className.replace(' active', '');
			}

			const option = document.getElementById(`record-GPT-${id}`);
			option.className += ' active';
		} catch (error) {
			this._loadRecordList();
		}
	}
	
	async _loadRecordContent() {
		this._clear();
		const recordList = await this._getRecordData();
		let index = recordList.recordIds.indexOf(this.current_record_id);
		let recordContents = recordList.recordContents[index];
		for(let i=0; i<recordContents.length; i++){
			this.bot.body.messages.push(recordContents[i]);
		}
		
		for(let i in recordContents){
			const piece = recordContents[i];
			const chatContainer = document.getElementById("chat-container-GPT-messages");
			if(piece.role == 'user'){
				const userSet = document.createElement("div");
				userSet.setAttribute("id", 'chat-container-GPT-messages-user-'+this.dialog_num);
				userSet.setAttribute("class", "chat-container-GPT-messages-user");
		
				const userIcon = document.createElement("div");
				userIcon.setAttribute("class", "chat-container-GPT-messages-user-icon");
				userIcon.innerHTML = "U";
		
				const userBubble = document.createElement("div");
				userBubble.setAttribute("class", "chat-container-GPT-messages-user-bubble");
				userBubble.innerHTML = this._processTextDisplay(piece.content);
		
				userSet.appendChild(userIcon);
				userSet.appendChild(userBubble);
				
				chatContainer.appendChild(userSet);
			}
			if(piece.role == 'assistant'){
				const botSet = document.createElement("div");
				botSet.setAttribute("id", 'chat-container-GPT-messages-bot-'+this.dialog_num);
				botSet.setAttribute("class", "chat-container-GPT-messages-bot");
		
				const botIcon = document.createElement("div");
				botIcon.setAttribute("class", "chat-container-GPT-messages-bot-icon");
				botIcon.innerHTML = "B";
		
				const botBubble = document.createElement("div");
				botBubble.setAttribute("class", "chat-container-GPT-messages-bot-bubble");
				botBubble.innerHTML = this._processTextDisplay(piece.content);
		
				botSet.appendChild(botIcon);
				botSet.appendChild(botBubble);
				chatContainer.appendChild(botSet);
				
				renderMathInElement(botSet, {
					delimiters: [
						{left: "$$", right: "$$", display: true},
						{left: "$", right: "$", display: false}
					]
				});
			}

			chatContainer.scrollTop = chatContainer.scrollHeight;
			this.dialog_num += 1;
		}

		this._codeInteract();
	}

	async _nameRecord() {
		if(this.useAgent){
			const systemPrompt = "Provide an appropriate title based on the user\'s JSON-formatted conversation records. The title should not exceed 20 words and should be returned directly. Return the content in the primary language of the conversation.";

			const recordList = await this._getRecordData();
			const index = recordList.recordIds.indexOf(this.current_record_id);
			const recordContents = recordList.recordContents[index];

			const record = document.getElementById(`record-GPT-${this.current_record_id}`);
			const recordTitle = record.children[0];

			if(recordTitle.innerHTML !== "New Chat") return;

			let title = '';
			const contentIter = this.agent.interact(systemPrompt, JSON.stringify(recordContents));
			
			for await (const piece of contentIter) {
				if (piece == undefined) continue;
				title += piece;
				recordTitle.innerHTML = title;
			}

			recordList.recordTitles[index] = title;
			await this._saveRecordData(recordList);
		}
	}
}
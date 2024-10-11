import {BotGPT, AgentGPT} from "./botGPT.js";

export class DialogGPT {
	constructor() {
		this.useGlobalSystemPrompt = false;
		this.dialog_num = 0;
		this.bot = new BotGPT();
		this.dialog_num++;
		this.agent = new AgentGPT();
		this.current_record_id = 0;
		this.useAgent = true;
		this.ctrlPressed = false;
		this._switchInteract();
		this._windowInteract();
		this._loadRecordList();
	}

	_windowInteract() {
		window.addEventListener('keydown', event => {
			if(event.ctrlKey) this.ctrlPressed = true;
		})

		window.addEventListener('keyup', event => {
			if(event.key === 'Control') this.ctrlPressed = false;
		})
	}

	_switchInteract() {
		const globalSystemPromptSwitch = document.getElementById("config-use-global-system-prompt");

		globalSystemPromptSwitch.addEventListener("change", () => {
            if (globalSystemPromptSwitch.checked) {
				const globalSystemSet = document.getElementById("chat-container-GPT-messages-global-system");

				this.useGlobalSystemPrompt = true;
				this.bot.useSystemPrompt = true;
				globalSystemSet.style.display = 'flex';
                console.log('[INFO][CONFIG]Enable global system prompt.');
            } else {
				const globalSystemSet = document.getElementById("chat-container-GPT-messages-global-system");

				this.useGlobalSystemPrompt = false;
				this.bot.useSystemPrompt = false;
				globalSystemSet.style.display = 'none';
                console.log('[INFO][CONFIG]Disable global system prompt.');
            }
		})

		if(globalSystemPromptSwitch.checked) {
			this.useGlobalSystemPrompt = true;
			this.bot.useSystemPrompt = true;
		}
	}

	_getInputGPT() {
		let inputElement = document.getElementById("message-send-GPT");
		let inputValue = inputElement.value;
		inputElement.value = "";
		
		inputElement.style.height = 'auto';
		inputElement.style.height = (this.scrollHeight) + 'px';

		return inputValue.trim();
	}

	_processRawDisplay(text) {
		return text
			.replace(/&/g, "&amp;") 
			.replace(/</g, "&lt;")  
			.replace(/>/g, "&gt;")  
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
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

		const replaceOutsideCode = (text) => {
			// 将文本按反引号分割
			return text.split('`').map((part, index) => {
				// 处理非代码部分（即索引为偶数的部分）
				if (index % 2 === 0) {
					return part.replace(/\\/g, '\\\\'); // 将反斜杠替换为双反斜杠
				}
				return part; // 代码部分保持不变
			}).join('`'); // 将所有部分重新连接
		};

		let html = md.render(replaceOutsideCode(text));
		return html;
	}

	_clear() {
		this.dialog_num = 0;
		const container = document.getElementById('chat-container-GPT-messages');
		container.innerHTML = '';
		this.bot = new BotGPT();
		this.dialog_num++;
	}

	_switchMessage(bubble) {
		if(bubble.classList.contains('raw')){
			bubble.classList.remove('raw');
		} else {
			bubble.classList.add('raw');
		}
	}

	async _deleteMessage(id) {
		console.log(`[INFO][BUBBLE]Delete bubble ${id}`);

		this.bot.deleteMessage(id);
		await this._saveRecordContent();
		this._loadRecordContent();
	}

	_botBubbleInteract(bubble) {
		let rightClickCount = 0;
		let lastRightClickTime = 0;

		const rawContent = bubble.lastElementChild.innerHTML;

		let deleteTimer;
		let regenerateTimer;
		
		window.addEventListener('keyup', event => {
			if(event.key === 'Control') {
				clearTimeout(deleteTimer);
				clearTimeout(regenerateTimer);
				bubble.classList.remove('regenerate');
				bubble.classList.remove('delete');
			}
		})

		bubble.addEventListener('contextmenu', event => {
			event.preventDefault();

			const currentTime = new Date().getTime();

			console.log("[INFO][BUBBLE]Right click at time ", currentTime, " from last time ", lastRightClickTime, " after ", currentTime - lastRightClickTime);

			if(currentTime - lastRightClickTime < 500){
				rightClickCount++;
			} else {
				rightClickCount = 1;
			}
			lastRightClickTime = currentTime;

			if(rightClickCount === 2){
				this._switchMessage(bubble);
			}
		})

		bubble.addEventListener('click', event => {
			const currentTime = new Date().getTime();

			if(currentTime - lastRightClickTime < 500){
				navigator.clipboard.writeText(rawContent)
				.then(() => {
					bubble.classList.add('succeed');
					setTimeout(() => {
						bubble.classList.remove('succeed');
					}, 500)
				})
				.catch(err => {
					console.error("[INFO][BUBBLE]Message copy error:", err);
				})
				console.log("[INFO][BUBBLE]Copied.")
			}
		})

		bubble.addEventListener('mousedown', (event) => {
			if(event.button === 0 && this.ctrlPressed){
				bubble.classList.add('delete');

				const setId = bubble.parentNode.id.split('-');
				const messageId = Number(setId[setId.length-1]);
				
				deleteTimer = setTimeout(() => {
					this._deleteMessage(messageId);
				}, 1000);
			} else if(event.button === 2 && this.ctrlPressed){
				bubble.classList.add('regenerate');

				const setId = bubble.parentNode.id.split('-');
				const messageId = Number(setId[setId.length-1]);
				
				clearTimeout(regenerateTimer);
				regenerateTimer = setTimeout(() => {
					this._regenerateResponse(messageId);
					bubble.classList.remove('regenerate');
				}, 1000);
			}
		});

		bubble.addEventListener('mouseup', function() {
			clearTimeout(deleteTimer);
			clearTimeout(regenerateTimer);
			bubble.classList.remove('delete');
			bubble.classList.remove('regenerate');
		})

		bubble.addEventListener('mouseleave', function() {
			clearTimeout(deleteTimer);
			clearTimeout(regenerateTimer);
			bubble.classList.remove('delete');
			bubble.classList.remove('regenerate');
		})
	}

	_userBubbleInteract(bubble) {
		let timer;

		bubble.addEventListener('mousedown', (event) => {
			if(event.button === 0 && this.ctrlPressed){
				bubble.classList.add('delete');

				const setId = bubble.parentNode.id.split('-');
				const messageId = Number(setId[setId.length-1]);
				
				timer = setTimeout(() => {
					this._deleteMessage(messageId);
				}, 1000);
			}
		});

		bubble.addEventListener('mouseup', function() {
			clearTimeout(timer);
			bubble.classList.remove('delete');
		})

		bubble.addEventListener('mouseleave', function() {
			clearTimeout(timer);
			bubble.classList.remove('delete');
		})
	}

	_bubbleInteractAll() {
		const botBubbles = document.querySelectorAll('.chat-container-GPT-messages-bot-bubble');
		const userBubbles = document.querySelectorAll('.chat-container-GPT-messages-user-bubble');

		botBubbles.forEach(bubble => {
			this._botBubbleInteract(bubble);
		})

		userBubbles.forEach(bubble => {
			this._userBubbleInteract(bubble);
		})
	}

	_codeInteract(block) {
		let timer;
		const container = block.parentNode;

		const childNodes = container.childNodes;
		if (container.nodeName === 'PRE' && childNodes.length === 1 && childNodes[0].nodeName === 'CODE') {
			container.setAttribute("class", "code-block");
		} else {
			return;
		}

		let name = block.className.replace('language-', '');
		if(!name) name = 'code';
		container.setAttribute('code-language', name);

		container.addEventListener('contextmenu', function(event) {
			event.preventDefault();
		});

		container.addEventListener('mousedown', function(event) {
			if(event.button === 2){
				container.classList.add('active');
				
				timer = setTimeout(() => {
					navigator.clipboard.writeText(container.textContent)
						.then(() => {
							container.classList.remove('active');
							container.classList.add('succeed');
						})
						.catch(err => {
							container.classList.remove('active');
							container.classList.add('fail');
							console.error("[INFO]Code copy error:", err);
						})
				}, 1000)
			}
		});

		container.addEventListener('mouseup', function() {
			clearTimeout(timer);
			container.classList.remove('active');
			container.classList.remove('succeed');
			container.classList.remove('fail');
		})

		container.addEventListener('mouseleave', function() {
			clearTimeout(timer);
			container.classList.remove('active');
			container.classList.remove('succeed');
			container.classList.remove('fail');
		})
	}

	_codeInteractAll() {
		const codeBlocks = document.querySelectorAll('code');
		
		codeBlocks.forEach(block => {
			this._codeInteract(block);
		});
	}

	async _append_system_prompt(content){
		this.bot.appendSystemMessage(content);
		await this._saveRecordContent();

		const chatContainer = document.getElementById("chat-container-GPT-messages");

		const localSystemSet = document.createElement("div");
		localSystemSet.setAttribute("id", 'chat-container-GPT-messages-local-system');
		localSystemSet.setAttribute("class", "chat-container-GPT-messages-local-system");
		
		const localSystemBubble = document.createElement("div");
		localSystemBubble.setAttribute("class", "chat-container-GPT-messages-local-system-bubble");
		localSystemBubble.innerHTML = `<div>Local System</div><pre>${content}</pre>`;

		localSystemSet.appendChild(localSystemBubble);
		chatContainer.appendChild(localSystemSet);
		
		chatContainer.scrollTop = chatContainer.scrollHeight;
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
		userBubble.innerHTML = `<pre>${this._processRawDisplay(inputValue)}</pre>`;

		userSet.appendChild(userIcon);
		userSet.appendChild(userBubble);
		
		const chatContainer = document.getElementById("chat-container-GPT-messages");
		chatContainer.appendChild(userSet);

		this._userBubbleInteract(userBubble);
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
					{left: "\\[", right: "\\]", display: true},
					{left: "\\(", right: "\\)", display: false},
					{left: "$$", right: "$$", display: true},
					{left: "$", right: "$", display: false}
				]
			});
			const codeBlocks = botBubble.querySelectorAll('code');
			codeBlocks.forEach(block => {
				this._codeInteract(block);
			})
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}

		const rawContainer = document.createElement('pre');
		rawContainer.setAttribute("id", "raw-message");
		rawContainer.innerHTML = this._processRawDisplay(receive_content);
		botBubble.appendChild(rawContainer);
		
		this._botBubbleInteract(botBubble);
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
			if(inputValue.startsWith("/system ")){
				console.log("[INFO]Append system prompt: ", inputValue.slice(8));
				this._append_system_prompt(inputValue.slice(8));
			} else {
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
	}

	async _regenerateResponse(id) {
		if(window.isInteracting) return;
		console.log("[INFO][BUBBLE]Starting regeneration on bubble ", id);

		window.isInteracting = true;
		this._switchToStopButton();

		const contentIter = this.bot.regenerateMessage(id);

		const botBubble = document.getElementById('chat-container-GPT-messages-bot-'+id).querySelector('.chat-container-GPT-messages-bot-bubble');
		botBubble.innerHTML = this._processTextDisplay("...");

		let receive_content = '';
		for await (const piece of contentIter) {
			if (piece == undefined) continue;
			receive_content += piece;
			botBubble.innerHTML = this._processTextDisplay(receive_content);
			renderMathInElement(botBubble, {
				delimiters: [
					{left: "$$", right: "$$", display: true},
					{left: "$", right: "$", display: false}
				]
			});
			const codeBlocks = botBubble.querySelectorAll('code');
			codeBlocks.forEach(block => {
				this._codeInteract(block);
			})
		}

		const rawContainer = document.createElement('pre');
		rawContainer.setAttribute("id", "raw-message");
		rawContainer.innerHTML = this._processRawDisplay(receive_content);
		botBubble.appendChild(rawContainer);
		
		console.log("[INFO]Done receive content.");

		this._saveRecordContent();
		
		this._switchToSendButton();
		window.isInteracting = false;
	}

	async _removeRecordData(id) {
		try {
			const response = await fetch(`http://localhost:30962/gpt/record_remove/${id}`);
			const data = await response.json();
			return data;
		} catch (error) {
			console.log('[INFO]Error reading record:', error);
			return undefined;
		}
	}

	async _getRecordList() {
		try {
			const response = await fetch(`http://localhost:30962/gpt/record`);
			const data = await response.json();
			return data;
		} catch (error) {
			console.log('[INFO]Error reading record:', error);
			return undefined;
		}
	}

	async _saveRecordList(data) {
		try {
			fetch(`http://localhost:30962/gpt/record`, {
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

	async _getRecordData() {
		try {
			const response = await fetch(`http://localhost:30962/gpt/record/${this.current_record_id}`);
			const data = await response.json();
			return data;
		} catch (error) {
			console.log('[INFO]Error reading record:', error);
			return undefined;
		}
	}

	async _saveRecordData(data) {
		try {
			fetch(`http://localhost:30962/gpt/record/${this.current_record_id}`, {
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
		const recordList = await this._getRecordList();
		if(!recordList || recordList.recordIds.length == 0){
			const newRecordList = {
				recordIds: [0],
				recordTitles: ['New Chat']
			};
			await this._saveRecordList(newRecordList);
			await this._saveRecordData([]);
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
		await this._saveRecordData(context);
	}
	
	async newChat() {
		this._clear();
		const recordList = await this._getRecordList();
		console.log('Done');
		this.current_record_id = recordList.recordIds[0] + 1;
		recordList.recordIds.unshift(this.current_record_id);
		recordList.recordTitles.unshift('New Chat');
		await this._saveRecordData([]);
		await this._saveRecordList(recordList);
		this._loadRecordList();
	}

	async deleteRecord(id) {
		const recordList = await this._getRecordList();
		let index = recordList.recordIds.indexOf(id);
		recordList.recordIds.splice(index, 1);
		recordList.recordTitles.splice(index, 1);
		await this._saveRecordList(recordList);
		await this._loadRecordList();
		this._removeRecordData(id);
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
		let recordContents = await this._getRecordData();
		this.bot.body.messages.push(...recordContents);

		const chatContainer = document.getElementById("chat-container-GPT-messages");

		const globalSystemSet = document.createElement("div");
		globalSystemSet.setAttribute("id", 'chat-container-GPT-messages-global-system');
		globalSystemSet.setAttribute("class", "chat-container-GPT-messages-global-system");
		
		const globalSystemBubble = document.createElement("div");
		globalSystemBubble.setAttribute("class", "chat-container-GPT-messages-global-system-bubble");
		globalSystemBubble.innerHTML = `<div>Global System</div><pre>${document.getElementById("config-system-prompt-GPT").value}</pre>`;

		globalSystemSet.appendChild(globalSystemBubble);
		chatContainer.appendChild(globalSystemSet);

		if(this.useGlobalSystemPrompt == false) {
			globalSystemSet.style.display = 'none';
		}

		for(let i in recordContents){
			const piece = recordContents[i];
			if(piece.role == 'user'){
				const userSet = document.createElement("div");
				userSet.setAttribute("id", 'chat-container-GPT-messages-user-'+this.dialog_num);
				userSet.setAttribute("class", "chat-container-GPT-messages-user");
		
				const userIcon = document.createElement("div");
				userIcon.setAttribute("class", "chat-container-GPT-messages-user-icon");
				userIcon.innerHTML = "U";
		
				const userBubble = document.createElement("div");
				userBubble.setAttribute("class", "chat-container-GPT-messages-user-bubble");
				userBubble.innerHTML = `<pre>${this._processRawDisplay(piece.content)}</pre>`;
		
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
						{left: "\\[", right: "\\]", display: true},
						{left: "\\(", right: "\\)", display: false},
						{left: "$$", right: "$$", display: true},
						{left: "$", right: "$", display: false}
					]
				});

				const rawContainer = document.createElement('pre');
				rawContainer.setAttribute("id", "raw-message");
				rawContainer.innerHTML = this._processRawDisplay(piece.content);
				botBubble.appendChild(rawContainer);
			}
			if(piece.role == 'system'){
				const localSystemSet = document.createElement("div");
				localSystemSet.setAttribute("id", 'chat-container-GPT-messages-local-system');
				localSystemSet.setAttribute("class", "chat-container-GPT-messages-local-system");
				
				const localSystemBubble = document.createElement("div");
				localSystemBubble.setAttribute("class", "chat-container-GPT-messages-local-system-bubble");
				localSystemBubble.innerHTML = `<div>Local System</div><pre>${piece.content}</pre>`;
		
				localSystemSet.appendChild(localSystemBubble);
				chatContainer.appendChild(localSystemSet);
			}
			this._codeInteractAll();

			chatContainer.scrollTop = chatContainer.scrollHeight;
			this.dialog_num += 1;
		}

		this._codeInteractAll();
		this._bubbleInteractAll();
	}

	async _nameRecord() {
		if(this.useAgent){
			const systemPrompt = "Provide an appropriate title based on the user\'s JSON-formatted conversation records. The title should not exceed 20 words and should be returned directly. Return the content in the primary language of the conversation.";

			const recordList = await this._getRecordList();
			const index = recordList.recordIds.indexOf(this.current_record_id);
			const recordContents = await this._getRecordData();
			console.log(recordContents);

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
			await this._saveRecordList(recordList);
		}
	}
}
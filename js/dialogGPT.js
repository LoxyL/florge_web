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
		this.image_buffer = [];
		this._switchInteract();
		this._windowInteract();
		this._imageLoadInteract();
		this._loadRecordList();
	}

	_imageLoadInteract() {
		document.getElementById("image-load-button").addEventListener('change', (event) => {
			const files = event.target.files;
			const imageContainer = document.getElementById('image-send-GPT');
			imageContainer.innerHTML = '';
			this.image_buffer = [];

			for (const file of files) {
				const reader = new FileReader();
				reader.onload = (eve) => {
					const img = document.createElement('img');
					img.src = eve.target.result;
					img.style.width = '100px';
					img.style.marginRight = '10px';
					imageContainer.appendChild(img);
					this.image_buffer.push(eve.target.result)
					console.log(JSON.stringify(this.image_buffer));
					
				}
				reader.readAsDataURL(file);
			}
		})
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
		const inputElement = document.getElementById("message-send-GPT");
		const inputValue = inputElement.value;
		inputElement.value = "";

		const imageContainer = document.getElementById("image-send-GPT");
		imageContainer.innerHTML = '';
		
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
			return text.split('`').map((part, index) => {
				if (index % 2 === 0) {
					return part.replace(/\\/g, '\\\\');
				}
				return part;
			}).join('`');
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

	_appendSystemPromptBubble(content) {
		const chatContainer = document.getElementById("chat-container-GPT-messages");

		const localSystemSet = document.createElement("div");
		localSystemSet.setAttribute("id", 'chat-container-GPT-messages-local-system');
		localSystemSet.setAttribute("class", "chat-container-GPT-messages-local-system");
		
		const localSystemBubble = document.createElement("div");
		localSystemBubble.setAttribute("class", "chat-container-GPT-messages-local-system-bubble");
		localSystemBubble.innerHTML = `<label>Local System</label>`;

		const localSystemContent = document.createElement("pre");
		localSystemContent.innerHTML = content;
		localSystemBubble.appendChild(localSystemContent);

		localSystemSet.appendChild(localSystemBubble);
		chatContainer.appendChild(localSystemSet);
		
		chatContainer.scrollTop = chatContainer.scrollHeight;

		return {localSystemBubble, localSystemContent};
	}

	async _appendSystemPrompt(content){
		this._appendSystemPromptBubble(content);

		this.bot.appendSystemMessage(content);
		await this._saveRecordContent();
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

		if(this.image_buffer.length) {
			const buffer = JSON.parse(JSON.stringify(this.image_buffer))
			this.image_buffer = [];
			for(const img of buffer) {
				const imgEle = document.createElement('img');
				imgEle.src = img;
				const pre = document.createElement("pre");
				pre.appendChild(imgEle);
				userBubble.appendChild(pre);
			}
			this.bot.appendUserMessageWithImg(inputValue, buffer);
		} else {
			this.bot.appendUserMessage(inputValue);
		}
	}

	async _receive_message() {
		let contentIter = this.bot.answer();
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

	async _varifySearch(inputValue) {
		const varifyPrompt = `Please analyze the user's question to determine if a search is needed:
		1. If the question involves specific factual content, numbers, the latest data, or requires up-to-date information (e.g., event dates, statistical data, real-time reports, etc.), respond with "Y" (search needed) and initiate a search.
		2. If the question is general discussion, based on common knowledge, or can be answered directly with existing knowledge, respond with "N" (no search needed).
		3. If the user explicitly requests to perform a search, always respond "Y" (search needed) and initiate a search, regardless of the initial analysis`;
		let tmp = ''; let activateSearch = false;
		for await (const piece of this.agent.interact(varifyPrompt, inputValue)) {
			tmp += piece;
		}
		console.log(tmp);
		if(tmp == 'Y') {
			activateSearch = true;
		}
		return activateSearch;
	}

	async _generateKeyword(inputValue) {
		const keywordPrompt = `Please generate relevant keywords based on the user's question and return them in a JSON list format, ensuring that all keywords are in English. These keywords should accurately reflect the core content of the question for subsequent search purposes.
		**Example Format:**
		{
			"keywords": [
				"keyword1",
				"keyword2",
				"keyword3"
			]
		}
		**Notes:**
		1. When the question involves specific facts or data, extract key nouns and phrases, ensuring they are returned in English.
		2. For information related to time, place, or persons, ensure to generate the English translations of relevant variables.
		3. Ensure that the keywords are concise and clear, effectively guiding the search.
		**Example Question:**  
		User asks: “What is the capital of China?”
		**Expected Output:**
		{
			"keywords": [
				"China",
				"capital",
				"Beijing"
			]
		}
		Please ensure that the generated JSON structure is correct and accurately reflects the user's question content, while also keeping in mind that all keywords must be in English.`;
		let result = '';
		for await (const piece of this.agent.interact(keywordPrompt, inputValue)) {
			result += piece;
		}
		console.log(result);

		return JSON.parse(result).keywords;
	}

	async _filterSearchResult(inputValue, search_results) {
		const filterPrompt = `For the user's question:
			"${inputValue}"
			a search was conducted on the internet, resulting in the following entries (presented in JSON format). Please filter these results to determine which ones are truly useful and return them to me as is:
			1. **Relevance**: Prioritize selecting search results that are closely related to the keywords in the user's question. These results should directly answer the user's question or provide relevant information.
			2. **Authority**: Consider the reliability and authority of the sources. Favor results from authoritative websites or reputable sources, such as well-known news organizations, academic journals, or official institutions.
			3. **Timeliness**: If the user's question involves specific timing or the latest information, choose the most recent results. Outdated information may no longer be accurate for time-sensitive questions.
			4. **Completeness of Information**: Select results that provide detailed, clear, and complete answers rather than vague statements.
			*Remember*: DO NOT CHANGE THE ORIGINAL CONTENT!!!
			### Input Example:
			User question:  
			“What are the impacts of global warming?”
			Search results (JSON format):  
			\`\`\`json
			[
				{
					"title": "The Impact of Global Warming",
					"link": "https://example.com/global-warming-impact",
					"content": "Global warming leads to significant changes in ecosystems."
				},
				{
					"title": "A History of Global Warming",
					"link": "https://example.com/global-warming-history",
					"content": "An overview of the history of global warming."
				},
				{
					"title": "Scientists Warn of Rising Sea Levels",
					"link": "https://example.com/sea-level-rise",
					"content": "Scientists warn that rising sea levels will affect coastal cities."
				},
				{
					"title": "Future Trends in Climate Change",
					"link": "https://example.com/climate-change-trends",
					"content": "This article discusses future trends in climate change."
				},
				{
					"title": "Blog Post on Global Warming",
					"link": "https://example.com/global-warming-blog",
					"content": "A personal blog discussing global warming."
				}
			]
			\`\`\`
			### Expected Output:
			After filtering, the returned results should include: (maintain JSON format)  
			\`\`\`json
			[
				{
					"title": "The Impact of Global Warming",
					"link": "https://example.com/global-warming-impact",
					"content": "Global warming leads to significant changes in ecosystems."
				},
				{
					"title": "Scientists Warn of Rising Sea Levels",
					"link": "https://example.com/sea-level-rise",
					"content": "Scientists warn that rising sea levels will affect coastal cities."
				},
				{
					"title": "Future Trends in Climate Change",
					"link": "https://example.com/climate-change-trends",
					"content": "This article discusses future trends in climate change."
				}
			]
			\`\`\`
			Please carefully review each search result to ensure that only those meeting the above criteria are returned and maintain the JSON format.`

		let results = '';

		const initPrompt = `Based on the user's question, the following search results have been obtained from the internet (presented in JSON format):\n${results}`

		const {localSystemBubble, localSystemContent} = this._appendSystemPromptBubble(initPrompt);
		localSystemBubble.classList.add('active');

		const chatContainer = document.getElementById("chat-container-GPT-messages");
		chatContainer.scrollTop = chatContainer.scrollHeight;

		for await (const piece of this.agent.interact(filterPrompt, JSON.stringify(search_results))) {
			results += piece;

			localSystemContent.innerHTML = `Based on the user's question, the following search results have been obtained from the internet (presented in JSON format):\n${results}`

			localSystemBubble.scrollTop = localSystemBubble.scrollHeight;
		}

		const localSystemPrompt = `Based on the user's question, the following search results have been obtained from the internet (presented in JSON format):\n${results}\n\nPlease respond to the user's question according to the following requirements, clearly citing the source of your response, and ensure that your answer is in the same language as the user's question:\n1. **Select Relevant Information**: Prioritize extracting the search results that are most relevant to the user's question in order to provide accurate and specific answers.\n2. **Citation Format**: Clearly cite the results you reference in your response. Use the following format:\n- “According to the content of [Title](Link), …”\n- Example: According to [The Impact of Global Warming](https://example.com/global-warming-impact), global warming leads to significant changes in ecosystems.\n3. **Clarity and Conciseness**: Ensure your answer is clear and concise, addressing the main point without unnecessary elaboration.\n4. **Diverse Information**: If there are multiple relevant results, you may combine information from various sources to enhance the comprehensiveness of your answer.\n5. **Accuracy**: Maintain the authenticity and accuracy of the information based on the presented results.\n6. **Language Consistency**: Respond to the user in the same language as their original question to ensure effective communication.\nPlease review the search results and generate a clear and authoritative answer.\nAlways remember to refer with link.`
		localSystemContent.innerHTML = localSystemPrompt;
		await this.bot.appendSystemMessage(localSystemPrompt);

		localSystemBubble.classList.remove('active');
	}

	async *_extractInfo(inputValue, content) {
		const extractPrompt = `Based on the following question: ${inputValue}, extract relevant information and simplify it to no more than 300 words in language of question. Please ensure that key points are covered and the information is presented clearly and understandably.`;
		
		const contentIter = this.agent.interact(extractPrompt, content);
		for await (const piece of contentIter) {
			yield piece;
		}
	}

	async _internetAccess(inputValue) {
		const activateSearch = await this._varifySearch(inputValue);

		if(activateSearch) {
			let search_results = [];
	
			const chatContainer = document.getElementById("chat-container-GPT-messages");
	
			const searchSet = document.createElement("div");
			searchSet.setAttribute("class", "chat-container-GPT-messages-search");
			chatContainer.appendChild(searchSet);
			
			const searchBubble = document.createElement("div");
			searchBubble.setAttribute("class", "chat-container-GPT-messages-search-bubble");
			searchSet.appendChild(searchBubble);
	
			const searchDisplay = document.createElement("div");
			searchDisplay.setAttribute("class", "chat-search-display");
			searchBubble.appendChild(searchDisplay);
	
			const searchTitle = document.createElement("div");
			searchTitle.setAttribute("class", "chat-search-title");
			searchTitle.innerHTML = "Analyzing..."
			searchBubble.appendChild(searchTitle);

			chatContainer.scrollTop = chatContainer.scrollHeight;

			const keywords = await this._generateKeyword(inputValue);
			searchTitle.innerHTML = "Searching..."

	
			const useProxy = document.getElementById("config-use-proxy").checked;
			const useWiki = document.getElementById("config-use-chat-search-GPT-wiki").checked;
			const useBaidu = document.getElementById("config-use-chat-search-GPT-baidu").checked;
			const useZhihu = document.getElementById("config-use-chat-search-GPT-zhihu").checked;
			
			if(useWiki) {
				const wikiBlock = document.createElement("div");
				wikiBlock.setAttribute("class", "search");
				wikiBlock.innerHTML = `<div class="source">Wiki</div>\n<div class="keyword">${keywords.join(' ')}</div>`
				searchDisplay.appendChild(wikiBlock);
	
				for await (const item of this._searchFor(keywords.join(' '), 'wiki', useProxy)) {
					console.log(item);
	
					const itemBlock = document.createElement("div");
					itemBlock.setAttribute("class", "item");
					itemBlock.innerHTML = `<div class="item-title">${item.title}</div>`;
					wikiBlock.appendChild(itemBlock);
	
					const itemContent = document.createElement('div');
					itemContent.setAttribute('class', 'item-content');
					itemBlock.appendChild(itemContent);
					searchBubble.scrollTop = searchBubble.scrollHeight;
	
					let content = '';
					for await (const piece of this._extractInfo(inputValue, item.content)) {
						content += piece;
						itemContent.innerHTML = content;
						searchBubble.scrollTop = searchBubble.scrollHeight;
					}
					
					search_results.push({
						title: item.title,
						link: item.link,
						content: content
					})
				}
			}
	
			searchBubble.classList.add('done');
			searchTitle.innerHTML = "Done."

			await this._filterSearchResult(inputValue, search_results);
		}
	}

	async *_searchFor(keyword, platform, useProxy=false) {
		try {
			const proxyUrl = document.getElementById('config-proxy-url').value;
			const data = {
				keyword: keyword,
				useProxy: useProxy,
				proxyUrl: proxyUrl
			}

			const response = await fetch(`/gpt/search/${platform}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(data)
			});
			const reader = response.body.getReader();
			const decoder = new TextDecoder('utf-8'); 

			while(true) {
				const {value, done} = await reader.read();

				try {					
					if(value) {
						const chunk = decoder.decode(value, {stream: true});
						const lines = chunk.split('<splitMark>').filter(line => line);

						for (const line of lines) {
							yield JSON.parse(line);
						}
					}
				} catch (err) {
					console.error('Error:', err);
				}

				if(done) {
					break;
				}
			}
		} catch (error) {
			console.error('Error:', error);
		}
	}

	async send() {
		const useChatSearch = document.getElementById('config-use-chat-search-GPT').checked;

		let inputValue = this._getInputGPT();
		if((inputValue !== "") || this.image_buffer){
			if(inputValue.startsWith("/system ")){
				console.log("[INFO]Append system prompt: ", inputValue.slice(8));
				this._appendSystemPrompt(inputValue.slice(8));
			} else {
				window.isInteracting = true;
				this._send_message(inputValue);
				this.dialog_num += 1;
				if(useChatSearch){
					await this._internetAccess(inputValue);
				}
				this._switchToStopButton();
				console.log("[INFO]Send content: ", inputValue);
				await this._receive_message();
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
			const response = await fetch(`/gpt/record_remove/${id}`);
			const data = await response.json();
			return data;
		} catch (error) {
			console.log('[INFO]Error reading record:', error);
			return undefined;
		}
	}

	async _getRecordList() {
		try {
			const response = await fetch(`/gpt/record`);
			const data = await response.json();
			return data;
		} catch (error) {
			console.log('[INFO]Error reading record:', error);
			return undefined;
		}
	}

	async _saveRecordList(data) {
		try {
			fetch(`/gpt/record`, {
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
			const response = await fetch(`/gpt/record/${this.current_record_id}`);
			const data = await response.json();
			return data;
		} catch (error) {
			console.log('[INFO]Error reading record:', error);
			return undefined;
		}
	}

	async _saveRecordData(data) {
		try {
			fetch(`/gpt/record/${this.current_record_id}`, {
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
		globalSystemBubble.innerHTML = `<label>Global System</label><pre>${document.getElementById("config-system-prompt-GPT").value}</pre>`;

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
				if(Array.isArray(piece.content)){
					for (const ele of piece.content) {
						if (ele.type == 'text') {
							userBubble.innerHTML += `<pre>${this._processRawDisplay(ele.text)}</pre>`;
						} else if (ele.type == "image_url") {
							const img = document.createElement("img");
							img.src = ele.image_url.url;
							const pre = document.createElement("pre");
							pre.appendChild(img);
							userBubble.appendChild(pre);
						}
					}
				} else {
					userBubble.innerHTML = `<pre>${this._processRawDisplay(piece.content)}</pre>`;
				}
		
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
				localSystemBubble.innerHTML = `<label>Local System</label><pre>${piece.content}</pre>`;
		
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
			const contentIter = this.agent.interact(systemPrompt, JSON.stringify(recordContents[1]));
			
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
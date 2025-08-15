// import axios from 'axios';
// import readline from 'readline';

class BaseGPT {
    constructor(config = {}) {
        this.src = config.url || '';
        this.apiKey = config.apiKey || '';
        this.model = config.model || 'gpt-5-nano';
        this.streamControl = null;
        this._updateHeaders();
    }

    setConfig(config) {
        this.src = config.url || this.src;
        this.apiKey = config.apiKey || this.apiKey;
        this.model = config.model || this.model;
        this._updateHeaders();
        console.log("[INFO] BaseGPT config updated:", { model: this.model, src: this.src });
    }

    _updateHeaders() {
        this._headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    streamAbort() {
        if (this.streamControl) {
            this.streamControl.abort();
            this.streamControl = null;
        }
    }

    async* _streamResponse(body) {
        this.streamControl = new AbortController();
        const signal = this.streamControl.signal;

        try {
            const response = await fetch(this.src, {
                method: 'POST',
                headers: this._headers,
                body: JSON.stringify(body),
                signal
            });

            console.log("[INFO] Response: ", response);

            if (!response.ok) {
                throw new Error(`[INFO] HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                let lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.trim().startsWith('data:')) {
                        const data = line.trim().substring(5).trim();
                        if (data === '[DONE]') {
                            break; // Stream finished
                        }
                        try {
                            const message = JSON.parse(data);
                            if (message.choices && message.choices.length > 0) {
                                if (message.choices[0].delta.content == undefined) continue;
                                yield message.choices[0].delta.content;
                            }
                        } catch (error) {
                            console.error("[ERROR] Failed to parse stream line:", line, error);
                        }
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log("[INFO] Interaction was aborted.");
            } else {
                console.error(`[INFO] Error interacting with ${this.model}:`, error);
            }
        } finally {
            this.streamControl = null;
        }
    }
}

export class BotGPT extends BaseGPT {
    constructor(config) {
        super(config);
        this.useSystemPrompt = false;
        this.systemPrompt = ``;
        this.maxTokens = 4096;
        this.messages = [];
        this._initializeMessages();
        console.log("[INFO]Done creating new bot.");
    }

    _initializeMessages() {
        this.messages = [
            {
                role: "system",
                content: this.systemPrompt
            }
        ];
    }

    updateParameters(params = {}) {
        this.useSystemPrompt = typeof params.useSystemPrompt === 'boolean' ? params.useSystemPrompt : this.useSystemPrompt;
        this.systemPrompt = params.systemPrompt || this.systemPrompt;
        this.maxTokens = params.maxTokens || this.maxTokens;
        
        if (this.useSystemPrompt) {
            this.messages[0].content = this.systemPrompt;
        } else {
            this.messages[0].content = '';
        }

        console.log("[INFO]Current params:\n[INFO]\tmodel: ", this.model, "\n[INFO]\tmax_tokens: ", this.maxTokens);
    }

    clearHistory() {
        this._initializeMessages();
    }

    deleteMessage(id) {
        // Adjusting for system prompt at index 0
        if (id > 0 && id < this.messages.length) {
            this.messages.splice(id, 1);
        }
    }

    async *regenerateMessage(id) {
        if (id <= 0) return; // Cannot regenerate system prompt

        const contextBefore = this.messages.slice(0, id);
        const contextAfter = this.messages.slice(id + 1);

        this.messages = contextBefore;

        let fullResponse = "";
        for await (const piece of this.answer()) {
            fullResponse += piece;
            yield piece;
        }

        if (fullResponse) {
            this.messages.push({ role: 'assistant', content: fullResponse });
        }

        this.messages.push(...contextAfter);
    }

    appendSystemMessage(content) {
		this.messages.push({ role: 'system', content: content });
    }

    appendUserMessage(content) {
		this.messages.push({ role: 'user', content: content });
    }

    appendUserMessageWithImg(text, imgs) {
        const content = [{ "type": "text", "text": text }];
        for (const img of imgs) {
            content.push({
                "type": "image_url",
                "image_url": { "url": img }
            });
        }
        this.messages.push({ role: 'user', content: content });
    }

    async *answer() {
        const body = {
            model: this.model,
            messages: this.messages,
            max_tokens: this.maxTokens,
            stream: true
        };
        
        console.log("[INFO]Current context: ", body);

        let fullResponse = "";
        for await (const piece of this._streamResponse(body)) {
            fullResponse += piece;
            yield piece;
        }

        if (fullResponse) {
            this.messages.push({ role: 'assistant', content: fullResponse });
        }
    }

    async *interact(contentSend) {
        console.log("[INFO]Starting interaction.");
        if (contentSend) {
            this.appendUserMessage(contentSend);
        }
        yield* this.answer();
    }

    async *interactWithImg(text, imgs) {
        console.log("[INFO]Starting interaction.");
        if (text || imgs) {
            this.appendUserMessageWithImg(text, imgs);
        }
        yield* this.answer();
    }
}

export class AgentGPT extends BaseGPT {
    constructor(config) {
        super(config);
        this.maxTokens = 4000;
        console.log("[INFO][AGENT]Done creating new agent.");
    }
    
    updateParameters(params = {}) {
        this.maxTokens = params.maxTokens || this.maxTokens;
        console.log("[INFO][AGENT]Current params:\n[INFO][AGENT]\tmodel: ", this.model, "\n[INFO][AGENT]\tmax_tokens: ", this.maxTokens);
    }

    async *interact(systemPrompt, userContent) {
        const body = {
            model: this.model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            max_tokens: this.maxTokens,
            stream: true
        };

        console.log("[INFO][AGENT]Current context: ", body);
        yield* this._streamResponse(body);
    }
}
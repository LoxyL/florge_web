// import axios from 'axios';
// import readline from 'readline';


export class BotGPT {
    constructor() {
        this.streamControl = null;
        this.systemPrompt = ``;
        this.body = {
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: "system",
                    content: this.systemPrompt
                }
            ],
            max_tokens: 0,
            stream: true
        }
        this._refresh();
        console.log("[INFO]Done creating new bot.");
    }

    _getParams() {
        this.src = document.getElementById('config-source-GPT').value;
        this.apiKey = document.getElementById('config-apikey-GPT').value;
        this.model = document.getElementById("model-GPT").value;
        this.systemPrompt = document.getElementById("config-system-prompt-GPT").value;;
        this.maxTokens = Number(document.getElementById("max-tokens").value);
    }

    _refresh() {
        this._getParams();
        this._headers =  {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
        this.body.model = this.model;
        this.body.max_tokens = this.maxTokens;
        this.body.messages[0].content = this.systemPrompt;
        console.log("[INFO]Current params:\n[INFO]\tmodel: ", this.model, "\n[INFO]\tmax_tokens: ", this.maxTokens);
    }

    deleteMessage(id) {
        this.body.messages.splice(id, 1);
    }

    async *regenerateMessage(id) {
        const contextBefore = this.body.messages.slice(0, id);
        const contextAfter = this.body.messages.slice(id+1);

        this.body.messages = contextBefore;

        for await (const piece of this.interact(null)){
            yield piece;
        }

        this.body.messages.push(...contextAfter);
    }

    streamAbort() {
        if(this.streamControl){
            this.streamControl.abort();
            this.streamControl = null;
        }
    }

    async *interact(contentSend) {
        this.streamControl = new AbortController();
        let signal = this.streamControl.signal;

        console.log("[INFO]Starting interaction.");
        this._refresh();
        if(contentSend){
            const messageSend = {
                role: 'user',
                content: contentSend
            }
            this.body.messages.push(messageSend);
        }
        console.log("[INFO]Current context: ", this.body);

        let response_content = "";
        try {
            const response = await fetch(this.src, {
                method: 'POST',
                headers: this._headers,
                body: JSON.stringify(this.body),
                signal
            });

            console.log("[INFO]Response: ", response);

            if (!response.ok) {
                throw new Error(`[INFO]HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');

            let buffer = '';
      
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
    
                buffer += decoder.decode(value, { stream: true });

                // console.log("[INFO]Current buffer: ", buffer);
    
                let lines = buffer.split('\n');
                buffer = lines.pop();
    
                for (const line of lines) {
                    if (line.trim().startsWith('data:')) {
                        try {
                            const message = JSON.parse(line.trim().substring(5).trim());
                            if (message.choices && message.choices.length > 0) {
                                if(message.choices[0].delta.content == undefined) continue;
                                response_content += message.choices[0].delta.content;
                                yield message.choices[0].delta.content;
                            }
                        } catch (error) {
                            ;
                        }
                    }
                }
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log("[INFO]Interaction was aborted.");
            } else {
                console.error(`[INFO]Error interacting with ${this.model}:`, error);
            }
            
        }
        
        const messageReceive = {
            role: 'assistant',
            content: response_content
        }

        this.body.messages.push(messageReceive);
    }
}

export class AgentGPT {
    constructor() {
        this.model = 'gpt-4o-mini';
        this.maxTokens = 200;
        this._refresh();
        console.log("[INFO][AGENT]Done creating new agent.");
    }
    
    _getParams() {
        this.src = document.getElementById('config-source-GPT').value;
        this.apiKey = document.getElementById('config-apikey-GPT').value;
    }

    _refresh() {
        this._getParams();
        this._headers =  {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
        console.log("[INFO][AGENT]Current params:\n[INFO][AGENT]\tmodel: ", this.model, "\n[INFO][AGENT]\tmax_tokens: ", this.maxTokens);
    }

    async *interact(systemPrompt, contentSend) {
        this.body = {
            model: this.model,
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: contentSend
                }
            ],
            max_tokens: this.maxTokens,
            stream: true
        }
        console.log("[INFO][AGENT]Current context: ", this.body);
        try {
            const response = await fetch(this.src, {
                method: 'POST',
                headers: this._headers,
                body: JSON.stringify(this.body)
            });

            console.log("[INFO][AGENT]Response: ", response);

            if (!response.ok) {
                throw new Error(`[INFO][AGENT]HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');

            let response_content = "";

            let buffer = '';
      
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
    
                buffer += decoder.decode(value, { stream: true });

                // console.log("[INFO]Current buffer: ", buffer);
    
                let lines = buffer.split('\n');
                buffer = lines.pop();
    
                for (const line of lines) {
                    if (line.trim().startsWith('data:')) {
                        try {
                            const message = JSON.parse(line.trim().substring(5).trim());
                            if (message.choices && message.choices.length > 0) {
                                if(message.choices[0].delta.content == undefined) continue;
                                response_content += message.choices[0].delta.content;
                                yield message.choices[0].delta.content;
                            }
                        } catch (error) {
                            ;
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`[INFO][AGENT]Error interacting with agent ${this.model}:`, error);
        }
    }
}
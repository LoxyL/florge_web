// import axios from 'axios';
// import readline from 'readline';


export class BotGPT {
    constructor() {
        this.systemPrompt = "";
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
        console.log("[INFO]Current params:\n[INFO]\tmodel: ", this.model, "\n[INFO]\tmax_tokens: ", this.maxTokens);
    }

    async *interact(contentSend) {
        console.log("[INFO]Starting interaction.");
        this._refresh();
        const messageSend = {
            role: 'user',
            content: contentSend
        }
        this.body.messages.push(messageSend);
        console.log("[INFO]Current context: ", this.body);
        try {
            const response = await fetch(this.src, {
                method: 'POST',
                headers: this._headers,
                body: JSON.stringify(this.body)
            });

            console.log("[INFO]Response: ", response);

            if (!response.ok) {
                throw new Error(`[INFO]HTTP error! status: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');

            var response_content = "";

            var buffer = '';
      
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
            
            const messageReceive = {
                role: 'assistant',
                content: response_content
            }

            this.body.messages.push(messageReceive);

        } catch (error) {
            console.error(`[INFO]Error interacting with ${this.model}:`, error);
        }
    }
}

export class AgentGPT {
    constructor() {
        this.src = document.getElementById('config-source-GPT').value;
        this.apiKey = document.getElementById('config-apikey-GPT').value;
        console.log("[INFO][AGENT]Done creating new agent.");
    }

    async *interact(systemPrompt, contentSend) {
        this.body = {
            model: 'gpt-4o-mini',
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
            max_tokens: 200,
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

            var response_content = "";

            var buffer = '';
      
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
import axios from 'axios';
import readline from 'readline';


export class BotGPT {
    constructor() {
        this.src = "https://api.openai-hk.com/v1/chat/completions";
        this.apiKey = "hk-piidk61000036048c6e26ccd2f9cba72db0ca084190047f5";
        this.systemPrompt = "";
        this._refresh();
    }

    _getParams() {
        this.model = document.getElementById("model-GPT").value;
        this.maxTokens = document.getElementById("max-tokens").value;
    }

    _refresh() {
        this._getParams();
        this._header =  {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        };
        this.body = {
            model: this.model,
            messages: [
                {
                    role: "system",
                    content: this.systemPrompt
                }
            ],
            max_tokens: this.maxTokens,
            stream: true
        }
    }

    async *interact(contentSend) {
        this._refresh();
        messageSend = {
            role: 'user',
            content: contentSend
        }
        this.body.messages.push(messageSend);
        try {
            const response = await axios({
                method: 'post',
                url: this.src,
                headers: this._header,
                data: this.body,
                responseType: 'stream'
            });
      
            const rl = readline.createInterface({
                input: response.data
            });

            var response_content = "";
      
            for await (const line of rl) {
                if (line.trim().startsWith('data:')) {
                    const message = JSON.parse(line.trim().substring(5).trim());
                    if (message.choices && message.choices.length > 0) {
                        process.stdout.write(message.choices[0].delta.content);
                        response_content += message.choices[0].delta.content;
                        yield message.choices[0].delta.content;
                    }
                }
            }
            
            messageReceive = {
                role: 'agent',
                content: response_content
            }

            this.body.messages.push(messageReceive);

        } catch (error) {
            console.error(`Error interacting with ${this.model}:`, error);
        }
    }
}
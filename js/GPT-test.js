const axios = require('axios');
const readline = require('readline');

class GPT4oClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async *interact(prompt, systemMessage) {
    try {
      const response = await axios({
        method: 'post',
        url: 'https://api.openai-hk.com/v1/chat/completions',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        data: {
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: prompt }
          ],
          stream: true
        },
        responseType: 'stream'
      });

      const rl = readline.createInterface({
        input: response.data
      });

      for await (const line of rl) {
        if (line.trim().startsWith('data:')) {
        //   console.log(line);
          const message = JSON.parse(line.trim().substring(5).trim());
          // console.log(message);
          if (message.choices && message.choices.length > 0) {
            yield message.choices[0].delta.content;
          }
        }
      }

    } catch (error) {
      console.error('Error interacting with GPT-4:', error);
    }
  }
}

// 使用示例
const apiKey = 'hk-piidk61000036048c6e26ccd2f9cba72db0ca084190047f5'; // 你的 OpenAI API 密钥
const gpt4oClient = new GPT4oClient(apiKey);

const prompt = '请简要解释一下量子力学的基本原理。';
const systemMessage = '你是一个知识渊博的助手。';

(async () => {
  for await (const chunk of gpt4oClient.interact(prompt, systemMessage)) {
    process.stdout.write(chunk);
  }
  console.log('\nResponse stream ended.');
})();

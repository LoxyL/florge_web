class GPT4oClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async *interact(prompt, systemMessage) {
    const response = await fetch('https://api.openai-hk.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt }
        ],
        stream: true
      })
    });

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let lines = buffer.split('\n');
      buffer = lines.pop(); // 保留最后一个部分行

      for (const line of lines) {
        if (line.trim().startsWith('data:')) {
          const message = JSON.parse(line.trim().substring(5).trim());
          if (message.choices && message.choices.length > 0) {
            yield message.choices[0].delta.content;
          }
        }
      }
    }
  }
}

// 使用示例
const apiKey = 'hk-piidk61000036048c6e26ccd2f9cba72db0ca084190047f5'; // 你的 OpenAI API 密钥
const gpt4oClient = new GPT4oClient(apiKey);

const prompt = "Hi";
const systemMessage = "";

  (async () => {try {
    for await (const chunk of gpt4oClient.interact(prompt, systemMessage)) {
      process.stdout.write(chunk);
    }
  } catch (error) {
    console.error('Error in interaction:', error);
  }})()
;

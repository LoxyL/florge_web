以下是您项目的中文版本 README 文件：

---

# AI 聊天网页应用

欢迎来到我的 AI 聊天网页应用！这是我作为自学程序员的第一次尝试创建网页应用。我希望你觉得它有用且易于使用。

## 项目描述

这个项目是一个简单的基于网页的 AI 聊天应用，允许用户与聊天机器人互动。聊天机器人可以进行对话、回答问题并执行基本任务。该应用的主要功能包括：

- 与聊天机器人发送和接收消息。
- 维护聊天记录并在不同聊天会话之间切换。
- 在聊天中高亮和互动代码片段。
- 使用本地存储保存和管理聊天记录。

## 快速开始

要开始使用此项目，请按照以下步骤操作：

### 先决条件

- 一个网页浏览器（Chrome、Firefox、Safari 等）
- OpenAI API 密钥（可以通过注册 [OpenAI](https://openai.com/) 获取）
- 安装 [Node.js](https://nodejs.org/)。

### 安装

1. **安装 Node.js**：
   - 从 [官方网站](https://nodejs.org/) 下载并安装 Node.js，这将同时安装 npm（Node 包管理器）。

2. **克隆此仓库到本地机器**：

    ```sh
    git clone https://github.com/LoxyL/chat_tool_web.git
    cd chat_tool_web
    ```

3. **安装 Express**：
   - 进入项目目录并运行以下命令以安装 Express 库：

    ```sh
    npm install express
    ```

4. **启动应用**：
   - 运行 `start.bat` 文件以启动应用。

### 获取 OpenAI API 密钥

要使用 AI 聊天功能，您需要从 OpenAI 获取 API 密钥。请按照以下步骤获取：

1. **创建 OpenAI 账户**：
    - 访问 [OpenAI 注册页面](https://platform.openai.com/signup)。
    - 使用您的电子邮件地址、Google 账户或 Microsoft 账户注册。

2. **生成 API 密钥**：
    - 登录后，导航到 [API 密钥页面](https://platform.openai.com/account/api-keys)。
    - 点击“创建新密钥”。
    - 复制并安全存储您的 API 密钥（它只会显示一次）。

### 使用 OpenAI-HK 或 DeepBrick

另外，您可以从 OpenAI-HK 或 DeepBrick 获取 API 密钥，这些是提供 OpenAI 服务的第三方供应商。以下是从 OpenAI-HK 获取 API 密钥的步骤：

1. **访问 OpenAI-HK 网站**：
    - 前往 [OpenAI-HK](https://www.openai-hk.com)。

2. **注册并购买积分**：
    - 创建一个账户并登录。
    - 购买使用其 API 服务所需的积分。

3. **生成并复制您的 API 密钥**：
    - 导航到 API 密钥管理部分。
    - 生成新的 API 密钥并安全存储。

### 使用方法

1. 在网页浏览器中打开应用。
2. 在所需字段中输入您的 OpenAI API 密钥。
3. 通过在输入框中输入消息并点击“发送”按钮开始新的聊天。
4. 您可以使用侧边的记录列表在不同的聊天记录之间切换。
5. 要删除聊天记录，请点击相应聊天记录旁边的删除按钮。

## 功能

### 聊天互动

- **发送消息**：输入消息并将其发送给聊天机器人。聊天机器人将根据提供的输入进行响应。
- **接收消息**：聊天机器人的响应将显示在聊天窗口中。
- **代码高亮**：如果聊天机器人响应代码片段，它们将被高亮显示以提高可读性。
- **上下文菜单**：右键点击代码片段以将其复制到剪贴板。

### 聊天记录

- **保存聊天**：聊天记录保存在本地存储中，允许您重新访问以前的对话。
- **切换记录**：使用记录列表轻松切换不同的聊天记录。
- **删除记录**：从列表中删除不需要的聊天记录。

## 贡献

由于这是我的第一个项目，任何反馈和贡献都非常感谢。如果您有任何建议或改进，请随时提出问题或提交拉取请求。

---

请根据需要进行任何修改！
Here's an updated version of your README that includes the installation of Node.js and the Express library, along with the new startup instructions using `start.bat`.

---

# AI Chat Web Application

Welcome to my AI Chat Web Application! This is my first attempt at creating a web application as a self-taught programmer. I hope you find it useful and easy to use.

## Project Description

This project is a simple web-based AI chat application that allows users to interact with a chatbot. The chatbot can hold conversations, answer questions, and perform basic tasks. The main features of this application include:

- Sending and receiving messages with the chatbot.
- Maintaining chat records and switching between different chat sessions.
- Highlighting and interacting with code snippets within the chat.
- Using local storage to save and manage chat records.

## Getting Started

To get started with this project, you need to follow these steps:

### Prerequisites

- A web browser (Chrome, Firefox, Safari, etc.)
- An OpenAI API key (you can get one by signing up at [OpenAI](https://openai.com/))
- [Node.js](https://nodejs.org/) installed on your machine.

### Installation

1. **Install Node.js**:
   - Download and install Node.js from the [official website](https://nodejs.org/). This will also install npm (Node Package Manager).

2. **Clone this repository to your local machine**:

    ```sh
    git clone https://github.com/LoxyL/chat_tool_web.git
    cd chat_tool_web
    ```

3. **Install Express**:
   - Navigate to the project directory and run the following command to install the Express library:

    ```sh
    npm install express
    ```

4. **Start the Application**:
   - Run the `start.bat` file to launch the application.

### Obtaining an OpenAI API Key

To use the AI chat functionality, you'll need an API key from OpenAI. Follow these steps to obtain one:

1. **Create an OpenAI Account**:
    - Visit the [OpenAI signup page](https://platform.openai.com/signup).
    - Sign up using your email address, Google account, or Microsoft account.

2. **Generate an API Key**:
    - After logging in, navigate to the [API keys page](https://platform.openai.com/account/api-keys).
    - Click on "Create new secret key".
    - Copy and securely store your API key (it will only be shown once).

### Using OpenAI-HK or DeepBrick

Alternatively, you can obtain an API key from OpenAI-HK or DeepBrick, which are third-party providers offering OpenAI services. Here's how you can get an API key from OpenAI-HK:

1. **Visit the OpenAI-HK Website**:
    - Go to [OpenAI-HK](https://www.openai-hk.com).

2. **Sign Up and Purchase Credits**:
    - Create an account and log in.
    - Purchase the necessary credits to use their API services.

3. **Generate and Copy Your API Key**:
    - Navigate to the API key management section.
    - Generate a new API key and store it securely.

### Usage

1. Open the application in your web browser.
2. Enter your OpenAI API key in the required field.
3. Start a new chat by typing a message in the input box and clicking the "Send" button.
4. You can switch between different chat records using the record list on the side.
5. To delete a chat record, click the delete button next to the respective chat record.

## Features

### Chat Interaction

- **Send Messages**: Type a message and send it to the chatbot. The chatbot will respond based on the input provided.
- **Receive Messages**: The chatbot's response is displayed in the chat window.
- **Code Highlighting**: If the chatbot responds with code snippets, they will be highlighted for better readability.
- **Context Menu**: Right-click on a code snippet to copy it to your clipboard.

### Chat Records

- **Save Chats**: Chat records are saved in local storage, allowing you to revisit previous conversations.
- **Switch Records**: Easily switch between different chat records using the record list.
- **Delete Records**: Remove unwanted chat records from the list.

## Contributing

As this is my first project, any feedback and contributions are greatly appreciated. If you have any suggestions or improvements, please feel free to open an issue or submit a pull request.

---

Feel free to modify any sections as per your requirements!

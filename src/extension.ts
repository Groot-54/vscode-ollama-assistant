// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Ollama } from 'ollama';

const ollama = new Ollama();

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)

	const provider = new OllamaSidebarProvider(context.extensionUri);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("ollama-chat", provider)
    );

	let startChatDisposable = vscode.commands.registerCommand('ollama-assistant.startChat', () => {
        // Show the Ollama sidebar
        vscode.commands.executeCommand('workbench.view.extension.ollama-sidebar');
    });

	let analyzeDisposable = vscode.commands.registerCommand('ollama-assistant.analyzeCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor!');
            return;
        }

        const code = editor.document.getText();
        const response = await analyzeCode(code);
        provider.sendMessageToWebview({
            type: 'analysis',
            content: response
        });
    });

	context.subscriptions.push(startChatDisposable);
    context.subscriptions.push(analyzeDisposable);

	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-ollama-assistant" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('vscode-ollama-assistant.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Ollama Code Assistant!');
	});

	context.subscriptions.push(disposable);
}

class OllamaSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
        };

        webviewView.webview.html = this._getHtmlForWebview();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'chat':
                    try {
                        const response = await sendMessageToOllama(data.message);
                        this.sendMessageToWebview({
                            type: 'response',
                            content: response
                        });
                    } catch (error) {
                        this.sendMessageToWebview({
                            type: 'error',
                            content: 'Error: Failed to communicate with Ollama'
                        });
                    }
                    break;
            }
        });
    }

    public sendMessageToWebview(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    private _getHtmlForWebview() {
        return /*html*/ `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { padding: 10px; }
                    #chat-container { 
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                    }
                    #messages {
                        flex: 1;
                        overflow-y: auto;
                        margin-bottom: 10px;
                    }
                    .message {
                        margin: 5px;
                        padding: 8px;
                        border-radius: 5px;
                    }
                    .user-message {
                        background-color: var(--vscode-editor-background);
                        border: 1px solid var(--vscode-editor-foreground);
                    }
                    .assistant-message {
                        background-color: var(--vscode-editor-selectionBackground);
                    }
                    .error-message {
                        background-color: var(--vscode-errorForeground);
                        color: white;
                    }
                </style>
            </head>
            <body>
                <div id="chat-container">
                    <div id="messages"></div>
                    <div id="input-container">
                        <textarea id="user-input" rows="3" style="width: 100%"></textarea>
                        <button id="send-button">Send</button>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    const messagesDiv = document.getElementById('messages');
                    const userInput = document.getElementById('user-input');
                    const sendButton = document.getElementById('send-button');

                    function addMessage(content, type) {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = \`message \${
                            type === 'user' ? 'user-message' : 
                            type === 'error' ? 'error-message' : 
                            'assistant-message'
                        }\`;
                        messageDiv.textContent = content;
                        messagesDiv.appendChild(messageDiv);
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    }

                    sendButton.addEventListener('click', () => {
                        const message = userInput.value;
                        if (message.trim()) {
                            addMessage(message, 'user');
                            vscode.postMessage({
                                type: 'chat',
                                message: message
                            });
                            userInput.value = '';
                        }
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'response':
                            case 'analysis':
                                addMessage(message.content, 'assistant');
                                break;
                            case 'error':
                                addMessage(message.content, 'error');
                                break;
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}

async function sendMessageToOllama(message: string): Promise<string> {
    try {
        const response = await ollama.chat({
            model: 'deepseek-r1:1.5b',
            messages: [{ role: 'user', content: message }]
        });
        
        return response.message.content;
    } catch (error) {
        console.error('Error communicating with Ollama:', error);
        throw error;
    }
}

async function analyzeCode(code: string): Promise<string> {
    try {
        const response = await ollama.chat({
            model: 'codellama',
            messages: [{
                role: 'user',
                content: `Please analyze this code and provide suggestions for improvement:\n\n${code}`
            }]
        });
        
        return response.message.content;
    } catch (error) {
        console.error('Error analyzing code:', error);
        throw error;
    }
}

// This method is called when your extension is deactivated
export function deactivate() {}

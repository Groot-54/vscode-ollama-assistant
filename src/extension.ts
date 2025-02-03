// src/extension.ts
import * as vscode from 'vscode';
import { Ollama } from 'ollama';

const ollama = new Ollama();

interface ChatMessage {
    type: 'user' | 'assistant' | 'error';
    content: string;
    timestamp: number;
    fileContext?: {
        fileName: string;
        language: string;
    };
}

interface ChatSession {
    id: string;
    name: string;
    messages: ChatMessage[];
    createdAt: number;
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new OllamaSidebarProvider(context);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("ollama-chat", provider)
    );

    let startChatDisposable = vscode.commands.registerCommand('ollama-assistant.startChat', () => {
        vscode.commands.executeCommand('workbench.view.extension.ollama-sidebar');
    });

    let newSessionDisposable = vscode.commands.registerCommand('ollama-assistant.newSession', () => {
        provider.createNewSession();
    });

    let clearHistoryDisposable = vscode.commands.registerCommand('ollama-assistant.clearHistory', () => {
        provider.clearHistory();
    });

    context.subscriptions.push(
        startChatDisposable,
        newSessionDisposable,
        clearHistoryDisposable
    );
}

class OllamaSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _sessions: ChatSession[];
    private _currentSessionId: string;

    constructor(private readonly _context: vscode.ExtensionContext) {
        // Initialize sessions array
        this._sessions = this._context.globalState.get('chatSessions', []);
        
        // Create initial session if none exist
        if (this._sessions.length === 0) {
            const initialSession: ChatSession = {
                id: Date.now().toString(),
                name: 'Chat 1',
                messages: [],
                createdAt: Date.now()
            };
            this._sessions.push(initialSession);
            this._currentSessionId = initialSession.id;
            this._context.globalState.update('chatSessions', this._sessions);
        } else {
            // Set current session to the last one
            this._currentSessionId = this._sessions[this._sessions.length - 1].id;
        }
    }

    public async createNewSession() {
        const session: ChatSession = {
            id: Date.now().toString(),
            name: `Chat ${this._sessions.length + 1}`,
            messages: [],
            createdAt: Date.now()
        };
        
        this._sessions.push(session);
        this._currentSessionId = session.id;
        await this._saveSessions();
        this._updateWebview();
    }

    public async clearHistory() {
        this._sessions = [];
        await this.createNewSession();
    }

    private async _saveSessions() {
        await this._context.globalState.update('chatSessions', this._sessions);
    }

    private _getCurrentSession(): ChatSession {
        return this._sessions.find(s => s.id === this._currentSessionId) || this._sessions[0];
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this._updateWebview();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'chat':
                    try {
                        const editor = vscode.window.activeTextEditor;
                        const fileContext = editor ? {
                            fileName: editor.document.fileName.split('/').pop() || '',
                            language: editor.document.languageId
                        } : undefined;

                        // Save user message
                        const userMessage: ChatMessage = {
                            type: 'user',
                            content: data.message,
                            timestamp: Date.now(),
                            fileContext
                        };
                        
                        const currentSession = this._getCurrentSession();
                        currentSession.messages.push(userMessage);
                        await this._saveSessions();
                        
                        // Start streaming response
                        const messageId = Date.now().toString();
                        this._view?.webview.postMessage({
                            type: 'startStream',
                            messageId
                        });

                        let assistantMessage: ChatMessage = {
                            type: 'assistant',
                            content: '',
                            timestamp: Date.now(),
                            fileContext
                        };

                        const stream = await ollama.chat({
                            model: 'deepseek-r1:1.5b',
                            messages: [
                                {
                                    role: 'system',
                                    content: fileContext ? 
                                        `You are a helpful coding assistant. Currently open file: ${fileContext.fileName} (${fileContext.language})` :
                                        'You are a helpful coding assistant.'
                                },
                                ...currentSession.messages
                                    .filter(m => m.type !== 'error')
                                    .map(m => ({
                                        role: m.type === 'user' ? 'user' : 'assistant',
                                        content: m.content
                                    }))
                            ],
                            stream: true
                        });

                        for await (const chunk of stream) {
                            const content = chunk.message.content;
                            assistantMessage.content += content;
                            
                            this._view?.webview.postMessage({
                                type: 'stream',
                                messageId,
                                content
                            });
                        }

                        // Save assistant message
                        currentSession.messages.push(assistantMessage);
                        await this._saveSessions();

                        this._view?.webview.postMessage({
                            type: 'endStream',
                            messageId
                        });

                    } catch (error) {
                        const errorMessage: ChatMessage = {
                            type: 'error',
                            content: 'Error: Failed to communicate with Ollama',
                            timestamp: Date.now()
                        };
                        
                        const currentSession = this._getCurrentSession();
                        currentSession.messages.push(errorMessage);
                        await this._saveSessions();
                        
                        this._view?.webview.postMessage({
                            type: 'error',
                            content: errorMessage.content
                        });
                    }
                    break;

                case 'switchSession':
                    this._currentSessionId = data.sessionId;
                    this._updateWebview();
                    break;
            }
        });
    }

    private _updateWebview() {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview();
        }
    }

    private _getHtmlForWebview() {
        const currentSession = this._getCurrentSession();
        
        return /*html*/`
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        padding: 10px;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        margin: 0;
                    }
                    #session-selector {
                        padding: 5px;
                        margin-bottom: 10px;
                    }
                    #chat-container { 
                        display: flex;
                        flex-direction: column;
                        flex: 1;
                        overflow: hidden;
                    }
                    #messages {
                        flex: 1;
                        overflow-y: auto;
                        margin-bottom: 10px;
                        padding: 10px;
                    }
                    .message {
                        margin: 5px;
                        padding: 8px;
                        border-radius: 5px;
                        white-space: pre-wrap;
                    }
                    .message-timestamp {
                        font-size: 0.8em;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 2px;
                    }
                    .message-context {
                        font-size: 0.8em;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 4px;
                        font-style: italic;
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
                    .typing {
                        opacity: 0.7;
                    }
                    #input-container {
                        padding: 10px;
                        background: var(--vscode-editor-background);
                        border-top: 1px solid var(--vscode-editor-foreground);
                    }
                    .toolbar {
                        display: flex;
                        gap: 10px;
                        padding: 5px;
                        background: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-editor-foreground);
                    }
                </style>
            </head>
            <body>
                <div class="toolbar">
                    <select id="session-selector">
                        ${this._sessions.map(session => `
                            <option value="${session.id}" ${session.id === this._currentSessionId ? 'selected' : ''}>
                                ${session.name}
                            </option>
                        `).join('')}
                    </select>
                    <button id="new-chat-btn">New Chat</button>
                    <button id="clear-history-btn">Clear All</button>
                </div>
                <div id="chat-container">
                    <div id="messages">
                        ${currentSession.messages.map(msg => `
                            <div class="message ${msg.type}-message">
                                <div class="message-timestamp">
                                    ${new Date(msg.timestamp).toLocaleString()}
                                </div>
                                ${msg.fileContext ? `
                                    <div class="message-context">
                                        File: ${msg.fileContext.fileName} (${msg.fileContext.language})
                                    </div>
                                ` : ''}
                                ${msg.content}
                            </div>
                        `).join('')}
                    </div>
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
                    const sessionSelector = document.getElementById('session-selector');
                    const newChatBtn = document.getElementById('new-chat-btn');
                    const clearHistoryBtn = document.getElementById('clear-history-btn');
                    
                    let activeStreams = new Map();

                    // Restore scroll position
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;

                    function addMessage(content, type, fileContext = null) {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = \`message \${
                            type === 'user' ? 'user-message' : 
                            type === 'error' ? 'error-message' : 
                            'assistant-message'
                        }\`;

                        // Add timestamp
                        const timestampDiv = document.createElement('div');
                        timestampDiv.className = 'message-timestamp';
                        timestampDiv.textContent = new Date().toLocaleString();
                        messageDiv.appendChild(timestampDiv);

                        // Add file context if available
                        if (fileContext) {
                            const contextDiv = document.createElement('div');
                            contextDiv.className = 'message-context';
                            contextDiv.textContent = \`File: \${fileContext.fileName} (\${fileContext.language})\`;
                            messageDiv.appendChild(contextDiv);
                        }

                        const contentDiv = document.createElement('div');
                        contentDiv.textContent = content;
                        messageDiv.appendChild(contentDiv);

                        messagesDiv.appendChild(messageDiv);
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                        return contentDiv;
                    }

                    function sendMessage() {
                        const message = userInput.value.trim();
                        if (message) {
                            addMessage(message, 'user');
                            vscode.postMessage({
                                type: 'chat',
                                message: message
                            });
                            userInput.value = '';
                        }
                    }

                    sendButton.addEventListener('click', sendMessage);
                    
                    userInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    });

                    sessionSelector.addEventListener('change', (e) => {
                        vscode.postMessage({
                            type: 'switchSession',
                            sessionId: e.target.value
                        });
                    });

                    newChatBtn.addEventListener('click', () => {
                        vscode.postMessage({ type: 'command', command: 'ollama-assistant.newSession' });
                    });

                    clearHistoryBtn.addEventListener('click', () => {
                        if (confirm('Are you sure you want to clear all chat history?')) {
                            vscode.postMessage({ type: 'command', command: 'ollama-assistant.clearHistory' });
                        }
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'startStream':
                                const messageDiv = addMessage('', 'assistant');
                                messageDiv.classList.add('typing');
                                activeStreams.set(message.messageId, {
                                    element: messageDiv,
                                    content: ''
                                });
                                break;

                            case 'stream':
                                const stream = activeStreams.get(message.messageId);
                                if (stream) {
                                    stream.content += message.content;
                                    stream.element.textContent = stream.content;
                                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
                                }
                                break;

                            case 'endStream':
                                const endingStream = activeStreams.get(message.messageId);
                                if (endingStream) {
                                    endingStream.element.classList.remove('typing');
                                    activeStreams.delete(message.messageId);
                                }
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

export function deactivate() {}

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Chat, Part } from '@google/genai';

// --- TYPE DEFINITIONS ---

// Fix for: Cannot find name 'SpeechRecognition'.
// For browser SpeechRecognition API, provides a minimal interface to satisfy TypeScript.
interface SpeechRecognition {
    stop(): void;
    start(): void;
    interimResults: boolean;
    lang: string;
    onstart: () => void;
    onend: () => void;
    onerror: (event: any) => void;
    onresult: (event: any) => void;
}

interface Message {
    id: string;
    text: string;
    sender: 'user' | 'ai';
    imagePreview?: string;
    videoUrl?: string;
    isLoading?: boolean;
    streamingText?: string;
    isError?: boolean;
}

// --- HELPER COMPONENTS & FUNCTIONS ---

/**
 * A simple markdown renderer that supports bold, italics, and code blocks.
 */
const SimpleMarkdownRenderer = ({ content }: { content: string }) => {
    const parts = content.split(/(\*\*.*?\*\*|\*.*?\*|```[\s\S]*?```)/g);

    return (
        <div>
            {parts.map((part, index) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={index}>{part.slice(2, -2)}</strong>;
                }
                if (part.startsWith('*') && part.endsWith('*')) {
                    return <em key={index}>{part.slice(1, -1)}</em>;
                }
                if (part.startsWith('```') && part.endsWith('```')) {
                    return <pre key={index} className="code-block"><code>{part.slice(3, -3).trim()}</code></pre>;
                }
                return part.split('\n').map((line, i) => (
                    <React.Fragment key={`${index}-${i}`}>
                        {line}
                        {i < part.split('\n').length - 1 && <br />}
                    </React.Fragment>
                ));
            })}
        </div>
    );
};

/**
 * Converts a File object to a GoogleGenerativeAI.Part object.
 */
const fileToGenerativePart = async (file: File): Promise<Part> => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
};

// --- SVG ICONS ---
const SendIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
);

const AttachmentIcon = () => (
     <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
);

const CloseIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
    </svg>
);

const MicrophoneIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/>
    </svg>
);


// --- MAIN APP COMPONENT ---
const App = () => {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'init',
            sender: 'ai',
            text: "Hello! I'm Aura, your multimodal AI assistant. I can chat, understand images, and create videos. Try asking me something, or type `/video a cat playing a futuristic piano` to see what I can do!",
            isLoading: false,
        }
    ]);
    const [input, setInput] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [chat, setChat] = useState<Chat | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<SpeechRecognition | null>(null);

    useEffect(() => {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const newChat = ai.chats.create({ model: 'gemini-2.5-flash' });
            setChat(newChat);
        } catch (e) {
            console.error(e);
            setError("Failed to initialize the AI model. Please check the API key.");
        }
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, messages[messages.length - 1]?.streamingText]);

    const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setImageFile(file);
            setImagePreview(URL.createObjectURL(file));
        }
    };

    const removeImage = () => {
        setImageFile(null);
        setImagePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleToggleRecording = () => {
        if (isRecording) {
            recognitionRef.current?.stop();
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Speech recognition is not supported in this browser.");
            return;
        }

        const recognition: SpeechRecognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => setIsRecording(true);
        recognition.onend = () => setIsRecording(false);
        recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            setIsRecording(false);
        };
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            setInput(prev => prev ? `${prev} ${transcript}` : transcript);
        };

        recognition.start();
    };

    const handleSendMessage = async () => {
        if (isLoading || (!input.trim() && !imageFile)) return;

        setIsLoading(true);
        setError(null);
        const userText = input.trim();

        setMessages(prev => [
            ...prev,
            { id: Date.now().toString(), text: userText, sender: 'user', imagePreview: imagePreview }
        ]);

        setInput('');
        removeImage();

        if (userText.toLowerCase().startsWith('/video ')) {
            await generateVideo(userText.substring(7).trim());
        } else {
            await sendChatMessage(userText, imageFile);
        }

        setIsLoading(false);
    };

    const sendChatMessage = async (prompt: string, file: File | null) => {
        if (!chat) {
            setError("Chat session is not initialized.");
            return;
        }

        const aiMessageId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, { id: aiMessageId, text: '', sender: 'ai', streamingText: '', isLoading: true }]);

        try {
            const parts: Part[] = [];
            if (file) {
                const imagePart = await fileToGenerativePart(file);
                parts.push(imagePart);
            }
            if (prompt) {
                parts.push({ text: prompt });
            }
            
            // Fix for: Object literal may only specify known properties, and 'parts' does not exist in type 'Part | PartUnion[]'.
            // The `message` property should be the array of parts directly, not an object containing parts.
            const result = await chat.sendMessageStream({ message: parts });

            let accumulatedText = "";
            for await (const chunk of result) {
                accumulatedText += chunk.text;
                setMessages(prev => prev.map(msg =>
                    msg.id === aiMessageId ? { ...msg, streamingText: accumulatedText } : msg
                ));
            }

            setMessages(prev => prev.map(msg =>
                msg.id === aiMessageId ? { ...msg, text: accumulatedText, streamingText: undefined, isLoading: false } : msg
            ));
        } catch (e) {
            console.error(e);
            const errorMessage = e instanceof Error ? e.message : "An unknown error occurred.";
            setMessages(prev => prev.map(msg =>
                msg.id === aiMessageId ? { ...msg, text: `Sorry, I ran into an error: ${errorMessage}`, isError: true, isLoading: false } : msg
            ));
        }
    };

    const generateVideo = async (prompt: string) => {
        const aiMessageId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, {
            id: aiMessageId, sender: 'ai', text: `🎬 Preparing to generate video for: "${prompt}"...`, isLoading: true
        }]);

        try {
            if ((window as any).aistudio && !await (window as any).aistudio.hasSelectedApiKey()) {
                setMessages(prev => prev.map(m => m.id === aiMessageId ? {...m, text: 'Please select an API key to generate videos.'} : m));
                await (window as any).aistudio.openSelectKey();
            }

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

            setMessages(prev => prev.map(m => m.id === aiMessageId ? {...m, text: '⏳ Generating your video... This can take a few minutes. Please be patient.'} : m));
            
            let operation = await ai.models.generateVideos({
                model: 'veo-3.1-fast-generate-preview',
                prompt: prompt,
                config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' }
            });

            while (!operation.done) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                operation = await ai.operations.getVideosOperation({ operation: operation });
            }

            if (operation.error) throw new Error(operation.error.message);
            
            const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (!downloadLink) throw new Error("Video generation failed to return a valid URL.");

            const videoUrl = `${downloadLink}&key=${process.env.API_KEY}`;
            
            setMessages(prev => prev.map(m => m.id === aiMessageId ? {
                ...m, text: '✅ Your video is ready!', videoUrl: videoUrl, isLoading: false
            } : m));
        } catch (e) {
            console.error(e);
            // Fix for: Argument of type 'unknown' is not assignable to parameter of type 'string'.
            // Safely convert the unknown error `e` to a string to prevent type errors.
            const errorMessage = e instanceof Error ? e.message : String(e ?? "An unknown error occurred.");
            const userFriendlyError = errorMessage.includes("Requested entity was not found")
                ? `API key error. Please try selecting your key again. For more info, visit ai.google.dev/gemini-api/docs/billing`
                : `Error: ${errorMessage}`;
            setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: userFriendlyError, isLoading: false, isError: true } : m));
        }
    };

    return (
        <>
            <style>{`
                /* --- CSS STYLES --- */
                .chat-container { display: flex; flex-direction: column; height: 100vh; background-color: var(--background); }
                .chat-header { padding: 1rem; background-color: var(--surface); border-bottom: 1px solid var(--border-color); text-align: center; }
                .chat-header h1 { margin: 0; font-size: 1.25rem; }
                .chat-header h1 .ai-name { font-weight: 700; color: var(--primary); }
                .message-list { flex-grow: 1; overflow-y: auto; padding: 1rem; }
                .message-container { display: flex; margin-bottom: 1rem; max-width: 80%; }
                .message-container.user { justify-content: flex-end; margin-left: auto; }
                .message-container.ai { justify-content: flex-start; margin-right: auto; }
                .message-bubble { padding: 0.75rem 1rem; border-radius: 1.25rem; line-height: 1.5; }
                .message-container.user .message-bubble { background-color: var(--primary); color: white; border-bottom-right-radius: 0.25rem; }
                .message-container.ai .message-bubble { background-color: var(--surface); border-bottom-left-radius: 0.25rem; }
                .message-bubble.error { background-color: var(--error); color: white; }
                .avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--primary); margin-right: 0.75rem; display: flex; align-items: center; justify-content: center; font-weight: bold; }
                .loading-dots span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: var(--text-secondary); margin: 0 2px; animation: bounce 1.4s infinite ease-in-out both; }
                .loading-dots span:nth-of-type(1) { animation-delay: -0.32s; }
                .loading-dots span:nth-of-type(2) { animation-delay: -0.16s; }
                @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1.0); } }
                .chat-footer { padding: 1rem; background-color: var(--surface); border-top: 1px solid var(--border-color); }
                .input-area { display: flex; align-items: center; background-color: var(--background); border-radius: 2rem; padding: 0.25rem; border: 1px solid var(--border-color); }
                .input-area:focus-within { border-color: var(--primary); }
                .chat-input { flex-grow: 1; background: transparent; border: none; outline: none; color: var(--text-primary); font-size: 1rem; padding: 0.75rem 1rem; }
                .icon-button { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 0.75rem; display: flex; align-items: center; justify-content: center; transition: color 0.2s ease; }
                .icon-button:hover { color: var(--primary); }
                .icon-button.recording { color: var(--error); }
                .send-button { background-color: var(--primary); color: white; border-radius: 50%; }
                .send-button:hover { background-color: var(--primary-variant); }
                .send-button:disabled { background-color: var(--border-color); cursor: not-allowed; }
                .image-preview { position: relative; margin: 0.5rem; }
                .image-preview img { max-width: 100px; max-height: 100px; border-radius: 0.5rem; }
                .remove-image-btn { position: absolute; top: -5px; right: -5px; background: var(--surface); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 50%; width: 20px; height: 20px; cursor: pointer; display:flex; align-items:center; justify-content:center; }
                .message-video { max-width: 100%; border-radius: 1rem; margin-top: 0.5rem; }
                .message-image-preview { max-width: 200px; border-radius: 1rem; margin-bottom: 0.5rem; }
                .code-block { background-color: #000; color: #f8f82; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; font-family: 'Courier New', Courier, monospace; font-size: 0.9em; margin: 0.5rem 0;}
            `}</style>
            <div className="chat-container">
                <header className="chat-header">
                    <h1>Chat with <span className="ai-name">Aura</span></h1>
                </header>
                <main className="message-list">
                    {messages.map(msg => (
                        <div key={msg.id} className={`message-container ${msg.sender}`}>
                            {msg.sender === 'ai' && <div className="avatar">A</div>}
                            <div className={`message-bubble ${msg.isError ? 'error' : ''}`}>
                                {msg.imagePreview && <img src={msg.imagePreview} alt="User upload preview" className="message-image-preview"/>}
                                {msg.isLoading && !msg.streamingText && !msg.videoUrl && (
                                    msg.text ? <span>{msg.text}</span> : <div className="loading-dots"><span></span><span></span><span></span></div>
                                )}
                                {!msg.isLoading && !msg.streamingText && <SimpleMarkdownRenderer content={msg.text} />}
                                {msg.streamingText && <SimpleMarkdownRenderer content={msg.streamingText + '▌'} />}
                                {msg.videoUrl && <video src={msg.videoUrl} controls className="message-video" />}
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </main>
                <footer className="chat-footer">
                    {imagePreview && (
                        <div className="image-preview">
                            <img src={imagePreview} alt="Preview" />
                            <button onClick={removeImage} className="remove-image-btn"><CloseIcon /></button>
                        </div>
                    )}
                    <div className="input-area">
                        <button className="icon-button" onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
                            <AttachmentIcon />
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handleImageChange} style={{ display: 'none' }} accept="image/*" />
                        
                        <input
                            type="text"
                            className="chat-input"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                            placeholder="Type a message or `/video` prompt..."
                            disabled={isLoading}
                        />

                        <button className={`icon-button ${isRecording ? 'recording' : ''}`} onClick={handleToggleRecording} disabled={isLoading}>
                            <MicrophoneIcon />
                        </button>

                        <button className="icon-button send-button" onClick={handleSendMessage} disabled={isLoading || (!input.trim() && !imageFile)}>
                            <SendIcon />
                        </button>
                    </div>
                </footer>
            </div>
        </>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);

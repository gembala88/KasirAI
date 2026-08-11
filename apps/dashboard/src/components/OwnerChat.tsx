import { useState } from 'react';
import { IconSend } from '@tabler/icons-react';
import { askOwnerChat } from '../lib/api';

interface ChatMessage {
  role: 'owner' | 'hermes';
  text: string;
}

const SUGGESTIONS = [
  'Berapa omzet dan profit hari ini?',
  'Produk apa yang paling laris?',
  'Siapa pelanggan paling aktif?',
  'Ada stok yang hampir habis?',
];

export default function OwnerChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(question: string) {
    if (!question.trim() || sending) {
      return;
    }
    setError(null);
    setMessages((prev) => [...prev, { role: 'owner', text: question }]);
    setInput('');
    setSending(true);
    try {
      const { reply } = await askOwnerChat(question);
      setMessages((prev) => [...prev, { role: 'hermes', text: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="owner-chat">
      <p className="hint">Tanya langsung, dijawab dari data ERPNext nyata — bukan perkiraan.</p>

      <div className="suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => void send(suggestion)}
            disabled={sending}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="chat-log">
        {messages.map((message, index) => (
          <div key={index} className={`chat-message chat-message--${message.role}`}>
            <span className="chat-message-role">
              {message.role === 'owner' ? 'Anda' : 'KasirAI'}
            </span>
            <p>{message.text}</p>
          </div>
        ))}
        {sending && <p className="hint">KasirAI sedang mengecek data…</p>}
        {error && <p className="error-box">Gagal: {error}</p>}
      </div>

      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Tanya soal omzet, stok, pelanggan, dst..."
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <IconSend size={16} /> Kirim
        </button>
      </form>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { newId, STEP_LABELS, type Step } from '../state/schema';
import { addChat, getSetting, listChat, type ChatMessage } from '../storage/db';
import { API_KEY_SETTING } from '../ai/openai';

interface Props {
  step: Step;
  projectId: string;
}

export function ChatBar({ step, projectId }: Props) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const historyEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listChat(projectId).then(setMessages);
    void getSetting<string>(API_KEY_SETTING).then((k) => setHasKey(!!k));
  }, [projectId]);

  useEffect(() => {
    if (expanded) historyEnd.current?.scrollIntoView({ block: 'end' });
  }, [expanded, messages.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const append = async (role: ChatMessage['role'], body: string) => {
    const msg: ChatMessage = { id: newId(), projectId, role, step, text: body, createdAt: Date.now() };
    await addChat(msg);
    setMessages((m) => [...m, msg]);
    return msg;
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    await append('user', body);
    // The agent loop arrives in milestone M5; until then, reply locally.
    const reply = hasKey
      ? 'The assistant isn\'t connected yet. It arrives in a later milestone; your message is saved in this project\'s history.'
      : 'Add your OpenAI API key in App settings to use the assistant.';
    await append('assistant', reply);
    if (!expanded) setToast(reply);
  };

  const grouped = groupByStep(messages);

  return (
    <>
      {expanded && (
        <div className="chat-sheet" role="dialog" aria-label="Assistant history">
          <div className="sheet-head">
            <strong>Assistant</strong>
            <button className="btn ghost" onClick={() => setExpanded(false)}>
              Close
            </button>
          </div>
          <div className="chat-history">
            {messages.length === 0 && <p className="muted">No messages yet. Ask the assistant about this step.</p>}
            {grouped.map(([s, msgs], i) => (
              <section key={i}>
                <div className="chat-step muted small">{STEP_LABELS[s as Step] ?? s}</div>
                {msgs.map((m) => (
                  <div key={m.id} className={`bubble ${m.role}`}>
                    {m.text}
                  </div>
                ))}
              </section>
            ))}
            <div ref={historyEnd} />
          </div>
        </div>
      )}
      {toast && !expanded && (
        <button className="chat-toast" onClick={() => setExpanded(true)}>
          {toast}
        </button>
      )}
      <form
        className="chatbar"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button
          type="button"
          className="btn ghost icon"
          aria-label={expanded ? 'Collapse chat' : 'Expand chat'}
          onClick={() => setExpanded((x) => !x)}
        >
          {expanded ? '⤡' : '⤢'}
        </button>
        {hasKey === false ? (
          <button type="button" className="chat-input chat-nokey" onClick={() => navigate('/settings')}>
            Add your OpenAI key to use the assistant
          </button>
        ) : (
          <input
            className="chat-input"
            placeholder="Ask the assistant…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            enterKeyHint="send"
          />
        )}
        <button type="submit" className="btn primary icon" aria-label="Send" disabled={!text.trim()}>
          ➤
        </button>
      </form>
    </>
  );
}

function groupByStep(messages: ChatMessage[]): [string, ChatMessage[]][] {
  const groups: [string, ChatMessage[]][] = [];
  for (const m of messages) {
    const last = groups.at(-1);
    if (last && last[0] === m.step) last[1].push(m);
    else groups.push([m.step, [m]]);
  }
  return groups;
}

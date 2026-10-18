import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { newId, stepLabel, type Step } from '../state/schema';
import { useProjectStore } from '../state/store';
import { useStagingUI } from '../staging/uiStore';
import { addChat, getSetting, listChat, type ChatMessage } from '../storage/db';
import { API_KEY_SETTING } from '../ai/openai';
import { GEMINI_KEY_SETTING } from '../ai/gemini';
import { captureView, prepareImage, runTurn } from '../ai/agent';
import { suggestionsFor } from '../ai/suggestions';
import { useChatUI } from './chatUI';
import { pickFile } from './download';

interface Props {
  step: Step;
  projectId: string;
  shotId?: string;
}

const HISTORY_FOR_MODEL = 12;

export function ChatBar({ step, projectId, shotId }: Props) {
  const navigate = useNavigate();
  const project = useProjectStore((s) => s.project)!;
  const lastTag = useProjectStore((s) => s.history.past.at(-1)?.tag);
  const { expanded, draft, setExpanded, setDraft } = useChatUI();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [live, setLive] = useState<{ text: string; actions: string[] } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const historyEnd = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // The history sheet reaches the bottom of the screen and keeps its content
  // clear of the bar (and attachment preview) by their measured height, so
  // nothing behind can show through between them.
  const bar = useRef<HTMLFormElement>(null);
  const attachment = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setBarH((bar.current?.offsetHeight ?? 0) + (attachment.current?.offsetHeight ?? 0));
    measure();
    const ro = new ResizeObserver(measure);
    if (bar.current) ro.observe(bar.current);
    if (attachment.current) ro.observe(attachment.current);
    return () => ro.disconnect();
  });

  useEffect(() => {
    void listChat(projectId).then(setMessages);
    void Promise.all([getSetting<string>(API_KEY_SETTING), getSetting<string>(GEMINI_KEY_SETTING)]).then(([o, g]) => setHasKey(!!(o || g)));
  }, [projectId]);

  useEffect(() => {
    if (expanded) historyEnd.current?.scrollIntoView({ block: 'end' });
  }, [expanded, messages.length, live?.text]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => () => controller.current?.abort(), []);

  const save = async (m: Omit<ChatMessage, 'id' | 'projectId' | 'createdAt'>) => {
    const msg: ChatMessage = { id: newId(), projectId, createdAt: Date.now(), ...m };
    await addChat(msg);
    setMessages((list) => [...list, msg]);
    return msg;
  };

  const send = async (textArg?: string) => {
    const text = (textArg ?? draft).trim() || (image ? 'Lay out this set from the image.' : '');
    if (!text || controller.current) return;
    if (!hasKey) {
      navigate('/settings');
      return;
    }
    const sentImage = image;
    setDraft('');
    setImage(null);
    const history = messages
      .filter((m) => !m.error && (m.role === 'user' || m.role === 'assistant'))
      .slice(-HISTORY_FOR_MODEL)
      .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }));
    await save({ role: 'user', step, text, hasImage: !!sentImage });

    const tag = `ai-${newId()}`;
    const actions: string[] = [];
    setLive({ text: '', actions });
    const ac = new AbortController();
    controller.current = ac;
    const store = useProjectStore.getState;
    try {
      const reply = await runTurn({
        text,
        image: sentImage ?? undefined,
        history,
        step,
        shotId,
        getProject: () => store().project!,
        dispatch: (cmd) => store().dispatch({ ...cmd, source: 'ai', tag }),
        stageId: () => useStagingUI.getState().stageId ?? undefined,
        setStage: (id) => useStagingUI.getState().setStage(id),
        navigate,
        snapshot: () => captureView(),
        signal: ac.signal,
        onText: (d) => setLive((l) => (l ? { ...l, text: l.text + d } : l)),
        onAction: (label) => {
          actions.push(label);
          setLive((l) => (l ? { ...l, actions: [...actions] } : l));
        },
      });
      await save({ role: 'assistant', step, text: reply, actions: actions.length ? actions : undefined, tag: actions.length ? tag : undefined });
      if (!useChatUI.getState().expanded) setToast(reply);
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      const text = aborted ? 'Stopped.' : e instanceof Error ? e.message : String(e);
      await save({ role: 'assistant', step, text, error: !aborted, actions: actions.length ? actions : undefined, tag: actions.length ? tag : undefined });
      if (!useChatUI.getState().expanded) setToast(text);
    } finally {
      controller.current = null;
      setLive(null);
    }
  };

  const attach = async () => {
    const file = await pickFile('image/*');
    if (file) setImage(await prepareImage(file));
  };

  const undo = async (m: ChatMessage) => {
    if (!m.tag) return;
    useProjectStore.getState().undoTag(m.tag);
    const updated = { ...m, undone: true };
    await addChat(updated);
    setMessages((list) => list.map((x) => (x.id === m.id ? updated : x)));
  };

  // Requests from buttons elsewhere (Plan blocking / Plan the camera) go through the same path as typing.
  const pending = useChatUI((s) => s.pending);
  useEffect(() => {
    // Wait until we know whether there's a key, or send would go to Settings.
    if (!pending || controller.current || hasKey === null) return;
    useChatUI.setState({ pending: null });
    void send(pending);
  });
  useEffect(() => useChatUI.getState().setRunning(!!live), [live]);

  const suggestions = useMemo(() => suggestionsFor(step, project, !!shotId), [step, project, shotId]);
  const running = !!live;
  const grouped = groupByStep(messages);

  const pick = (s: string) => {
    if (/photo|image/i.test(s)) void attach();
    setDraft(s);
    input.current?.focus();
  };

  return (
    <>
      {expanded && (
        <div className="chat-sheet" role="dialog" aria-label="Assistant" style={barH ? { paddingBottom: barH } : undefined}>
          <div className="sheet-head">
            <strong>Assistant</strong>
            <button className="btn ghost" onClick={() => setExpanded(false)}>
              Close
            </button>
          </div>
          <div className="chat-history">
            {messages.length === 0 && !running && (
              <p className="muted small">
                Ask for changes in plain words. The assistant can see this step and make edits for you, and you can undo anything it does.
              </p>
            )}
            {grouped.map(([s, msgs], i) => (
              <section key={i}>
                <div className="chat-step muted small">{stepLabel(s as Step, project) ?? s}</div>
                {msgs.map((m) => (
                  <div key={m.id} className={`bubble ${m.role} ${m.error ? 'error-bubble' : ''}`}>
                    {m.hasImage && <span className="muted small">📷 image · </span>}
                    {m.text}
                    {m.actions && <Actions actions={m.actions} />}
                    {m.tag && !m.undone && lastTag === m.tag && (
                      <button className="link-btn undo-ai" onClick={() => void undo(m)}>
                        Undo these changes
                      </button>
                    )}
                    {m.undone && <span className="muted small undone"> · undone</span>}
                  </div>
                ))}
              </section>
            ))}
            {live && (
              <div className="bubble assistant">
                {live.text || <span className="typing">Thinking…</span>}
                {live.actions.length > 0 && <Actions actions={live.actions} />}
              </div>
            )}
            <div ref={historyEnd} />
          </div>
          {!running && hasKey && (
            <div className="suggestions-row">
              {suggestions.map((s) => (
                <button key={s} className="chip tag suggestion-chip" onClick={() => pick(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {toast && !expanded && (
        <button className="chat-toast" style={barH ? { bottom: barH + 8 } : undefined} onClick={() => setExpanded(true)}>
          {toast}
        </button>
      )}
      {image && (
        <div className="chat-attachment" ref={attachment}>
          <img src={image} alt="Attached" />
          <button className="btn ghost small-btn" onClick={() => setImage(null)}>
            Remove
          </button>
        </div>
      )}
      <form
        ref={bar}
        className="chatbar"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button type="button" className="btn ghost icon" aria-label={expanded ? 'Collapse chat' : 'Expand chat'} onClick={() => setExpanded(!expanded)}>
          {expanded ? '⤡' : '⤢'}
        </button>
        {hasKey === false ? (
          <button type="button" className="chat-input chat-nokey" onClick={() => navigate('/settings')}>
            Add an OpenAI or Gemini key to use the assistant
          </button>
        ) : (
          <>
            <input
              ref={input}
              className="chat-input"
              placeholder={running ? 'Working…' : 'Ask the assistant…'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => !messages.length && setExpanded(true)}
              enterKeyHint="send"
              disabled={running}
            />
            <button type="button" className="btn ghost icon" aria-label="Attach image" onClick={() => void attach()} disabled={running}>
              📎
            </button>
          </>
        )}
        {running ? (
          <button type="button" className="btn icon stop" aria-label="Stop" onClick={() => controller.current?.abort()}>
            ■
          </button>
        ) : (
          <button type="submit" className="btn primary icon" aria-label="Send" disabled={!draft.trim() && !image}>
            ➤
          </button>
        )}
      </form>
    </>
  );
}

function Actions({ actions }: { actions: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ai-actions">
      <button className="link-btn" onClick={() => setOpen((o) => !o)}>
        {actions.length} {actions.length === 1 ? 'change' : 'changes'} {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul>
          {actions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
    </span>
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

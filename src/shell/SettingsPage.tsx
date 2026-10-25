import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_KEY_SETTING, testOpenAIKey, type KeyCheck } from '../ai/openai';
import { deleteSetting, getSetting, setSetting } from '../storage/db';
import { requestPersistentStorage } from '../storage/projectIO';
import { DEFAULT_TTS_MODEL, TTS_MODEL_SETTING } from '../audio/tts';
import { buildLabel } from '../version';
import { AUTO_CHAT_MODEL_SETTING, CHAT_MODEL_SETTING, PREFERRED_CHAT_MODELS, chatModel as resolveChatModel, openAIChatModels, chosenChatModel } from '../ai/chat';
import { AUTO_GEMINI_MODEL_SETTING, GEMINI_KEY_SETTING, PREFERRED_GEMINI_MODELS, rememberGeminiModels, testGeminiKey } from '../ai/gemini';
import { GEMINI_TTS_MODELS, GEMINI_TTS_MODEL_SETTING, geminiTtsModels } from '../audio/gemini';
import { ComfySettings } from '../comfy/ComfySettings';
import { OpenArtSettings } from '../openart/OpenArtSettings';
import { LetteringFontsSettings } from '../comic/LetteringFontsSettings';

export function SettingsPage() {
  const navigate = useNavigate();
  const [openaiKey, setOpenaiKey] = useState<string | undefined>();
  const [geminiKey, setGeminiKey] = useState<string | undefined>();
  const [openaiModels, setOpenaiModels] = useState<string[] | undefined>();
  const [geminiModels, setGeminiModels] = useState<string[] | undefined>();
  const [ttsModel, setTtsModel] = useState('');
  const [geminiTts, setGeminiTts] = useState('');
  const [geminiTtsOptions, setGeminiTtsOptions] = useState<string[]>(GEMINI_TTS_MODELS);
  const [chatModel, setChatModel] = useState('');
  const [autoModel, setAutoModel] = useState<string | undefined>();
  const [storage, setStorage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null);

  const loadAutoModel = async () => {
    // The automatic choice uses OpenAI when there's an OpenAI key, else Gemini.
    const [o, g] = await Promise.all([getSetting<string>(API_KEY_SETTING), getSetting<string>(GEMINI_KEY_SETTING)]);
    const auto = o ? AUTO_CHAT_MODEL_SETTING : g ? AUTO_GEMINI_MODEL_SETTING : undefined;
    setAutoModel(auto ? (await getSetting<{ model: string }>(auto))?.model : undefined);
  };

  useEffect(() => {
    void getSetting<string>(TTS_MODEL_SETTING).then((m) => setTtsModel(m ?? ''));
    void getSetting<string>(GEMINI_TTS_MODEL_SETTING).then((m) => setGeminiTts(m ?? ''));
    void geminiTtsModels().then(setGeminiTtsOptions);
    void chosenChatModel().then((m) => setChatModel(m ?? ''));
    void loadAutoModel();
    void loadStorage().then(setStorage);
  }, []);

  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  const anyKey = !!(openaiKey || geminiKey);
  // The key's own model lists once they're read, so new models show up without an app update.
  const openaiOptions = openaiKey || !anyKey ? (openaiModels?.length ? openAIChatModels(openaiModels) : PREFERRED_CHAT_MODELS) : [];
  const geminiOptions = geminiKey || !anyKey ? (geminiModels?.length ? geminiModels : PREFERRED_GEMINI_MODELS) : [];
  const custom = chatModel && ![...openaiOptions, ...geminiOptions].includes(chatModel) ? chatModel : undefined;

  return (
    <div className="app">
      <header className="header">
        <div className="header-side">
          <button className="btn ghost icon" aria-label="Back" onClick={() => navigate(-1)}>
            ‹
          </button>
        </div>
        <div className="header-title">
          <strong>Settings</strong>
        </div>
        <div className="header-side right" />
      </header>
      <main className="body">
        <div className="page">
          <section className="panel">
            <h2>OpenAI API key</h2>
            <p className="muted small">
              The assistant, character, stage, prop, and shot images, and dialogue voices use your own OpenAI account. The key is stored only in this browser,
              is sent only to api.openai.com, and is never included in project files.
            </p>
            <KeyField
              setting={API_KEY_SETTING}
              placeholder="sk-…"
              test={testOpenAIKey}
              onKey={setOpenaiKey}
              onModels={setOpenaiModels}
              onSaved={async (k) => {
                // A new key may reach different models: pick the automatic one again.
                await deleteSetting(AUTO_CHAT_MODEL_SETTING);
                await resolveChatModel(k).catch(() => undefined);
              }}
              afterChange={loadAutoModel}
            />
            <label className="field">
              <span>Speech model</span>
              <input
                placeholder={DEFAULT_TTS_MODEL}
                value={ttsModel}
                onChange={(e) => setTtsModel(e.target.value)}
                onBlur={() => void (ttsModel.trim() ? setSetting(TTS_MODEL_SETTING, ttsModel.trim()) : deleteSetting(TTS_MODEL_SETTING))}
              />
            </label>
          </section>

          <section className="panel">
            <h2>Google Gemini API key</h2>
            <p className="muted small">
              The assistant, concept images (Nano Banana) and character voices can use Gemini models from your own Google AI Studio account (get a key at
              aistudio.google.com). Pick a Gemini image model in the image editor, or a Gemini voice for a character. The key is stored only in this browser,
              is sent only to generativelanguage.googleapis.com, and is never included in project files.
            </p>
            <KeyField
              setting={GEMINI_KEY_SETTING}
              placeholder="AIza…"
              test={testGeminiKey}
              onKey={setGeminiKey}
              onModels={(models) => {
                setGeminiModels(models);
                // A fresh list may have a newer model: make it the automatic choice.
                if (models?.length) void rememberGeminiModels(models).then(loadAutoModel);
                // The key's speech models were saved with the list.
                void geminiTtsModels().then(setGeminiTtsOptions);
              }}
              afterChange={loadAutoModel}
            />
            <label className="field">
              <span>Speech model</span>
              <select
                value={geminiTts}
                onChange={(e) => {
                  const m = e.target.value;
                  setGeminiTts(m);
                  void (m ? setSetting(GEMINI_TTS_MODEL_SETTING, m) : deleteSetting(GEMINI_TTS_MODEL_SETTING));
                }}
              >
                <option value="">Automatic (newest)</option>
                {[...new Set([...geminiTtsOptions, ...(geminiTts ? [geminiTts] : [])])].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="panel">
            <h2>Assistant</h2>
            <label className="field">
              <span>Assistant model</span>
              <select
                value={chatModel}
                onChange={(e) => {
                  const m = e.target.value;
                  setChatModel(m);
                  void (m ? setSetting(CHAT_MODEL_SETTING, m) : deleteSetting(CHAT_MODEL_SETTING));
                }}
              >
                <option value="">Automatic{autoModel ? ` (${autoModel})` : ''}</option>
                {openaiOptions.length > 0 && (
                  <optgroup label="OpenAI">
                    {openaiOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                  </optgroup>
                )}
                {geminiOptions.length > 0 && (
                  <optgroup label="Google Gemini">
                    {geminiOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                  </optgroup>
                )}
                {custom && <option value={custom}>{custom}</option>}
              </select>
            </label>
            <p className="muted small">Automatic uses OpenAI when an OpenAI key is saved, and Gemini otherwise.</p>
          </section>

          <ComfySettings />
          <OpenArtSettings />
          <LetteringFontsSettings />

          <section className="panel">
            <h2>Storage</h2>
            {storage ? (
              <p className="small">
                Using {formatBytes(storage.used)} of about {formatBytes(storage.quota)}.{' '}
                {storage.persisted ? 'Storage is marked persistent.' : 'The browser may clear this storage if space runs low.'}
              </p>
            ) : (
              <p className="muted small">Storage details aren't available in this browser.</p>
            )}
            {storage && !storage.persisted && (
              <button className="btn" onClick={async () => {
                await requestPersistentStorage();
                setStorage(await loadStorage());
              }}>
                Ask to keep storage
              </button>
            )}
            {!standalone && (
              <p className="muted small">
                On iPhone and iPad, Safari can delete website data after about a week without use. Add ShotByShot to
                your Home Screen (Share → Add to Home Screen) to keep projects safe, and save project files as backups.
              </p>
            )}
          </section>
          <VersionSection />
        </div>
      </main>
    </div>
  );
}

async function loadStorage() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { used: usage, quota, persisted };
}

/** Save, test, and forget one provider's API key. */
function KeyField({ setting, placeholder, test, onKey, onModels, onSaved, afterChange }: {
  setting: string;
  placeholder: string;
  test: (key: string) => Promise<KeyCheck>;
  onKey: (key: string | undefined) => void;
  onModels: (models: string[] | undefined) => void;
  /** Runs after a new key passes its test, before it is saved. */
  onSaved?: (key: string) => Promise<void>;
  afterChange: () => Promise<void>;
}) {
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState<string | undefined>();
  const [check, setCheck] = useState<KeyCheck | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void getSetting<string>(setting).then(async (k) => {
      setSavedKey(k);
      onKey(k);
      // Read the saved key's models quietly, so the picker lists what it can use today.
      if (k) {
        const result = await test(k).catch(() => undefined);
        if (result?.ok) onModels(result.models);
      }
    });
  }, [setting]);

  const runTest = async (k: string) => {
    setTesting(true);
    const result = await test(k);
    setTesting(false);
    setCheck(result);
    onModels(result.models);
    return result;
  };

  const saveKey = async () => {
    const k = key.trim();
    if (!k) return;
    if (!(await runTest(k)).ok) return;
    await onSaved?.(k);
    await setSetting(setting, k);
    setSavedKey(k);
    onKey(k);
    setKey('');
    await afterChange();
  };

  const forgetKey = async () => {
    await deleteSetting(setting);
    setSavedKey(undefined);
    onKey(undefined);
    onModels(undefined);
    setCheck(null);
    await afterChange();
  };

  return (
    <>
      {savedKey ? (
        <div className="row gap">
          <code className="grow">{maskKey(savedKey)}</code>
          <button className="btn" disabled={testing} onClick={() => void runTest(savedKey)}>
            Test
          </button>
          <button className="btn danger" onClick={forgetKey}>
            Forget
          </button>
        </div>
      ) : (
        <form
          className="row gap"
          onSubmit={(e) => {
            e.preventDefault();
            void saveKey();
          }}
        >
          <input className="grow" type="password" autoComplete="off" placeholder={placeholder} value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn primary" disabled={!key.trim() || testing}>
            {testing ? 'Checking…' : 'Save'}
          </button>
        </form>
      )}
      {check && <p className={check.ok ? 'ok small' : 'error small'}>{check.message}</p>}
    </>
  );
}

function maskKey(k: string): string {
  return k.length <= 8 ? '••••' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function VersionSection() {
  const [status, setStatus] = useState<string | null>(null);
  const check = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return setStatus("Updates aren't available in this browser.");
    setStatus('Checking…');
    try {
      await reg.update();
    } catch {
      return setStatus("Couldn't check. Are you offline?");
    }
    setStatus(reg.installing || reg.waiting ? 'A new version is ready. Tap Update in the banner at the top.' : "You're on the latest version.");
  };
  return (
    <section className="panel">
      <h2>Version</h2>
      <p>
        Build <code>{buildLabel()}</code>
      </p>
      <button className="btn" onClick={() => void check()}>
        Check for updates
      </button>
      {status && <p className="muted small">{status}</p>}
    </section>
  );
}

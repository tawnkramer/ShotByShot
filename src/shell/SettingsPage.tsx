import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_KEY_SETTING, testOpenAIKey, type KeyCheck } from '../ai/openai';
import { deleteSetting, getSetting, setSetting } from '../storage/db';
import { requestPersistentStorage } from '../storage/projectIO';
import { DEFAULT_TTS_MODEL, TTS_MODEL_SETTING } from '../audio/tts';

export function SettingsPage() {
  const navigate = useNavigate();
  const [key, setKey] = useState('');
  const [savedKey, setSavedKey] = useState<string | undefined>();
  const [check, setCheck] = useState<KeyCheck | null>(null);
  const [testing, setTesting] = useState(false);
  const [ttsModel, setTtsModel] = useState('');
  const [storage, setStorage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null);

  useEffect(() => {
    void getSetting<string>(API_KEY_SETTING).then(setSavedKey);
    void getSetting<string>(TTS_MODEL_SETTING).then((m) => setTtsModel(m ?? ''));
    void loadStorage().then(setStorage);
  }, []);

  const saveKey = async () => {
    const k = key.trim();
    if (!k) return;
    setTesting(true);
    const result = await testOpenAIKey(k);
    setTesting(false);
    setCheck(result);
    if (result.ok) {
      await setSetting(API_KEY_SETTING, k);
      setSavedKey(k);
      setKey('');
    }
  };

  const forgetKey = async () => {
    await deleteSetting(API_KEY_SETTING);
    setSavedKey(undefined);
    setCheck(null);
  };

  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;

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
              The assistant and dialogue voices use your own OpenAI account. The key is stored only in this browser,
              is sent only to api.openai.com, and is never included in project files.
            </p>
            {savedKey ? (
              <div className="row gap">
                <code className="grow">{maskKey(savedKey)}</code>
                <button className="btn" disabled={testing} onClick={async () => {
                  setTesting(true);
                  setCheck(await testOpenAIKey(savedKey));
                  setTesting(false);
                }}>
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
                <input
                  className="grow"
                  type="password"
                  autoComplete="off"
                  placeholder="sk-…"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button className="btn primary" disabled={!key.trim() || testing}>
                  {testing ? 'Checking…' : 'Save'}
                </button>
              </form>
            )}
            {check && <p className={check.ok ? 'ok small' : 'error small'}>{check.message}</p>}
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

function maskKey(k: string): string {
  return k.length <= 8 ? '••••' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

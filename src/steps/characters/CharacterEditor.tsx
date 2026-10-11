import { ZoomableImage } from '../../images/ImagePreview';
import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { AGE_BANDS, BUILDS, POSES, SEXES, type Character, type PoseId } from '../../state/schema';
import { useProjectStore } from '../../state/store';
import { deleteCharacter, firstLineOf, heightLabel, TINTS, updateCharacter, type CharacterPatch } from '../../characters/commands';
import { buildMannequin } from '../../three/mannequin';
import { disposeObject } from '../../three/materials';
import { OPENAI_VOICES } from '../../audio/voices';
import { DEFAULT_TTS_MODEL, playBlob, speakWithBrowser, stopPlayback, synthesizeSpeech, TTS_MODEL_SETTING } from '../../audio/tts';
import { getSetting } from '../../storage/db';
import { API_KEY_SETTING } from '../../ai/openai';
import { CharacterImageEditor } from './CharacterImageEditor';
import { useBlobUrl } from '../../images/useBlobUrl';
import { Slider } from '../staging/fields';

const LABELS: Record<string, string> = {
  female: 'Female', male: 'Male', other: 'Other', slim: 'Slim', average: 'Average', heavy: 'Heavy',
  standing: 'Stand', sitting: 'Sit', walking: 'Walk', leaning: 'Lean', lying: 'Lie',
};

export function CharacterEditor({ character: c, onBack }: { character: Character; onBack: () => void }) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const project = useProjectStore((s) => s.project)!;
  const [imageEditor, setImageEditor] = useState(false);
  const [showImage, setShowImage] = useState(true);
  // Opening a character or saving new artwork returns to its concept image.
  useEffect(() => setShowImage(true), [c.id, c.image?.blob]);
  const imageUrl = useBlobUrl(c.image?.blob);
  const [pose, setPose] = useState<PoseId>('standing');
  const update = (patch: CharacterPatch, mergeKey?: string) => dispatch(updateCharacter(c.id, patch, mergeKey));

  return (
    <div className="split">
      <div className="viewport">
        {showImage && imageUrl ? <ZoomableImage className="character-artwork" src={imageUrl} alt={`Concept artwork for ${c.name}`} /> : <MannequinView character={c} pose={pose} />}
        {imageUrl && <button className="btn character-view-toggle" onClick={() => setShowImage(!showImage)}>{showImage ? '3D mannequin' : 'Character image'}</button>}
        <div className="viewport-badge">{heightLabel(c.heightCm)}</div>
        <div className="viewport-toolbar" hidden={showImage && Boolean(imageUrl)}>
          <div className="segmented compact">
            {POSES.map((p) => (
              <button key={p} className={pose === p ? 'on' : ''} aria-pressed={pose === p} onClick={() => setPose(p)}>
                {LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="split-panel">
        <div className="row gap panel-head">
          <button className="btn ghost small-btn" onClick={onBack}>
            ‹ All characters
          </button>
        </div>
        <div className="inspector">
          <button className="btn" onClick={() => setImageEditor(true)}>{c.image ? 'View / generate character image' : 'Generate character image'}</button>
          <label className="field">
            <span>Name</span>
            <input
              key={c.id}
              defaultValue={c.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== c.name) update({ name });
              }}
            />
          </label>

          <Choice label="Sex" options={SEXES} value={c.sex} onChange={(sex) => update({ sex })} />
          <Slider label="Height" value={c.heightCm} min={90} max={220} step={1} format={heightLabel} onChange={(heightCm) => update({ heightCm }, `height:${c.id}`)} />
          <Choice label="Build" options={BUILDS} value={c.build} onChange={(build) => update({ build })} />

          <label className="field">
            <span>Age</span>
            <select value={c.ageBand ?? ''} onChange={(e) => update({ ageBand: (e.target.value || undefined) as Character['ageBand'] })}>
              <option value="">Not set</option>
              {AGE_BANDS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>

          <Attributes values={c.attributes} onChange={(attributes) => update({ attributes })} />

          <div className="field">
            <span>Color marker</span>
            <div className="swatches">
              <button className={`swatch none ${!c.tint ? 'on' : ''}`} aria-label="No color" onClick={() => update({ tint: undefined })} />
              {TINTS.map((t) => (
                <button key={t} className={`swatch ${c.tint === t ? 'on' : ''}`} style={{ background: t }} aria-label={`Color ${t}`} onClick={() => update({ tint: t })} />
              ))}
            </div>
          </div>

          <VoiceEditor character={c} previewText={firstLineOf(project, c) ?? `Hi, I'm ${c.name}.`} onChange={(voice, mergeKey) => update({ voice }, mergeKey)} />

          <button
            className="btn danger"
            onClick={() => {
              if (!window.confirm(`Delete ${c.name}? You can undo this.`)) return;
              dispatch(deleteCharacter(c.id));
              onBack();
            }}
          >
            Delete character
          </button>
        </div>
      </div>
      {imageEditor && <CharacterImageEditor character={c} onClose={() => setImageEditor(false)} />}
    </div>
  );
}

function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="segmented">
        {options.map((o) => (
          <button key={o} className={value === o ? 'on' : ''} aria-pressed={value === o} onClick={() => onChange(o)}>
            {LABELS[o] ?? o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Attributes({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setText('');
  };
  return (
    <div className="field">
      <span>Notes</span>
      {values.length > 0 && (
        <div className="type-buttons">
          {values.map((v) => (
            <button key={v} className="chip tag" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              {v} ×
            </button>
          ))}
        </div>
      )}
      <form
        className="row gap"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="grow" placeholder="e.g. limps, wears a hat" value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="done" />
        <button className="btn" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

function VoiceEditor({ character: c, previewText, onChange }: { character: Character; previewText: string; onChange: (v: Character['voice'], mergeKey?: string) => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const voice = c.voice;
  useEffect(() => () => stopPlayback(), []);

  const preview = async () => {
    setStatus(null);
    const apiKey = await getSetting<string>(API_KEY_SETTING);
    if (!apiKey) {
      const ok = speakWithBrowser(previewText, voice, c.sex);
      setStatus(ok ? 'Playing with the browser\'s voice. Add an OpenAI key in Settings to hear the real voice.' : 'Add an OpenAI key in Settings to hear voices.');
      return;
    }
    setBusy(true);
    try {
      const model = (await getSetting<string>(TTS_MODEL_SETTING)) || DEFAULT_TTS_MODEL;
      await playBlob(await synthesizeSpeech({ apiKey, model, voice, text: previewText }));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field voice">
      <span>Voice</span>
      <div className="row gap">
        <select className="grow" value={voice.voiceId} onChange={(e) => onChange({ ...voice, provider: 'openai', voiceId: e.target.value })}>
          {OPENAI_VOICES.map((v) => (
            <option key={v} value={v}>
              {v[0].toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
        <button className="btn" disabled={busy} onClick={preview}>
          {busy ? '…' : '▶ Preview'}
        </button>
      </div>
      <Slider label="Speed" value={voice.speed} min={0.5} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => onChange({ ...voice, speed }, `speed:${c.id}`)} />
      <input
        key={`style-${c.id}`}
        placeholder="Speaking style, e.g. gravelly, tired, Irish accent"
        defaultValue={voice.instructions ?? ''}
        onBlur={(e) => {
          const instructions = e.target.value.trim() || undefined;
          if (instructions !== voice.instructions) onChange({ ...voice, instructions });
        }}
      />
      <p className="muted small">Preview: “{previewText.length > 80 ? previewText.slice(0, 80) + '…' : previewText}”</p>
      {status && <p className="small muted">{status}</p>}
    </div>
  );
}

function MannequinView({ character: c, pose }: { character: Character; pose: PoseId }) {
  const [interacted, setInteracted] = useState(false);
  const h = c.heightCm / 100;
  return (
    <Canvas
      className="viewport-canvas"
      shadows="percentage"
      dpr={[1, 2]}
      frameloop={interacted ? 'demand' : 'always'}
      camera={{ position: [1.6, 1.3, 3.6], fov: 35 }}
      onPointerDown={() => setInteracted(true)}
    >
      <color attach="background" args={['#2b2b30']} />
      <hemisphereLight args={['#ffffff', '#55555c', 1.1]} />
      <directionalLight position={[3, 6, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.25} />
      </mesh>
      <Grid args={[10, 10]} cellSize={0.25} sectionSize={1} cellColor="#45454c" sectionColor="#5c5c66" fadeDistance={12} infiniteGrid position={[0, 0.001, 0]} />
      <Figure character={c} pose={pose} />
      <OrbitControls makeDefault target={[0, h * 0.5, 0]} autoRotate={!interacted} autoRotateSpeed={1.2} minDistance={1} maxDistance={10} maxPolarAngle={Math.PI / 2 - 0.02} />
    </Canvas>
  );
}

function Figure({ character: c, pose }: { character: Character; pose: PoseId }) {
  const model = useMemo(() => buildMannequin(c, pose), [c.heightCm, c.sex, c.build, c.tint, pose]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => disposeObject(model), [model]);
  return <primitive object={model} />;
}

import { useEffect, useMemo, useState } from 'react';
import { Overlay } from '../../shell/Overlay';
import { pickFile } from '../../shell/download';
import { prepareUpload } from '../../images/upload';
import { readPhotoLens } from '../../pose/exif';
import { findPeople, preloadDetector, type FoundPerson } from '../../pose/detect';
import { matchPhoto } from '../../pose/solveCamera';
import { bodyPosition } from '../../shots/body';
import { applyPhotoMatch } from '../../shots/commands';
import { frameAspect, type EffectiveShot } from '../../shots/setup';
import { keyOf } from '../../shots/timing';
import { renderShotAt } from '../../shots/thumbnail';
import { emptyHistory, runCommand } from '../../state/commands';
import type { Project, Shot } from '../../state/schema';
import { useProjectStore } from '../../state/store';

interface Photo {
  url: string;
  width: number;
  height: number;
  lens35?: number;
  people: FoundPerson[];
}

interface Props {
  project: Project;
  shot: Shot;
  eff: EffectiveShot;
  /** The key being edited: the match goes there. */
  editKey: 'start' | 'end';
  /** The character selected in the shot, matched by default. */
  characterId?: string | null;
  onClose: () => void;
}

/**
 * Match photo: pick a photo of a person, and the shot copies their pose onto
 * a character and/or the photo's framing onto the camera. Detection runs on
 * this device (MediaPipe); the photo is not kept.
 */
export function MatchPhotoSheet({ project, shot, eff, editKey, characterId, onClose }: Props) {
  const dispatch = useProjectStore((s) => s.dispatch);
  const aspect = frameAspect(project, shot);
  const actors = eff.setup.actors.filter((a) => project.characters.some((c) => c.id === a.characterId));
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personIndex, setPersonIndex] = useState(0);
  const [who, setWho] = useState(() => actors.find((a) => a.characterId === characterId)?.characterId ?? actors[0]?.characterId);
  const [matchPose, setMatchPose] = useState(true);
  const [matchCamera, setMatchCamera] = useState(true);
  const [lens, setLens] = useState<number | undefined>();
  const [opacity, setOpacity] = useState(0.5);
  const [preview, setPreview] = useState<string | null>(null);

  // The detector is ~30 MB the first time: start fetching it while the photo is chosen.
  useEffect(() => preloadDetector(), []);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const pick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    setBusy('Finding people in the photo…');
    setError(null);
    try {
      // The lens is in the original's EXIF, which scaling drops.
      const lens35 = await readPhotoLens(file);
      const blob = await prepareUpload(file);
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      const people = await findPeople(bitmap);
      bitmap.close?.();
      if (!people.length) throw new Error("No one found in this photo. Try one that shows a person's shoulders and hips.");
      setPhoto({ url: URL.createObjectURL(blob), ...size, lens35, people });
      setPersonIndex(0);
      setLens(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const which = editKey;
  const cameraKey = eff.camera.mode === 'moving' ? which : 'start';
  const actor = actors.find((a) => a.characterId === who);
  const character = project.characters.find((c) => c.id === who);
  const result = useMemo(() => {
    if (!photo || !actor || !character) return null;
    const stage = project.stages.find((s) => s.id === eff.stageId);
    return matchPhoto({
      person: photo.people[personIndex],
      photo,
      character,
      key: keyOf(actor.motion, which),
      base: (k) => bodyPosition(stage, eff.setup.stageOverrides, character, k),
      aspect,
      matchPose,
      matchCamera,
      lens,
    });
  }, [photo, personIndex, actor, character, project.stages, eff, which, aspect, matchPose, matchCamera, lens]);

  const change = result && actor && (matchPose || result.camera)
    ? applyPhotoMatch(shot.id, actor.characterId, which, { key: matchPose ? result.key : undefined, camera: result.camera, cameraKey })
    : null;

  useEffect(() => {
    if (!change) return setPreview(null);
    let live = true;
    const [after] = runCommand(project, emptyHistory(), change);
    void renderShotAt(after, shot.id, which).then((url) => live && setPreview(url));
    return () => { live = false; };
  }, [result, matchPose]); // eslint-disable-line react-hooks/exhaustive-deps

  const crop = result?.crop;
  const lensShown = Math.round(lens ?? result?.camera?.lens ?? 35);

  return (
    <Overlay>
      <div className="scrim" onClick={onClose} />
      <div className="sheet match-photo" role="dialog" aria-label="Match photo">
        <div className="sheet-head">
          <strong>Match photo</strong>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        {!photo && <p className="muted small">Pose a character like the person in a photo, frame the camera like the photo, or both. The photo is read on this device and not kept.</p>}
        <button className="btn" onClick={() => void pick()} disabled={!!busy}>{photo ? 'Choose another photo' : 'Choose a photo'}</button>
        {busy && <p className="muted small" role="status">{busy}</p>}
        {error && <p className="error small">{error}</p>}

        {photo && (
          <>
            {photo.people.length > 1 && (
              <div className="field">
                <span>Who to match</span>
                <div className="photo-people">
                  <img src={photo.url} alt="Your photo" />
                  {photo.people.map((p, i) => (
                    <button
                      key={i}
                      className={i === personIndex ? 'on' : ''}
                      aria-label={`Person ${i + 1}`}
                      aria-pressed={i === personIndex}
                      style={{ left: `${p.box.x * 100}%`, top: `${p.box.y * 100}%`, width: `${p.box.w * 100}%`, height: `${p.box.h * 100}%` }}
                      onClick={() => setPersonIndex(i)}
                    />
                  ))}
                </div>
              </div>
            )}
            {actors.length > 1 && (
              <label className="field">
                <span>Character</span>
                <select value={who} onChange={(e) => setWho(e.target.value)}>
                  {actors.map((a) => <option key={a.characterId} value={a.characterId}>{project.characters.find((c) => c.id === a.characterId)!.name}</option>)}
                </select>
              </label>
            )}
            <label className="row gap small check-row"><input type="checkbox" checked={matchPose} onChange={(e) => setMatchPose(e.target.checked)} /> Pose {character?.name ?? 'the character'} like the photo</label>
            <label className="row gap small check-row"><input type="checkbox" checked={matchCamera} onChange={(e) => setMatchCamera(e.target.checked)} /> Frame the camera like the photo</label>

            {!result && <p className="error small">Couldn't see this person's shoulders and hips. Try another photo.</p>}
            {result && (
              <>
                <div className="match-preview" style={{ aspectRatio: String(aspect) }}>
                  {preview && <img src={preview} alt="The shot with the match" />}
                  {crop && (
                    <div
                      className="match-photo-layer"
                      aria-hidden
                      style={{
                        opacity,
                        backgroundImage: `url(${photo.url})`,
                        backgroundSize: `${100 / crop.w}% ${100 / crop.h}%`,
                        backgroundPosition: `${crop.w < 1 ? (crop.x / (1 - crop.w)) * 100 : 0}% ${crop.h < 1 ? (crop.y / (1 - crop.h)) * 100 : 0}%`,
                      }}
                    />
                  )}
                </div>
                <label className="field">
                  <span>Photo over the shot</span>
                  <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Photo opacity" />
                </label>
                {matchCamera && !photo.lens35 && (
                  <label className="field">
                    <span>Lens {lensShown} mm{lens === undefined ? ' (estimated: the photo doesn’t say)' : ''}</span>
                    <input type="range" min={12} max={200} step={1} value={lensShown} onChange={(e) => setLens(Number(e.target.value))} aria-label="Lens" />
                  </label>
                )}
                {result.warnings.map((w) => <p key={w} className="muted small">{w}</p>)}
              </>
            )}
            <button
              className="btn primary"
              disabled={!change}
              onClick={() => {
                dispatch(change!);
                onClose();
              }}
            >
              Apply
            </button>
          </>
        )}
      </div>
    </Overlay>
  );
}

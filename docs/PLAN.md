# ShotByShot — Product & Technical Plan

A mobile-first shot-building and previs web app. Import a script, break it into
shots, block out stages, characters, and props in grey-box 3D, frame and stage
each shot, play back the whole sequence with spoken dialogue, and export an MP4.

The app is a **fully static site hosted on GitHub Pages**. There is no backend:
projects live in the browser's storage, and can be exported to and imported
from a single project file. The AI assistant calls the provider's API
**directly from the browser with the user's own API key** (OpenAI first).

An AI agent is available at every step through a chat bar fixed to the bottom of
the screen. It can see what you see (scene snapshots) and act on the project
through the same commands the UI uses, so all its actions can be undone.

---

## 0. Decisions so far

| Topic | Decision |
|---|---|
| Hosting | Static site on **GitHub Pages**. No App Engine for v1 (§4.5 covers when that would change). |
| Storage | **IndexedDB** in the browser + **export/import project file** (`.sbs.zip`; plain `.json` also supported) |
| AI provider | **Bring your own key**, **OpenAI** first, behind a provider adapter so others (Anthropic, Gemini, …) can be added later |
| Done button | In the header's top-right slot (where Next normally is) |
| Character motion | Yes, simple: **start and end keyframe** per character per shot, interpolated (same model as the camera) |
| Collaboration | Single user only for now |
| Script import | Plain text (Fountain conventions are understood but not required) |
| Aspect ratios | All common film ratios (2.39, 2.20, 2.00, 1.85, 1.66, 1.43, 1.37:1), TV 4:3, **16:9**, **YouTube Short 9:16**; set per project |
| Publishing | Repo goes public when ready; the site lives at `tawnkramer.github.io/ShotByShot/` (no custom domain) |
| Audio | **Text-to-speech** for dialogue, voice per character, included in previs and the MP4 |
| Comics | Same app, same project format: a project's **medium** is `film` or `comic`. Comics swap timing, audio and video for panels, pages and lettering (§13) |

---

## 1. Workflow overview

```
Story → Staging → Characters → Props → Shots → Previs → Export
```

| Step | Purpose | Primary output |
|---|---|---|
| **Story** | Import script, classify lines, break into shots | `ScriptLine[]`, `Shot[]` (line ranges) |
| **Staging** | Build N grey-box sets from primitives, props, imported models | `Stage[]` |
| **Characters** | Define people: name, attributes, height, sex, voice → mannequin | `Character[]` |
| **Props** | Import or AI-model props for the shots | `Prop[]` (asset library) |
| **Shots** | Card list of shots; edit each shot's blocking, motion, camera, timing | `Shot.setup`, `Shot.camera`, `Shot.duration` |
| **Previs** | Play all shots in sequence with a scrubber and audio | (review only) |
| **Export** | Render MP4; optional start/end PNG per shot; save project file | `.mp4`, `.zip` of PNGs, `.sbs.zip` |

Steps are not locked: the header stepper lets you jump back to any earlier step.
**Next** only moves forward. Each step shows a warning, not a block, when its
inputs are incomplete (for example, Shots with no stage assigned).

A **Projects** home screen (before Story) lists the projects stored in this
browser, with New, Open file, Duplicate, Delete, and Export.

---

## 2. App shell (shared by every step)

```
┌──────────────────────────────────────────┐
│ ‹  Story ● ○ ○ ○ ○ ○ ○            [Next] │  fixed header (safe-area aware)
├──────────────────────────────────────────┤
│                                          │
│          step body (scrolls)             │  only this step's UI and controls
│                                          │
├──────────────────────────────────────────┤
│ [⤢]  Ask the assistant…        [📎] [➤]  │  fixed chat bar
└──────────────────────────────────────────┘
```

- **Header (fixed):** back chevron on the left, step name and progress dots
  (tap to jump between steps), **Next** at top right. In the Shot editor, Next is
  replaced by **Done** in the same position. Overflow menu (⋯): Undo/Redo, Save
  project file, Settings (API key, model, aspect ratio).
- **Body:** the only scroll container. 3D steps (Staging, Shot editor, Previs)
  use a fixed-height canvas region plus a scrolling panel underneath, so touch
  gestures on the canvas never fight page scroll (`touch-action: none` on the
  canvas).
- **Chat bar (fixed):** text field, attach button (image / file), send button,
  expand button.
  - *Collapsed:* one line. The latest agent reply appears briefly as a toast above
    the bar.
  - *Expanded:* full-screen sheet with the history for the whole project, grouped
    by step. Swipe down or tap ⤡ to collapse.
  - No API key yet: the bar shows "Add your OpenAI key to use the assistant"
    and opens Settings. Everything else in the app works without a key.
  - Keyboard handling: position the bar with the `visualViewport` API so it stays
    above the iOS/Android soft keyboard.
- **Agent context:** each message is sent with the current step, the selection,
  a compact JSON of the relevant state, and optionally a canvas snapshot. The
  agent only gets the tools for the current step (§6).
- **Undo/redo:** every UI edit and every agent action goes through one command
  bus (§5).

---

## 3. Step-by-step design

### 3.1 Story

**Import**
- Accepts `.txt` (and `.fountain`, which is plain text), or pasted text.
- Each non-empty line becomes a `ScriptLine` with a stable id.

**Classify.** Each line gets one type:
`title · description · character · dialogue · action · scene · camera`

1. **Heuristic pass, instant.** Uses Fountain-style conventions:
   - `INT.` / `EXT.` / `INT./EXT.` → `scene`
   - All-caps short line, optionally with `(V.O.)` or `(O.S.)` → `character`
   - A line after a `character` line or a parenthetical → `dialogue`
   - `CUT TO:`, `CLOSE ON`, `ANGLE ON`, `WIDE`, `POV`, `PAN`, `TRACKING` → `camera`
   - First block before any scene heading → `title` / `description`
   - Everything else → `action`
2. **AI refine pass** (needs a key). The agent reviews the lines in batches of
   about 200 and returns corrections with a confidence score for each.
   Low-confidence lines get a highlight in the UI.
3. **Manual fix.** Tap a line's colored type chip to cycle its type, or long-press
   it for the full list. You can multi-select lines to bulk-assign a type.

**Shot breakdown**
- If the script has explicit shot breaks (camera lines, `CUT TO:`), those are
  used.
- Otherwise a **Breakdown preference** control sets the density:
  - *One shot per line:* every dialogue or action line starts a shot.
  - *Per two lines:* consecutive lines are paired, but a shot never crosses a
    scene boundary.
  - *Mixed (default with a key):* the AI decides. Dialogue exchanges get grouped
    (shot / reverse-shot), action sequences get split more finely (about one beat
    per shot), and establishing shots are inserted at scene starts. Without a
    key, a heuristic version of Mixed is used.
- UI: the script is shown as a list with horizontal shot dividers. Tap between
  two lines to add or remove a break. Shot numbers (1, 2, 3… or 1A, 1B within a
  scene) are shown in the gutter.

**Next → Staging** becomes available once at least one shot exists.

### 3.2 Staging

Defines **N stages**, which are reusable sets. A scene heading
(`INT. BAR – NIGHT`) suggests a stage. The agent can create stages from scene
headings ("Create stages for all scenes").

**Layout**
- Stage picker as a horizontal chip row: `+ New`, `Bar`, `Alley`, …
- 3D viewport in the top ~55% of the body, with an inspector and object list
  underneath that scrolls.

**Rendering:** greyscale only. `MeshStandardMaterial` in a range of greys, one
hemisphere light plus one shadow-casting directional light, a ground grid, and
optional outlines for readability on a small screen.

**Built-in library** (procedural, parametric, no downloads):
`table, chair, door, window, bar, stool, bottle, mug`, plus basic primitives
(`box, cylinder, sphere, cone, plane, wall`). Walls and floor get a "room" helper
(width × depth × height, with optional openings).

**Add menu:** `Library item` · `Primitive` · `Import (OBJ / glTF / GLB)` ·
`From image (AI)`.
- Imports use `OBJLoader` and `GLTFLoader` (+ `DRACOLoader`, decoder bundled
  with the site). Imported models are normalized: centered, placed on the
  ground, scaled to a sensible size, and converted to grey materials. The
  original file is stored as a blob in IndexedDB.

**Direct manipulation**
- Tap an object to select it (raycast). The selection gets an outline.
- Floating toolbar: **Move · Rotate · Scale · Duplicate · Delete · Snap**.
- `TransformControls` gizmo with large mobile hit targets. Snapping on by default
  (0.1 m, 15°).
- Camera: one-finger orbit, two-finger pan, pinch to zoom. While a gizmo drag is
  active, the camera controls are disabled.

**AI helper**
- Natural language, for example "put a bar along the back wall, 4 stools in front,
  door on the left", "make the table round and 20% bigger", "rotate the chair to
  face the window".
- **Image → layout:** attach a photo or sketch. The vision model returns a list
  of objects with approximate positions, sizes, and rotations in a room frame.
  This becomes a single undoable "AI layout" command that you then refine.
- The agent gets a scene snapshot (canvas image) together with the scene JSON, so
  it can check its own work.

### 3.3 Characters

- A card per character: **Name**, **Sex** (M/F/Other → proportions preset),
  **Height** (cm or ft/in), **Build** (slim/average/heavy), **Age band**,
  free-form **Attributes** (tags or notes: "limps", "wears hat"), and **Voice**
  (TTS voice + speed, with a ▶ preview button).
- Character names are auto-populated from `character` lines in the Story step.
- **Mannequin:** a parametric figure built from capsules and spheres
  (head, torso, pelvis, upper/lower arms and legs). Proportions are driven by
  height, sex, and build.
  - **Eyes:** two small dark spheres. **Nose:** a small sphere or cone. Together
    they make facing direction obvious at a glance.
  - Each character gets a slight tint or colored base ring, so you can tell
    characters apart in a grey world. The tint can be turned off.
  - Pose presets: standing, sitting, leaning, lying, walking.
- Small turntable preview per character card. The full editor shows a larger
  viewport.
- The agent can create characters from the script ("make characters from the
  script with plausible heights and voices").

### 3.4 Props

- The project's prop library: library items, imports, and AI-modeled props. These
  are also usable in Staging.
- A grid of prop thumbnails. Tap one for a 3D viewer with rotate/zoom and name and
  default-scale fields.
- Suggestions: the agent scans the action lines for nouns ("gun", "phone",
  "briefcase") and proposes a prop list.
- **AI modeling on the fly:** the agent outputs a **primitive composition**
  (a tree of box, cylinder, sphere, cone, torus, lathe-profile, and extrude-path
  nodes, each with a transform), not code. The client builds it as a three.js
  `Group`. This is safe (no code execution), small, editable, and serializable.
  Iterate in chat: "make the handle longer".
- Props can be attached to a character's hand or head socket in shot setups.

### 3.5 Shots

**List page**
- One large card per shot, scrolled vertically. A thumbnail in the project's
  aspect ratio fills the width; details sit below it: shot #, stage,
  characters, duration, camera type (fixed/animated), and the first line of
  dialogue or action.
- Tap a card to open the **Shot editor**.
- **Long-press (≈500 ms)** opens an action sheet:
  - **Merge with shot below:** combines line ranges and sums durations. The
    setup is kept from the upper shot.
  - **Split shot (by dialogue):** shows the shot's lines with tap-to-place split
    points between dialogue lines. Each new shot copies the setup.
  - Duplicate, delete, insert a new shot after this one.
- Thumbnails are rendered offscreen with a single shared `WebGLRenderer` and
  cached as blobs in IndexedDB. They are re-rendered when the shot changes.
  This avoids running one WebGL context per card.

**Shot editor**
- Top: a viewport through the shot camera, letterboxed to the project's aspect
  ratio, with an optional rule-of-thirds overlay. Captions are shown on the
  lower third. For 9:16, the viewport is tall and the panel below is shorter.
- Mode switch: **Blocking** | **Camera**.
- **Blocking mode**
  - Pick the stage (defaults to the stage of the shot's scene).
  - Add characters and props to the shot, and move, rotate, and pose them with
    the same gizmo toolbar as Staging.
  - **Motion:** each character (and prop) has a **Static / Moving** toggle. In
    Moving mode, **Start** and **End** buttons store its transform (and,
    optionally, pose) at each end. The figure is interpolated between them over
    the shot: position is lerped, rotation is slerped, and an optional "walk"
    pose plays while it moves. A ghost figure shows the end position while you
    edit the start, and a dotted path joins the two.
  - Shot setups store **overrides** on top of the stage (for example, a chair
    moved for this shot only), not a full copy of the stage. Toggle:
    "apply change to stage" or "this shot only".
- **Camera mode**: one large on-screen camera gizmo, sized for the thumb:
  - **Orbit (azimuth):** horizontal drag on the ring
  - **Elevation:** vertical drag on the ring
  - **Zoom (dolly distance):** pinch, or a vertical slider
  - **FOV:** lens slider shown in mm (12–200 mm, 35mm equivalent), with presets
  - **Pan:** two-finger drag on the viewport, which moves the look-at target
  - Optional roll and "look at character" snap.
  - **Fixed / Animated** toggle. In Animated mode, **Start** and **End** keyframe
    buttons store a full camera state (target, azimuth, elevation, distance, fov,
    roll). Playback interpolates between them with ease-in-out. Azimuth uses the
    shortest arc; distance is interpolated in log space.
- **Timing:** a duration field and a small timeline. The default duration is
  the length of the shot's generated TTS audio plus padding. Before audio
  exists, it is estimated (~2.7 words/s + 0.5 s; action lines ~2 s each).
- **Captions and dialogue audio:** each dialogue line gets a TTS clip in the
  speaker's voice. Clips are laid out in order on the shot timeline, and the
  caption for a line is shown while its clip plays. In/out handles let you add
  pauses or overlap lines. **Regenerate audio** re-runs TTS when the line text
  or voice changes. Without a key, captions are timed by word count and the
  shot plays silently (or with the browser's built-in voice for preview only;
  see §7).
- **Play / pause / loop** for the shot.
- **Done** saves, regenerates the thumbnail, and returns to the Shots list (or
  to Previs if you came from there).
- AI in the shot: "frame a medium close-up on Sam over Alex's shoulder", "push in
  slowly to Sam", "Alex walks from the door to the bar stool". The agent gets
  helper tools such as `frameSubjects(ids, shotSize, angle)` so it doesn't have
  to compute raw camera math.

### 3.6 Previs

- One viewport plus a full-width **scrubber**. Shot boundaries are marked as
  ticks, with shot numbers above them.
- Play, pause, step to the previous or next shot, and loop. Dialogue audio plays
  in sync, scheduled with the Web Audio API against the timeline clock.
- The timeline is the shots in order. Each shot has an offset equal to the sum of
  the previous durations. Seeking finds the shot, loads its setup into the scene
  (cached per stage), and evaluates the camera and character motion at its
  local time.
- When paused, a **shot info panel** shows the shot number, stage, characters,
  lines, and an **Edit shot** button. Tapping it goes to the Shot editor, and
  Done returns here at the same timecode.
- Captions are shown here as well.

### 3.7 Export

- Settings: resolution (720p / 1080p on the long side, in the project's aspect
  ratio), fps (24 / 25 / 30), captions on/off, shot-number burn-in on/off,
  audio on/off.
- **MP4:** rendered in the browser, frame by frame and deterministically (not in
  real time):
  - **Video:** for each frame, set the time → render to an offscreen canvas →
    composite the captions on a 2D canvas → create a `VideoFrame` → encode with
    `VideoEncoder` (H.264).
  - **Audio:** mix all TTS clips into one track with an `OfflineAudioContext`,
    then encode with `AudioEncoder` (AAC).
  - Both tracks are muxed with **mp4-muxer**. A progress bar with cancel. The
    file is downloaded, or shared via the Web Share API on mobile.
  - Fallback where WebCodecs (or the AAC encoder) is unavailable: real-time
    capture with `MediaRecorder` (canvas stream + Web Audio stream). The result
    is WebM or MP4, depending on the browser.
- **Stills:** a checkbox for "PNG start frame per shot", with an optional "+ end
  frame (animated shots)". Zipped with `fflate` and named
  `S012_start.png` and `S012_end.png`.
- **Project file:** "Save project file" is also available here (see §4.3).
- Optional extra: a shot-list PDF or CSV (thumbnail, number, lines, camera
  notes).

---

## 4. Architecture

### 4.1 Can this be a static GitHub Pages site? Yes.

Every requirement can be met in the browser:

| Need | How it works without a server |
|---|---|
| 3D, gizmos, playback | three.js / WebGL. Always client-side. |
| Saving projects | IndexedDB, plus project file export/import |
| AI assistant | The OpenAI API accepts requests from browsers (it sends CORS headers), so the app calls it directly with the user's key |
| Text-to-speech | OpenAI's speech endpoint, called from the browser; clips cached in IndexedDB |
| MP4 export | WebCodecs + mp4-muxer in the browser |
| Deploy | GitHub Actions builds with Vite and publishes to GitHub Pages |

What a static site gives up, and why that's acceptable for now:
- **No cross-device sync and no share links.** Use the project file instead (it
  can be AirDropped, emailed, or kept in a cloud drive).
- **Storage can be evicted.** See §4.3 for how to reduce the risk.
- **No server-side render fallback.** Only matters if browser export proves
  unreliable on target devices.
- **The API key lives in the browser.** That is inherent to bring-your-own-key
  and fine here, because it's the user's own key on their own device (§4.4).

### 4.2 Overview

```
┌──────────────── Browser (installable PWA, served from GitHub Pages) ────────────────┐
│ React + TS + Vite                                                                   │
│  ├ Zustand store (project state) ── Command bus (undo/redo, AI ops)                 │
│  ├ react-three-fiber + drei (three.js)                                              │
│  ├ IndexedDB: projects, assets (GLB/OBJ/images), TTS audio, thumbnails, chat        │
│  ├ Agent loop + provider adapter ───────────────► api.openai.com (user's key)       │
│  ├ TTS client ──────────────────────────────────► api.openai.com/v1/audio/speech    │
│  └ WebCodecs + mp4-muxer (export), fflate (zips)                                    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Storage

- **IndexedDB** via `idb`. Object stores:
  - `projects`: project JSON (script, shots, stages, characters, props, settings)
  - `blobs`: content-addressed binaries (SHA-256 key): imported models,
    reference images, TTS clips, thumbnails
  - `chat`: agent history per project
  - `settings`: API key, model choices, UI preferences
- Autosave: each command marks the project dirty, and a debounced write (~500 ms)
  persists it. On launch, the last project is reopened.
- **Persistence:** call `navigator.storage.persist()` on first save. Show
  storage usage from `navigator.storage.estimate()` in Settings.
  - iOS Safari can delete site data for websites that haven't been used for
    about 7 days. **Installing the app to the Home Screen avoids this**, so the
    app prompts for it after the first project is created. It also reminds you
    to save a project file if the last export is old.
- **Project file:** `MyFilm.sbs.zip` containing `project.json` plus an
  `assets/` folder (models, images, audio). Zip rather than one JSON blob,
  because base64-encoded models and audio would bloat it by a third and be slow
  to parse on phones. A **plain `.json` export** (no assets, or with
  small assets inlined) is also offered for diffing or hand editing.
  - `project.json` carries a `schemaVersion`. Imports run migrations and are
    validated with Zod.
  - On desktop Chrome/Edge, the File System Access API allows "Save" to the same
    file again. Elsewhere, Save downloads a new file (or opens the share sheet).
- TTS clips can be dropped from the project file to keep it small, and are
  regenerated on demand.

### 4.4 API keys and security

- The key is entered in Settings, stored in IndexedDB on this device only, and
  sent only to the provider's API. It is never included in project files.
  "Forget key" removes it.
- Strict Content Security Policy via a `<meta>` tag (GitHub Pages can't set
  headers): `connect-src 'self' https://api.openai.com`, no inline scripts, and
  no third-party scripts. All libraries are bundled at build time, so no CDN code
  can read the key.
- Imported files are treated as data: models are only parsed by the loaders,
  and AI-generated props are data (primitive trees), never code.
- Settings shows a short note: the key is stored in this browser, and usage is
  billed to the user's OpenAI account.

### 4.5 When App Engine (or another backend) would be needed

Keep the code ready for a backend by putting storage and AI behind interfaces
(`ProjectStore`, `LLMProvider`, `TTSProvider`). Add a backend only if one of
these becomes a requirement:
- Cross-device sync or share links. Lighter options come first: sync to the
  user's Google Drive, Dropbox, or a GitHub Gist from the browser.
- Real-time collaboration.
- A shared, paid key (instead of bring-your-own-key) with per-user quotas.
- Server-side rendering for devices that can't encode MP4 (that would be a
  Cloud Run job rather than App Engine).

### 4.6 Frontend stack

| Concern | Choice | Why |
|---|---|---|
| Framework | React 18 + TypeScript + Vite | Ecosystem, r3f |
| 3D | three.js via **@react-three/fiber**, **@react-three/drei** | `TransformControls`, `CameraControls`, `Outlines`, `useGLTF` |
| State | **Zustand** + **Immer** | Simple, works well with patch-based undo |
| Routing | React Router with **HashRouter** | GitHub Pages has no SPA fallback; hash URLs avoid 404s on refresh |
| Styling | CSS modules + CSS variables | Mobile-first, `env(safe-area-inset-*)` |
| Gestures | `@use-gesture/react` | Long-press, pinch, and drag on the camera gizmo and cards |
| Storage | `idb` | Small wrapper over IndexedDB |
| Validation | **Zod** | Project file import, agent tool arguments |
| AI | `openai` JS SDK (browser mode) or plain `fetch` | Streaming, tool calls, vision, TTS |
| Export | WebCodecs, `mp4-muxer`, `fflate` | MP4 and zips in the browser |
| PWA | `vite-plugin-pwa` | Installable, works offline (except AI/TTS) |
| Deploy | GitHub Actions → GitHub Pages | Push to `main` deploys |

Performance on mobile: cap `devicePixelRatio` at 2, use low-poly procedural
geometry, share geometries and materials, render on demand
(`frameloop="demand"`) outside playback, and use one shared offscreen renderer
for thumbnails.

---

## 5. Data model (TS / Zod)

```ts
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
type Transform = { position: Vec3; rotation: Quat; scale: Vec3 };

type LineType = 'title'|'description'|'character'|'dialogue'|'action'|'scene'|'camera';
type AspectRatio = '2.39:1' | '2.20:1' | '2.00:1' | '1.85:1' | '1.66:1' | '1.43:1' | '1.37:1' | '4:3' | '16:9' | '9:16';

interface Project {
  schemaVersion: number; id: string; name: string;
  aspect: AspectRatio; fps: number;
  script: ScriptLine[]; shots: Shot[]; stages: Stage[];
  characters: Character[]; props: Prop[];
  createdAt: number; updatedAt: number;
}

interface ScriptLine {
  id: string; index: number; text: string;
  type: LineType; confidence?: number;
  speakerId?: string;          // for dialogue → Character.id
  sceneId?: string;            // nearest preceding scene line
}

interface Shot {
  id: string; number: string;  // "12" or "4B"
  lineIds: string[];           // contiguous range
  stageId?: string;
  setup: ShotSetup;
  camera: ShotCamera;
  durationSec: number;
  dialogue: DialogueCue[];
  thumbBlob?: string; updatedAt: number;
}

interface Keyframed<T> { mode: 'static'|'moving'; start: T; end?: T; easing: 'linear'|'easeInOut' }

interface ShotSetup {
  actors: { characterId: string;
            motion: Keyframed<{ transform: Transform; pose: PoseId }>;
            walkCycle?: boolean; attachments?: Attachment[] }[];
  props:  { propId: string; motion: Keyframed<{ transform: Transform }> }[];
  stageOverrides: Record<string /*stageObjectId*/, Partial<Transform> & { hidden?: boolean }>;
}

interface CameraState {
  target: Vec3; azimuth: number; elevation: number;   // radians
  distance: number; fovDeg: number; roll: number;
}
type ShotCamera = Keyframed<CameraState>;              // 'static' = fixed camera

interface DialogueCue {
  lineId: string; speakerId?: string; text: string;
  inSec: number; outSec: number;
  audioBlob?: string;          // TTS clip (content hash), regenerated if text/voice changes
  audioKey?: string;           // hash of (text, voice, speed) to detect staleness
}

interface Stage { id: string; name: string; sceneLineIds: string[]; objects: StageObject[]; }
interface StageObject {
  id: string; name: string; transform: Transform;
  source: { kind: 'library'; item: LibraryItem; params?: Record<string, number> }
        | { kind: 'primitive'; shape: PrimitiveShape; params?: Record<string, number> }
        | { kind: 'asset'; blob: string; format: 'obj'|'gltf'|'glb' }
        | { kind: 'composite'; nodes: PrimitiveNode[] }; // AI-modeled
  grey?: number;               // 0..1 shade
}

interface Character {
  id: string; name: string; sex: 'male'|'female'|'other';
  heightCm: number; build: 'slim'|'average'|'heavy'; ageBand?: string;
  attributes: string[]; tint?: string;
  voice: { provider: 'openai'|'browser'; voiceId: string; speed: number; instructions?: string };
}

interface Prop { id: string; name: string; source: StageObject['source']; defaultScale: number; }
```

Character motion and camera motion share the same `Keyframed<T>` type and the
same interpolation code.

### Command bus

Every mutation is a `Command { type, payload, inverse }` that is applied with
Immer patches. Commands give us:
- undo/redo for the UI and the agent alike,
- dirty tracking for autosave,
- an agent audit trail ("AI moved Chair 2 · Undo").

---

## 6. AI agent design

**Provider:** OpenAI first, through a small `LLMProvider` interface
(`chat(messages, tools, {stream, images})`). Other providers (Anthropic, Gemini)
can be added later as adapters. Model names are settings, not hard-coded:
- **Chat model** for interactive turns (fast and cheap).
- **Heavy model** for one-shot jobs: full-script classification, breakdown,
  image → layout.
- **TTS model and voices** for dialogue.
- Settings has a "Test key" button that makes a tiny request and lists the
  models the key can use.

**Loop (runs entirely in the browser):**
1. The user sends a message. The app builds the system prompt (app overview +
   step-specific guide + coordinate conventions: meters, Y-up, −Z is "into the
   room"), adds a compact JSON of the relevant state, an optional canvas
   snapshot, and **only that step's tools**.
2. The response streams into the chat bar. When the model calls a tool, the app
   validates the arguments with Zod, applies them as a Command, and sends back a
   tool result (success, new ids, and optionally a fresh snapshot). The loop
   continues until the model stops calling tools (with a max-iterations guard).
3. Chat history is stored per project. Older turns are summarized to keep
   requests small.
4. Errors (bad key, quota, rate limit, offline) are shown in the chat with a
   clear next step.

**Tools by step** (JSON Schema generated from Zod):

| Step | Tools |
|---|---|
| Story | `classifyLines(updates[])`, `setShotBreaks(lineIds[], rationale)`, `assignSpeaker(lineId, name)` |
| Staging | `createStage(name, sceneLineIds?)`, `addObject(stageId, source, transform)`, `updateObject(id, partialTransform)`, `removeObject(id)`, `layoutFromImage(stageId, objects[])`, `getSnapshot(viewpoint?)` |
| Characters | `createCharacter(...)`, `updateCharacter(id, patch)`, `setVoice(id, voice)` |
| Props | `createCompositeProp(name, nodes[])`, `updateCompositeProp(id, nodes[])`, `suggestProps()` |
| Shot editor | `placeActor(characterId, transform, pose, which:'start'|'end')`, `setActorMotion(characterId, mode)`, `placeProp(...)`, `setCamera(state, which)`, `frameSubjects(ids, shotSize, angle, side)`, `setCameraMode(mode)`, `setDuration(sec)`, `getSnapshot()` |
| Shots list / Previs | `mergeShots(id)`, `splitShot(id, atLineIds[])`, `setStage(shotIds[], stageId)`, `navigateToShot(id)` |

- `frameSubjects` is computed in the app: it takes a bounding box, a shot size
  (ECU/CU/MCU/MS/MWS/WS/EWS), an angle (eye/high/low/OTS), and the aspect ratio,
  and solves for the camera distance from the FOV. This keeps the model away
  from trigonometry.
- Relative placement helpers (`nextTo`, `facing`, `onTopOf`) do the same for
  blocking.
- **Image → layout:** the image is sent to the model along with the library
  catalogue (names plus default dimensions). The prompt asks for a top-down plan:
  room size first, then objects in room coordinates.

---

## 7. Text-to-speech

- **Primary:** the OpenAI speech endpoint, called from the browser with the
  user's key. Each character has a voice, a speed, and optional style
  instructions (where the model supports them).
- Clips are cached in IndexedDB by `hash(text, voice, speed, instructions)`, so
  they are only regenerated when something changes. A "Generate all dialogue"
  button in Shots fills in missing clips in one go, with a progress bar.
- Shot durations update to fit the audio, unless you've set a duration by hand
  (locked durations show a lock icon).
- **No-key fallback:** the browser's built-in `speechSynthesis` for previewing in
  the editor and Previs. It can't be captured into a file reliably, so exports
  made without generated clips are silent (with captions). The Export screen
  says so.
- Parentheticals such as `(whispering)` are passed as voice instructions and
  removed from the spoken text and captions.

---

## 8. Repository layout

```
/
├─ src/
│  ├─ shell/            # Header, ChatBar, ChatSheet, Stepper, Settings
│  ├─ steps/            # projects/ story/ staging/ characters/ props/ shots/ previs/ export/
│  ├─ three/            # library builders, mannequin, camera rig, interpolation, renderer pool
│  ├─ state/            # store, commands, autosave, schema + migrations
│  ├─ storage/          # IndexedDB, project file import/export
│  ├─ ai/               # provider adapters, agent loop, tool registry, prompts
│  ├─ audio/            # TTS client, clip cache, mixer
│  └─ export/           # WebCodecs encoder, png zip
├─ public/              # icons, manifest, Draco decoder
├─ tests/
├─ docs/PLAN.md
├─ .github/workflows/deploy.yml   # build + publish to GitHub Pages
├─ vite.config.ts                  # base: '/ShotByShot/'
└─ package.json
```

---

## 9. Delivery milestones

| # | Milestone | Scope | Exit criteria |
|---|---|---|---|
| **M0** | Skeleton | Vite app, GitHub Pages deploy, PWA, app shell (header / body / chat bar), routing, Projects home, IndexedDB autosave, project file export/import, Settings with API key | Deployed shell on a phone; create, reload, export, and re-import a project |
| **M1** | Story | Import, heuristic classifier, line-type editing, deterministic breakdown modes | Paste script → shots exist |
| **M2** | 3D core | r3f viewport, grey render style, library items, primitives, selection + gizmo toolbar, OBJ/GLB import, multiple stages | Build a bar set by hand on mobile |
| **M3** | Characters & Props | Mannequin generator, character editor, prop library | Characters render with facing cues |
| **M4** | Shots | Shots list + thumbnails, shot editor blocking, character start/end motion, camera gizmo, fixed/animated camera, aspect ratios, captions, playback, merge/split | Edit and play a shot with a moving character and camera |
| **M5** | Agent | OpenAI adapter, browser agent loop, chat sheet, Story + Staging tools; then Characters, Props, Shot tools; snapshots; image → layout | "Build a bar with 4 stools" works and can be undone |
| **M6** | Audio | TTS per character, clip cache, durations from audio, Web Audio playback | Shots speak their dialogue |
| **M7** | Previs | Sequence timeline, scrubber, synced audio, info panel, jump-to-edit round trip | Watch the whole cut with sound |
| **M8** | Export | WebCodecs MP4 with audio, MediaRecorder fallback, PNG stills zip | 2-minute previs → MP4 on iPhone and Android |
| **M9** | Polish | Install prompt, storage warnings, performance passes, onboarding, sample project | Beta |

The agent (M5) can start in parallel with M2 once the command bus exists. Story
AI tools only depend on M1.

---

### Progress

- **M0 done:** app shell, Projects home, IndexedDB autosave, undo/redo, project
  file save/open, project and app settings, Pages deploy workflow.
- **M1 done:** text import (file, paste, or sample), instant line labelling with
  review highlights, tap-to-cycle and long-press line editing, multi-select
  relabel/delete, three breakdown modes, tap-between-lines cuts, scene-based
  shot numbers. The AI refine pass and AI "Mixed" breakdown arrive with the
  agent (M5); until then Mixed uses the rules below.
- **M2 done:** Staging with a three.js viewport (grey materials, soft shadows,
  grid), stage chips (one stage per script location, or blank), the built-in
  set pieces (table, chair, door, window, bar, stool, bottle, mug, wall, room)
  and shapes, OBJ / glTF / GLB import (stored in IndexedDB, normalized to the
  floor, unit-guessed, greyed), tap to select, Move / Rotate / Scale gizmo with
  snapping, duplicate / delete, and an inspector for position, rotation, scale,
  size parameters, and shade. New objects are placed clear of existing ones.
  Slider drags are one undo step. Image → layout is part of the agent (M5).
- **M3 (Characters) done:** add characters from script cues (most lines
  first) or by hand; name, sex, height (cm and ft/in), build, age, notes,
  color marker, and voice (OpenAI voice, speed, speaking style). Preview plays
  the character's first line with OpenAI speech, or the browser's voice
  without a key. Characters are jointed mannequins (pelvis → spine → neck →
  head, shoulder → elbow, hip → knee) with eyes, a nose, and a colored floor
  ring with a notch toward the front. Five pose presets: stand, sit, walk,
  lean, lie. Card thumbnails come from one shared offscreen renderer.
- **M3 (Props) done:** a project prop library. Props mentioned in action
  lines are suggested (envelope, glass, phone, gun, knife, bag, …). New
  library props: glass, phone, envelope, book, briefcase, bag, laptop, lamp,
  pistol, knife (plus bottle and mug). Props can also be shapes or imported
  models. The prop viewer shows real size, a 175 cm person for scale, scale
  and size sliders, shade, and "place on a stage". Staging's Add sheet lists
  the project's props first. Placed copies remember which prop they came
  from. The **composite** format (a list of boxes, cylinders, spheres, cones
  and tori) is in the schema and renderer, ready for the assistant to model
  props in M5.
- **M4 done:** Shots.
  - **List:** one large card per shot with a thumbnail through the shot camera
    (rendered lazily, one at a time, by the shared offscreen renderer), stage,
    cast, duration, camera type and first line. Long-press to merge with the
    shot below or split (cuts suggested before each new speaker).
  - **Defaults:** until a shot is edited, its stage comes from its scene, its
    cast from its speakers and characters named in action, placed clear of
    set pieces; characters carry over from the previous shot on the same
    stage; the camera frames a lone speaker from in front (slightly off-axis)
    or the whole group; duration is estimated from the lines. The first edit
    saves these defaults with the change.
  - **Editor** (`/p/:id/shots/:shotId`, **Done** in the header): shot view or
    free view (with a camera marker); Blocking tab to place, turn and pose
    characters and props, add/remove them, and hide or move set pieces for
    this shot only; Start/End keyframes (editing End makes things move,
    with a walk cycle when they cover ground); Camera tab with the whole frame
    as a gesture pad (drag to orbit and tilt, pinch to dolly, two fingers to
    pan), Fixed/Moving, shot sizes (EWS…ECU) on everyone or one character,
    and sliders for lens (mm), distance, orbit, tilt, height and roll;
    timeline with play, scrub, and length (typed lengths lock; Auto unlocks);
    lower-third captions timed across the shot.
  - `ShotRig` builds and poses a shot at any moment; the editor, thumbnails,
    and later Previs and Export all use it.
- **M7 (Previs) done, ahead of M6 (Audio):** the whole film in one player.
  Shots are laid end to end (`shots/sequence.ts`); one rig re-syncs as
  playback crosses each cut. Scrub bar with a band and label per shot,
  previous/next shot, play/pause (tap the frame, or Space on desktop), loop,
  running time. Paused: the shot's number, stage, cast and script lines, and
  **Edit shot**, whose Done returns to Previs at the same moment. A list of
  all shots below jumps to any of them and follows playback.
- **M6 (Audio) done:** dialogue voiced with OpenAI speech, one request per
  line in the speaker's voice; parentheticals become delivery notes
  ("Deliver this quietly."). Clips are stored as blobs (so they travel in
  project files) and recorded per line with a signature of voice, speed,
  style and text: changing any of those marks just the affected lines as
  needing new audio. A shared job voices lines three at a time with
  progress and cancel, saving as it goes; it keeps running across steps.
  Once every line in a shot is voiced, the shot's length and captions follow
  the real clips (lead-in, clip, short gap, tail); otherwise word-count
  timing is used and the shot stays silent. Playback in the shot editor and
  Previs schedules clips on the Web Audio clock, unlocked on the Play tap
  for iOS, and restarts with a loop. Status panels on Shots, the shot
  editor and Previs.
- **M8 (Export) done:** with Mediabunny (the successor to mp4-muxer) on top
  of WebCodecs. `FilmRenderer` draws any moment of the film offscreen
  (frame-exact, not real time) and burns in captions and optional shot
  numbers; frames go through `CanvasSource`. Dialogue is mixed with an
  `OfflineAudioContext` into one stereo track. Codecs: H.264 + AAC where
  available, falling back to HEVC/VP9/AV1 and Opus, with a note when the
  result may not open in QuickTime; no encoder means a clear message.
  720p/1080p on the long side (even dimensions), 24/25/30 fps, progress,
  cancel, an in-page preview, and Save (share sheet on phones). Stills:
  the first frame of every shot, plus the last frame of shots that move, as
  PNGs in a zip (S01A_start.png). The project file can be saved here too.
  Known limits: the audio mix is held in memory (fine for a previs of a
  few minutes, heavy for very long films); no MediaRecorder fallback yet.
- **M5 (Assistant) done:** OpenAI chat completions with tool calling,
  streamed, from the browser with the user's key. The model is picked
  automatically from the key's models (gpt-5-mini first) and can be set in
  Settings. Each step offers its own tools: Story (relabel lines, set shot
  breaks, breakdown modes, edit lines), Staging (create/select stages,
  add/update/remove objects, snapshot), Characters (add/update with voices),
  Props (add library props, **model_prop** from shapes), Shots (in the editor:
  place characters with "face", props, frame_camera by shot size and angle,
  set_camera, fixed/moving, duration, stage, snapshot; in the list: merge,
  split, voice dialogue), plus go_to_step and open_shot everywhere. The
  model sees a compact, name-based description of the current step that's
  refreshed after its own changes; snapshots of the 3D view and attached
  photos are sent as images. Arguments are validated with zod (schemas also
  generate the tool JSON), and errors go back to the model to correct.
  Everything it changes is tagged per reply: the chat lists the changes and
  offers **Undo these changes**. Suggestions per step; "✨ Check" in Story and
  "✨ Model with AI" in Props open the chat ready to go.
- **Shot numbering** is a project setting (Project settings → Shot numbers):
  **scene.shot** (12.1, 12.2; default), **slate** (12, 12A, 12B, skipping I
  and O), **previs/VFX** (SQ120_SH0010 in tens; shots keep their numbers and
  splits take a number in the gap, e.g. SH0015), and **sequential** (1, 2, 3).
  Scene numbers come from numbered headings in the script ("12 INT. CAFE -
  DAY 12", "12A. EXT. …", Fountain "#12A#"), otherwise they count up from the
  last number. Older projects switch to scene.shot when opened.

**Mixed (rule-based) breakdown:** action lines get one shot each, except that a
scene's establishing shot can carry one short follow-up action line. A speaker
continuing stays in the same shot, and two short lines in a row (8 words or
fewer each) play as one two-shot. Otherwise the shot cuts on each new speaker.
A short camera heading ("ANGLE ON MAYA") starts the shot it directs. A
descriptive camera line ("CLOSE ON the envelope. A police seal.") is a shot of
its own. Transitions ("CUT TO:") end the shot before them.

## 10. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| iOS evicting browser storage | Prompt to install to the Home Screen, `storage.persist()`, reminders to save a project file |
| Gizmo usability on small touch screens | Big custom handles, axis-lock buttons in the toolbar, numeric inspector fallback, snapping |
| Multiple WebGL contexts (iOS limit ~8–16) | One live renderer per page + one offscreen thumbnail renderer; thumbnails stored as images |
| WebCodecs / AAC encoder gaps on some browsers | Feature-detect; MediaRecorder fallback; test on current iOS Safari and Android Chrome early (M8 spike can be pulled forward) |
| Model spatial reasoning errors | High-level helper tools (`frameSubjects`, `nextTo`, `facing`), snapshot feedback, everything undoable |
| Large scripts vs. context limits | Chunked classification, summarized history |
| API key exposure | Key only in IndexedDB, strict CSP, no third-party scripts, never in project files |
| Large project files (models, audio) | Zip format, content-addressed dedupe, option to drop TTS clips |
| API cost surprises for users | Show estimated calls for bulk jobs (classify script, generate all dialogue) before running |

---

## 11. Testing strategy

- **Unit (Vitest):** classifier heuristics, breakdown modes, merge/split,
  caption and audio timing, keyframe interpolation (camera and characters),
  `frameSubjects` math, command inverses, project file round trip and
  migrations.
- **Schema tests:** every agent tool's sample payloads validate against Zod.
- **Agent evals:** a small fixture set (scripts, stage requests, images) scored
  for classification accuracy and placement sanity (no overlaps, objects on the
  floor). Run manually with a key; not in CI.
- **E2E (Playwright, mobile viewport emulation):** import → breakdown → stage
  → shot → previs → export happy path, with the AI provider mocked.
- **Visual regression:** golden thumbnails for library items and the mannequin.

---

## 12. Deployment

- `.github/workflows/deploy.yml` builds, tests, and publishes `dist/` to GitHub
  Pages on every push to `main`. `.github/workflows/ci.yml` runs tests and a
  build on other branches and pull requests.
- One-time setup: in the repo's **Settings → Pages**, set **Source** to
  **GitHub Actions**. GitHub Pages on a private repo needs a paid plan, so the
  site goes live once the repo is public (or on a paid plan).
- Until then, test on a phone with `npm run dev`, which serves on the local
  network (`--host`). Over plain http the offline service worker and the share
  sheet are unavailable, but everything else works.

---

## 13. Comics

A second kind of project for making comics from the same script work. The
flow is the film flow with the time axis taken out: script → panels →
blocking and camera per panel → panel art → lettering → pages. Nothing moves
and nothing is spoken; instead each panel gets speech balloons and caption
boxes, and panels are laid out on pages.

### 13.1 One app, one project format

- `Project.medium: 'film' | 'comic'`, chosen in **New project** and shown on
  the Projects home card. Default `film`; older projects read as film.
- The medium decides the step list, the labels and which controls show. It
  does not fork the code: Story, Staging, Characters, Props, the shot rig,
  the camera tools, coverage checks and the assistant are shared.
- A **shot is a panel**. The type stays `Shot` in code; the UI says
  "Panel" in comic projects. Numbering defaults to **page.panel** (3.2)
  once panels are on pages, and to sequential before that.
- Switching medium later is allowed (Project settings): film-only data
  (motion end keys, durations, audio) is kept but hidden, so switching back
  loses nothing.

### 13.2 Workflow

```
Story → Staging → Characters → Props → Panels → Lettering → Pages → Export
```

| Step | Comic version | Change from film |
|---|---|---|
| **Story** | Import, line labels, breakdown into panels | Breakdown packs more per panel (§13.3); optional page breaks |
| **Staging / Characters / Props** | Unchanged | Voices hidden. Character concept images matter more: they are the references for panel art |
| **Panels** | Card list and editor, one frozen moment per panel | No Start/End, no timeline, no audio. Blocking + Camera tabs stay. Panel shape (§13.4) replaces the project aspect |
| **Lettering** (new) | Balloons and captions over each panel's art | Replaces Previs |
| **Pages** (new) | Arrange panels on pages | Replaces the film timeline |
| **Export** | Page images, PDF, site package, project file | Replaces MP4 |

### 13.3 Story: breaking a script into panels

Same parser and labels. The breakdown differs because a panel holds a
moment, not a span of time:

- A panel holds **up to ~3 balloons / ~35 words** (setting). Longer runs
  of dialogue split at a speaker change, then at sentence ends.
- An exchange of two short lines stays in one panel (both speakers in
  frame) — the comics equivalent of the film "two-shot" rule.
- Action lines become their own panel when they describe something visible
  happening; scene headings start a new page when **Scene starts a page**
  is on, and give the scene's first panel an establishing frame.
- Narration (`description` lines, `(V.O.)` dialogue) becomes **caption
  boxes**, not balloons.
- `(O.S.)` dialogue gets a balloon whose tail points to the panel edge;
  parentheticals like `(whispers)` / `(shouts)` pick the balloon style
  (§13.6).
- Optional page breaks: a line like `PAGE 4` or `=== page ===` in the script
  forces a page; otherwise pages are filled by the Pages step.

### 13.4 Panels

- **Panel shape** is per panel: a ratio (wide 2:1, standard 4:3, square,
  tall 3:4, full-bleed splash) set in the editor or taken from the page
  template slot it lands in. The shot viewport letterboxes to it exactly as
  it does to the project aspect today.
- One keyframe: `setup` and `camera` keep the `Keyframed` type with
  `mode: 'static'` (only `start` is used). Durations, moves and walk cycles
  are not shown.
- **Pose matters more than in film**, since there is no motion to tell the
  story. The editor keeps the pose presets and the assistant's posing.
- **Headroom for lettering:** a "leave room for balloons" toggle (default on
  for panels with dialogue) frames people lower and wider, so text doesn't
  cover faces. The assistant's framing tools take it into account.
- **Panel art** comes from one of: the grey render (fine for thumbnails and
  roughs), an AI image made from the render (the existing shot image flow,
  `shot.image`), or an uploaded drawing. Lettering sits on whichever is
  current.

### 13.5 Lettering

The core of this is the user's existing comic text editor (desktop and
mobile versions), ported into the app as a TypeScript module. What it does
today and what carries over:

| In the existing editor | In ShotByShot |
|---|---|
| Two element types: **caption** box (cream `#f4e4a6`, black rule) and speech **bubble** (oval or rounded box) with one tail point | Same two, plus thought, whisper, shout and off-panel variants (§13.6) |
| Per element: text, font, size, bold/italic, padding, stroke width, drop cap (first letter +2 px) | Same fields, but defaults come from a **project lettering style**, so a whole book changes in one place; per-element values are overrides |
| Measured oval wrapping (mobile): tries 2–7 lines, each line's width follows a sine profile (`edgeTightness`), scores fill ≈ 90 % and narrow top/bottom lines, then rebalances words between lines | Kept as is — it's the best part. Moved to `src/comic/wrap.ts` with unit tests; width limits stay relative to panel width (`maxWidthFrac` 0.38, `minWidthFrac` 0.22, cap) |
| Caption wrap by ~20 characters per line | Replaced by measured wrapping on a rectangular profile (same scorer) |
| Tail: base points found on the ellipse (or box edge), pulled inward by 0.7 × stroke to hide the seam; tip pushed out if it ends up inside the balloon | Kept. Tail drawn as a curved wedge as an option; tip can aim at a character (§13.7) |
| Positions in image pixels | **Normalized to the panel (0–1)**, so lettering survives re-rendering the art at another size or replacing it |
| Text typed by hand or pasted | Comes from the script lines (§13.7); editing a balloon edits the line, or detaches it with a "custom text" toggle |
| Mobile: large tail handle drawn 200 px below the tip | Same idea, but the offset is in **screen** pixels, not image pixels (today it changes with image size) |
| Hidden textarea for typing on the canvas | The app's own bottom sheet with a real text field (works with the iOS keyboard and the chat bar) |
| Settings in `localStorage` | Lettering style in the project; nothing in `localStorage` |
| Fonts: Wild Words (self-hosted TTF), Bangers, Permanent Marker, Architects Daughter, Covered By Your Grace from Google Fonts | Free fonts (Google Fonts, OFL) bundled with the app (no third-party requests; see §4.4 CSP). **Wild Words is not bundled**: it is Comicraft's commercial *CC Wild Words Roman* (© 1995, all rights reserved), so it can't go in the public repo or the Pages site. Instead, **Settings → Lettering fonts → Add font** lets the user load their own licensed TTF/OTF; it is stored in IndexedDB (like API keys, never in project files), registered with `FontFace`, and is then the default lettering font. Projects name fonts by family, with a bundled fallback (Comic Neue) when the font isn't installed on this device. Fonts are loaded with `document.fonts.load` **before** any wrapping, so measurements are stable |
| Export: one PNG of one image | Page and panel export through the shared renderer (§13.9) |

**Rendering:** one function, `drawLettering(ctx, panelRect, elements, style)`,
used by the Lettering editor, panel thumbnails, the Pages view and Export,
so what you see is what exports. It's Canvas 2D like the original, so the
original's drawing code ports almost line for line.

**Editor UI (mobile-first, same shell):** the panel's art fills the
viewport; balloons are tappable; selected balloon shows the tail handle and
a bottom toolbar (style, size −/+, bold, font, edit text, delete), taken from
the mobile editor. Drag to move; pinch on a balloon to change its wrap
width. Prev/next panel arrows; the panel's script lines are listed below
with a "placed / not placed" mark so no line gets lost.

### 13.6 Balloon and caption kinds

| Kind | Look | From the script |
|---|---|---|
| Speech | Oval / rounded box, pointed tail | Dialogue |
| Thought | Cloud outline, trail of small circles | `(thinks)`, `(thought)` |
| Whisper | Dashed outline, grey text | `(whispers)`, `(quietly)` |
| Shout | Spiky burst outline, bold, larger | `(shouts)`, `(yells)`, all-caps line |
| Off-panel | Speech balloon, tail to the panel edge | `(O.S.)`, speaker not in frame |
| Electronic | Zig-zag tail | `(on phone)`, `(radio)`, `(V.O.)` from a device |
| Caption | Box, no tail | Narration, `(V.O.)`, description lines |
| Sound effect | Free-standing styled text, no box | Action lines in CAPS like "BANG", optional |

Balloons of the same speaker that follow each other in a panel can be
**joined** (connector), as letterers do.

### 13.7 Automatic placement (from the 3D scene)

The app knows where every character's head is in each panel, which a
hand-lettering tool doesn't. `ShotCanvas` already captures each character's
screen position (`framing`, used for image prompts); extend it to the head
and mouth point, for the panel's single keyframe.

- **Fill:** each dialogue line in the panel becomes a balloon with the
  speaker's line, in script order. Narration becomes captions.
- **Reading order:** balloons are placed top-left to bottom-right in script
  order (Western reading order; right-to-left is a setting for manga).
  The first speaker's balloon goes nearest the top-left even if they stand
  on the right, and the tail crosses — that's normal lettering.
- **Tails:** each tail aims at the speaker's mouth, stopping short of it
  by a few percent of the panel height. Off-panel speakers aim at the panel
  edge nearest where they are in 3D.
- **Avoid faces:** placement scores candidate spots by overlap with every
  character's head box (from the same projection), overlap with other
  balloons, distance from the panel edge, and tail length; then it picks the
  best in reading order. Balloons may break the panel border only when the
  style allows it.
- **Keep it editable:** auto-placed elements are marked `auto`; moving one by
  hand pins it. **Re-place** re-runs only the unpinned ones (for example after
  changing the camera).
- **Fit check:** if a panel's text won't fit without covering a face, the
  panel shows a warning with fixes: frame wider, split the panel, or shorten
  the line (assistant).

### 13.8 Pages

**First version: one panel per page.** Each panel is a page, in panel
order, at the panel's own shape; there are no gutters or page templates,
and the page count is the panel count. This matches how the comic site
reads today (one image per screen) and keeps the first release small. The
Pages step is then a reorderable strip of lettered panels with a
read-through mode, plus page-count and cover choice.

Later (multi-panel pages, milestone C7):

- A book has a **page size** (US comic 6.625 × 10.25 in, manga B6, A4,
  square, and **vertical scroll / webtoon** with no fixed height) and
  margins, gutter width and bleed.
- **Page templates**: rows of slots (1, 2, 3, 4, 6 panels; splash;
  wide-top; L-shapes). Panels fill slots in order; drag a panel to another
  slot, merge two slots, or nudge a gutter. A slot's shape becomes the
  panel's shape (§13.4), and the panel's framing is kept by re-fitting the
  lens or distance.
- **Auto paginate** fills pages from the panel list: big moments (scene
  openers, single action panels) get bigger slots, dialogue runs go in
  rows, and a page turn is preferred before a reveal. The assistant can do
  it with direction ("make the reveal a splash on a right-hand page").
- Read-through mode (in the first version too): swipe through pages full
  screen — the comic's version of Previs.

### 13.9 Export

- **Pages** as JPEG (default) or PNG at a chosen width (e.g. 1600 or 2400
  px) in a zip, and as a **PDF**. Files are named **`Page01.jpg`,
  `Page02.jpg`, …** — two-digit page numbers (comics are
  expected to stay under 100 pages; Export warns past 99)
- **Panels** one image per panel (lettered or clean).
- **Site package:** a zip laid out for the user's own comic reader site:
  `comics/<slug>/` with the page images and a cover, plus the entry for its
  `comics.json`:
  ```json
  { "slug": "com_07", "title": "Complicated - 07 - …", "cover": "/comics/com_07/cover.jpg", "pages": 18, "tags": ["new"] }
  ```
  Pages use the `PageNN` names above; the cover is a chosen panel (default
  the first) saved as `cover.jpg`. Slug, title and tags are set in Export
  and remembered in the project.
- The project file (`.sbs.zip`) carries panels, lettering, pages and art,
  as it does for film.

### 13.10 Data model additions

```ts
interface Project {
  // …existing fields
  medium: 'film' | 'comic';                 // default 'film'
  comic?: {
    page: { size: PageSizeId; widthIn: number; heightIn?: number;   // no height = vertical scroll
            marginIn: number; gutterIn: number; bleedIn: number };
    lettering: LetteringStyle;              // project-wide defaults
    pages?: ComicPage[];                   // C7; until then each panel is a page, in panel order
    readingOrder: 'ltr' | 'rtl';
    publish?: { slug: string; title: string; tags: string[] };
  };
}

interface Shot {                             // a panel in comic projects
  // …existing fields
  panel?: {
    ratio: number;                           // width / height; from the page slot if placed
    art: 'render' | 'image' | 'upload';      // which art is current
    upload?: { blob: string; name: string };
    leaveRoom?: boolean;                     // frame for lettering
    lettering: LetterElement[];
  };
}

type LetterKind = 'speech' | 'thought' | 'whisper' | 'shout' | 'electronic' | 'caption' | 'sfx';

interface LetterElement {
  id: string; kind: LetterKind;
  lineId?: string;                           // script line it shows; text follows the line
  text?: string;                             // custom text (detached from the line)
  x: number; y: number;                      // top-left, 0..1 of the panel
  wrapWidth?: number;                        // 0..1 of panel width; else from style
  shape?: 'oval' | 'rounded' | 'box';
  tail?: { x: number; y: number; targetCharacterId?: string } | null;
  joinTo?: string;                           // connector to another balloon
  style?: Partial<LetterStyleValues>;        // per-element overrides
  auto: boolean;                             // placed automatically; false once moved by hand
}

interface LetterStyleValues {
  font: FontId; size: number;                // size in pt at print size, scaled to the panel
  bold: boolean; italic: boolean; dropCap: boolean;
  padding: number; stroke: number;
  fill: string; ink: string;
  edgeTightness: number; minLines: number; maxLines: number;
  maxWidthFrac: number; minWidthFrac: number;
}
type LetteringStyle = Record<LetterKind, LetterStyleValues>;

interface ComicPage {
  id: string; template: PageTemplateId;
  slots: { panelId?: string; rect: [x: number, y: number, w: number, h: number] }[];  // 0..1 of the live area
}
```

All edits go through the command bus (undo, assistant changes tagged), as
everywhere else. Text sizes are stored relative to print size, not image
pixels, so a page exported at 1600 or 2400 px looks the same.

### 13.11 Assistant

Comic projects get their own tools on top of the shared ones:
`place_lettering(panels?)`, `set_balloon(id, kind|text|style)`,
`shorten_line(lineId, maxWords)` (edits the script line, undoable),
`paginate(direction?)`, `set_page_template(page, template)`, and a
**lettering check** like the coverage check: covered faces, wrong reading
order, too many words in a panel, lines not placed. Snapshots for the model
include the lettered panel, so it can see what it did.

### 13.12 Milestones

| # | Milestone | Scope | Exit criteria |
|---|---|---|---|
| **C1** | Medium switch | `medium` field + migration, New project choice, comic step list and labels, Panels step = Shots without timing/audio/motion, panel ratio | Make a comic project; break a script into panels; frame them |
| **C2** | Lettering core | Port the editor's wrap, measure and draw code to `src/comic/` (TypeScript, unit tests on wrapping and tail geometry), bundled free fonts + user-added fonts (Wild Words), lettering style, Lettering step with manual balloons and captions | Letter a panel by hand on a phone, matching the old tool's output |
| **C3** | Script-driven lettering | Balloons from script lines, kinds from parentheticals, head/mouth projection, auto placement with face avoidance, pin/re-place, fit warnings | A dialogue scene letters itself with tails on the right people |
| **C4** | Pages (one panel per page) | Page order from panel order, reorder, cover choice, read-through | Swipe through a lettered scene as pages |
| **C5** | Export | `Page01.jpg…` zip, PDF, site package with `cover.jpg` and the `comics.json` entry | Export drops into the comic site and reads correctly |
| **C6** | Assistant | Comic tools and the lettering check | "Letter these pages and fix anything covering a face" works and can be undone |
| **C7** | Multi-panel pages | Page sizes, templates, slot fitting, auto paginate | A 6-page scene laid out without manual work, then adjusted |

C2 doesn't need C1 and can start first: it's a self-contained port with
tests, and it can be tried on any image (the shot image flow already
produces panel art).

### 13.13 Open questions

- **Wild Words licence:** the user's desktop licence lets them letter and
  export their own pages (exports are images and PDFs, and the font's
  embedding flag allows PDF embedding). Shipping it as a web font in the app
  would need Comicraft's web-font licence; until then it is a user-added
  font only (§13.5).
- **Art style consistency** across panels for AI images (same character
  references help; a per-project style prompt may be needed).
- Whether lettering should also be offered to film projects as burned-in
  titles or storyboard captions (cheap once C2 exists).

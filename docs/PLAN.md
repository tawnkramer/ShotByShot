# ShotByShot — Product & Technical Plan

A mobile-first shot-building and previs web app. Import a script, break it into
shots, block out stages, characters, and props in grey-box 3D, frame each shot
with a camera, play back the whole sequence, and export an MP4.

An AI agent is available at every step through a chat bar fixed to the bottom of
the screen. It can see what you see (scene snapshots) and act on the project
through the same commands the UI uses, so all its actions can be undone.

---

## 1. Workflow overview

```
Story → Staging → Characters → Props → Shots → Previs → Export
```

| Step | Purpose | Primary output |
|---|---|---|
| **Story** | Import script, classify lines, break into shots | `ScriptLine[]`, `Shot[]` (line ranges) |
| **Staging** | Build N grey-box sets from primitives, props, imported models | `Stage[]` |
| **Characters** | Define people: name, attributes, height, sex → mannequin | `Character[]` |
| **Props** | Import or AI-model props for the shots | `Prop[]` (asset library) |
| **Shots** | Card list of shots; edit each shot's blocking + camera + timing | `Shot.setup`, `Shot.camera`, `Shot.duration` |
| **Previs** | Play all shots in sequence with a scrubber | (review only) |
| **Export** | Render MP4; optional start/end PNG per shot | `.mp4`, `.zip` of PNGs |

Steps are not locked: the header stepper lets you jump back to any earlier step.
**Next** only moves forward. Each step shows a warning, not a block, when its
inputs are incomplete (for example, Shots with no stage assigned).

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
  replaced by **Done** in the same position. (The spec puts Done at the bottom;
  see Open Questions §11. The plan puts it in the header so it stays clear of
  the chat bar.)
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
  - Keyboard handling: position the bar with the `visualViewport` API so it stays
    above the iOS/Android soft keyboard.
- **Agent context:** each message is sent with the current step, the selection,
  a compact JSON of the relevant state, and optionally a canvas snapshot. The
  agent only gets the tools for the current step (§6).
- **Undo/redo:** header overflow menu, plus shake-to-undo on mobile (optional).
  Every UI edit and every agent action goes through one command bus (§5.3).

---

## 3. Step-by-step design

### 3.1 Story

**Import**
- Accepts `.txt`, `.fountain`, `.fdx` (Final Draft XML, later), or pasted text.
- Each non-empty line becomes a `ScriptLine` with a stable id.

**Classify.** Each line gets one type:
`title · description · character · dialogue · action · scene · camera`

1. **Heuristic pass on the client, instant.** Uses Fountain-style conventions:
   - `INT.` / `EXT.` / `INT./EXT.` → `scene`
   - All-caps short line, optionally with `(V.O.)` or `(O.S.)` → `character`
   - A line after a `character` line or a parenthetical → `dialogue`
   - `CUT TO:`, `CLOSE ON`, `ANGLE ON`, `WIDE`, `POV`, `PAN`, `TRACKING` → `camera`
   - First block before any scene heading → `title` / `description`
   - Everything else → `action`
2. **AI refine pass.** The agent reviews the lines in batches of about 200 and
   returns corrections with a confidence score for each. Low-confidence lines get
   a highlight in the UI.
3. **Manual fix.** Tap a line's colored type chip to cycle its type, or long-press
   it for the full list. You can multi-select lines to bulk-assign a type.

**Shot breakdown**
- If the script has explicit shot or scene breaks (camera lines, `CUT TO:`),
  those are used.
- Otherwise a **Breakdown preference** control sets the density:
  - *One shot per line:* every dialogue or action line starts a shot.
  - *Per two lines:* consecutive lines are paired, but a shot never crosses a
    scene or speaker boundary in a way that splits an exchange badly.
  - *Mixed (default):* the AI decides. Dialogue exchanges get grouped (shot /
    reverse-shot), action sequences get split more finely (about one beat per
    shot), and establishing shots are inserted at scene starts.
- The deterministic modes run on the client. *Mixed* calls the agent, which
  returns `{shotBreaks: lineId[], rationale}`.
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
- Imports use `OBJLoader` and `GLTFLoader` (+ `DRACOLoader`). Imported models are
  normalized: centered, placed on the ground, scaled to a sensible size, and
  converted to grey materials. The original files are uploaded to Cloud Storage.

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
- The agent gets a scene snapshot (canvas PNG) together with the scene JSON, so
  it can check its own work.

### 3.3 Characters

- A card per character: **Name**, **Sex** (M/F/Other → proportions preset),
  **Height** (cm or ft/in), **Build** (slim/average/heavy), **Age band**,
  free-form **Attributes** (tags or notes: "limps", "wears hat").
- Character names are auto-populated from `character` lines in the Story step.
- **Mannequin:** a parametric figure built from capsules and spheres
  (head, torso, pelvis, upper/lower arms and legs). Proportions are driven by
  height, sex, and build.
  - **Eyes:** two small dark spheres. **Nose:** a small sphere or cone. Together
    they make facing direction obvious at a glance.
  - Each character gets a slight tint or colored base ring, so you can tell
    characters apart in a grey world. The tint can be turned off.
  - Pose presets: standing, sitting, leaning, lying, walking (static v1 poses).
- Small turntable preview per character card. The full editor shows a larger
  viewport.
- The agent can create characters from the script ("make characters from the
  script with plausible heights").

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
- One large card per shot, scrolled vertically. A 16:9 thumbnail fills the width;
  details sit below it: shot #, stage, characters, duration, camera type
  (fixed/animated), and the first line of dialogue or action.
- Tap a card to open the **Shot editor**.
- **Long-press (≈500 ms)** opens an action sheet:
  - **Merge with shot below:** combines line ranges and sums durations. The
    setup is kept from the upper shot.
  - **Split shot (by dialogue):** shows the shot's lines with tap-to-place split
    points between dialogue lines. Each new shot copies the setup.
  - Duplicate, delete, insert a new shot after this one.
- Thumbnails are rendered offscreen with a single shared `WebGLRenderer`,
  cached as blobs (IndexedDB plus GCS), and re-rendered when the shot changes.
  This avoids running one WebGL context per card.

**Shot editor**
- Top: a 16:9 viewport through the shot camera, with letterboxing and an optional
  rule-of-thirds overlay. Captions are shown on the lower third.
- Mode switch: **Blocking** | **Camera**.
- **Blocking mode**
  - Pick the stage (defaults to the stage of the shot's scene).
  - Add characters and props to the shot, and move, rotate, and pose them with
    the same gizmo toolbar as Staging.
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
  estimated from dialogue (~2.7 words/s + 0.5 s padding) and action lines
  (~2 s each).
- **Captions:** dialogue lines are spread across the duration in proportion to
  their word count, with editable in/out handles. Rendered as lower-third text
  with the speaker name.
- **Play / pause / loop** for the shot.
- **Done** saves, regenerates the thumbnail, and returns to the Shots list (or
  to Previs if you came from there).
- AI in the shot: "frame a medium close-up on Sam over Alex's shoulder", "push in
  slowly to Sam", "move Alex to the bar stool". The agent gets helper tools
  such as `frameSubjects(ids, shotSize, angle)` so it doesn't have to compute raw
  camera math.

### 3.6 Previs

- One viewport plus a full-width **scrubber**. Shot boundaries are marked as
  ticks, with shot numbers above them.
- Play, pause, step to the previous or next shot, and loop.
- The timeline is the shots in order. Each shot has an offset equal to the sum of
  the previous durations. Seeking finds the shot, loads its setup into the scene
  (cached per stage), and evaluates the camera at its local time.
- When paused, a **shot info panel** shows the shot number, stage, characters,
  lines, and an **Edit shot** button. Tapping it goes to the Shot editor, and
  Done returns here at the same timecode.
- Captions are shown here as well.

### 3.7 Export

- Settings: resolution (720p / 1080p), fps (24 / 25 / 30), captions on/off,
  shot-number burn-in on/off.
- **MP4:** rendered on the client, frame by frame and deterministically (not in
  real time):
  - For each frame: set time → render to an offscreen canvas → composite the
    captions on a 2D canvas → create a `VideoFrame` → encode with `VideoEncoder`
    (H.264) → mux with **mp4-muxer**.
  - Progress bar with cancel. Download or share via the Web Share API on mobile.
  - Fallback where WebCodecs is unavailable: real-time `MediaRecorder` capture
    (WebM/MP4, depending on the browser). Optional later: server-side render
    (see §4.4).
- **Stills:** a checkbox for "PNG start frame per shot", with an optional "+ end
  frame (animated shots)". Zipped with `fflate` and named
  `S012_start.png` and `S012_end.png`.
- Optional extra: a shot-list PDF or CSV (thumbnail, number, lines, camera
  notes).

---

## 4. Architecture

### 4.1 Overview

```
┌───────────── Browser (PWA) ─────────────┐        ┌──────── Google Cloud ────────┐
│ React + TS + Vite                        │ HTTPS  │ App Engine Standard           │
│  ├ Zustand store (project state)         │◄──────►│  Node 22 + Fastify (TS)       │
│  ├ Command bus (undo/redo, AI ops)       │  SSE   │   ├ /api/projects …  (CRUD)   │
│  ├ react-three-fiber + drei (three.js)   │        │   ├ /api/agent  (Claude loop) │
│  ├ IndexedDB cache (offline drafts)      │        │   └ /api/uploads (signed URL) │
│  └ WebCodecs + mp4-muxer (export)        │        │ Firestore (project docs)      │
└──────────────────────────────────────────┘        │ Cloud Storage (assets, thumbs)│
                                                    │ Secret Manager (API keys)     │
                                                    │ Firebase Auth (Google sign-in)│
                                                    └───────────────────────────────┘
```

### 4.2 Frontend

| Concern | Choice | Why |
|---|---|---|
| Framework | React 18 + TypeScript + Vite | Ecosystem, r3f |
| 3D | three.js via **@react-three/fiber**, **@react-three/drei** | `TransformControls`, `OrbitControls`/`CameraControls`, `Outlines`, `useGLTF` |
| State | **Zustand** + **Immer** | Simple, works well with a command/patch-based undo |
| Routing | React Router (one route per step + `/shots/:id`) | Deep links, back button |
| Styling | CSS modules or Tailwind; CSS variables for theming | Mobile-first, `env(safe-area-inset-*)` |
| Gestures | `@use-gesture/react` | Long-press, pinch, and drag on the camera gizmo and cards |
| Persistence | IndexedDB (`idb-keyval`), debounced sync to the API | Survives flaky mobile connections |
| Export | WebCodecs, `mp4-muxer`, `fflate` | MP4 on the client, no server ffmpeg |
| PWA | `vite-plugin-pwa` | Installable, offline shell |

Performance on mobile: cap `devicePixelRatio` at 2, use low-poly procedural
geometry, share geometries and materials, render on demand
(`frameloop="demand"`) outside playback, and use one shared offscreen renderer
for thumbnails.

### 4.3 Backend: App Engine Standard

- **Runtime:** Node.js 22, Fastify, TypeScript. The client and server share
  **Zod** schemas in `packages/shared`. (Python/FastAPI would also work, but
  sharing TS types between client, server, and agent tool schemas is a big win.)
- `app.yaml` with `automatic_scaling`. Static frontend is served via `handlers`
  (or Firebase Hosting / a CDN in front).
- **Firestore (Native mode):**
  ```
  users/{uid}
  projects/{projectId}                    meta, ownerId, settings, stepProgress
    /script/{chunkId}                     ScriptLine[] in chunks (≤1 MB doc limit)
    /shots/{shotId}
    /stages/{stageId}
    /characters/{characterId}
    /props/{propId}
    /chat/{messageId}
  ```
- **Cloud Storage:** `projects/{id}/assets/*` (OBJ/GLB/textures),
  `projects/{id}/thumbs/{shotId}.webp`, `projects/{id}/refs/*` (reference
  images). The client uploads directly with **V4 signed URLs** issued by the API.
- **Auth:** Firebase Auth (Google sign-in). The API verifies ID tokens.
  Firestore security rules are a second line of defense if the client reads
  Firestore directly (v1: everything goes through the API).
- **Secrets:** the Anthropic API key is stored in Secret Manager and never sent
  to the client.

### 4.4 Optional later: server-side render

App Engine Standard isn't a good fit for headless WebGL + ffmpeg. If client-side
export proves unreliable on some devices, add a **Cloud Run job** that runs
headless Chromium (Playwright) with the same renderer, encodes with ffmpeg, and
writes to GCS. The API enqueues it with Cloud Tasks.

---

## 5. Data model (shared TS / Zod)

```ts
type Vec3 = [number, number, number];
type Transform = { position: Vec3; rotation: Vec3 /* euler, rad */; scale: Vec3 };

type LineType = 'title'|'description'|'character'|'dialogue'|'action'|'scene'|'camera';

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
  captions: Caption[];
  thumbUrl?: string; updatedAt: number;
}

interface ShotSetup {
  actors: { characterId: string; transform: Transform; pose: PoseId; attachments?: Attachment[] }[];
  props:  { propId: string; transform: Transform }[];
  stageOverrides: Record<string /*stageObjectId*/, Partial<Transform> & { hidden?: boolean }>;
}

interface CameraState {
  target: Vec3; azimuth: number; elevation: number;   // radians
  distance: number; fovDeg: number; roll: number;
}
interface ShotCamera {
  mode: 'fixed'|'animated';
  start: CameraState;
  end?: CameraState;           // animated only
  easing: 'linear'|'easeInOut';
}

interface Caption { lineId: string; speaker?: string; text: string; inSec: number; outSec: number }

interface Stage { id: string; name: string; sceneLineIds: string[]; objects: StageObject[]; }
interface StageObject {
  id: string; name: string; transform: Transform;
  source: { kind: 'library'; item: LibraryItem; params?: Record<string, number> }
        | { kind: 'primitive'; shape: PrimitiveShape; params?: Record<string, number> }
        | { kind: 'asset'; assetId: string }           // imported OBJ/GLB
        | { kind: 'composite'; nodes: PrimitiveNode[] }; // AI-modeled
  grey?: number;               // 0..1 shade
}

interface Character {
  id: string; name: string; sex: 'male'|'female'|'other';
  heightCm: number; build: 'slim'|'average'|'heavy'; ageBand?: string;
  attributes: string[]; tint?: string;
}

interface Prop { id: string; name: string; source: StageObject['source']; defaultScale: number; }
```

### Command bus

Every mutation is a `Command { type, payload, inverse }` that is applied with
Immer patches. Commands give us:
- undo/redo for the UI and the agent alike,
- dirty tracking, so only changed docs are synced (each command records the docs
  it touched),
- an agent audit trail ("AI moved Chair 2 · Undo").

---

## 6. AI agent design

**Model:** Claude, through the Anthropic Messages API, with tool use, vision, and
streaming. Defaults: the current Sonnet-class model for interactive chat, and
the Opus-class model for heavy one-shot jobs (full-script classification,
breakdown, image → layout). Both are configurable in `server/config`.

**Loop (server-orchestrated, client-executed tools):**
1. The client POSTs `/api/agent` with `{projectId, step, message, attachments,
   context}`. `context` is a compact JSON of the state relevant to the step plus
   an optional canvas snapshot.
2. The server builds the system prompt (app overview + step-specific guide +
   coordinate conventions: meters, Y-up, −Z is "into the room"), attaches
   **only that step's tools**, and streams the response over SSE.
3. When Claude emits `tool_use`, the server forwards it to the client. The
   client validates it with Zod, applies it as a Command, and replies with a
   `tool_result` (success, new ids, and optionally a fresh snapshot). The loop
   continues until the turn ends (with a max-iterations guard).
4. Chat history is persisted per project. The server uses prompt caching for the
   system prompt and script, and summarizes older turns to bound the context.

**Tools by step** (JSON-schema, generated from Zod):

| Step | Tools |
|---|---|
| Story | `classifyLines(updates[])`, `setShotBreaks(lineIds[], rationale)`, `assignSpeaker(lineId, name)` |
| Staging | `createStage(name, sceneLineIds?)`, `addObject(stageId, source, transform)`, `updateObject(id, partialTransform)`, `removeObject(id)`, `layoutFromImage(stageId, objects[])`, `getSnapshot(viewpoint?)` |
| Characters | `createCharacter(...)`, `updateCharacter(id, patch)` |
| Props | `createCompositeProp(name, nodes[])`, `updateCompositeProp(id, nodes[])`, `suggestProps()` |
| Shot editor | `placeActor(characterId, transform, pose)`, `placeProp(...)`, `setCamera(state, which:'start'|'end')`, `frameSubjects(ids, shotSize, angle, side)`, `setCameraMode(mode)`, `setDuration(sec)`, `getSnapshot()` |
| Shots list / Previs | `mergeShots(id)`, `splitShot(id, atLineIds[])`, `setStage(shotIds[], stageId)`, `navigateToShot(id)` |

- `frameSubjects` is computed on the client: it takes a bounding box, a shot size
  (ECU/CU/MCU/MS/MWS/WS/EWS), and an angle (eye/high/low/OTS), and solves for the
  camera distance from the FOV. This keeps the LLM away from trigonometry.
- **Image → layout:** the image is sent to the model along with the library
  catalogue (names plus default dimensions). The prompt asks for a top-down plan:
  room size first, then objects in room coordinates.

**Safety and cost:** per-user rate limits, a max token budget per request, and
the API key kept on the server only. Attachments are size-limited and
re-encoded on the client before upload.

---

## 7. Repository layout

```
/
├─ app/                     # frontend (Vite + React + r3f)
│  ├─ src/shell/            # Header, ChatBar, ChatSheet, Stepper
│  ├─ src/steps/            # story/ staging/ characters/ props/ shots/ previs/ export/
│  ├─ src/three/            # library builders, mannequin, camera rig, renderer pool
│  ├─ src/state/            # store, commands, sync, idb
│  ├─ src/agent/            # SSE client, tool executors
│  └─ src/export/           # WebCodecs encoder, png zip
├─ server/                  # App Engine service (Fastify)
│  ├─ src/routes/           # projects, uploads, agent
│  ├─ src/agent/            # prompts, tool registry, loop
│  ├─ app.yaml
│  └─ package.json
├─ packages/shared/         # Zod schemas, types, tool definitions, timing math
├─ docs/PLAN.md
└─ package.json             # pnpm workspaces
```

---

## 8. Delivery milestones

| # | Milestone | Scope | Exit criteria |
|---|---|---|---|
| **M0** | Skeleton | Monorepo, App Engine deploy, Firebase Auth, app shell (header / body / chat bar), routing, local store + IndexedDB | Deployed shell on a phone; steps navigable |
| **M1** | Story | Import, heuristic classifier, line-type editing, deterministic breakdown modes | Paste script → shots exist |
| **M2** | 3D core | r3f viewport, grey render style, library items, primitives, selection + gizmo toolbar, OBJ/GLB import, multiple stages | Build a bar set by hand on mobile |
| **M3** | Characters & Props | Mannequin generator, character editor, prop library | Characters render with facing cues |
| **M4** | Shots | Shots list + thumbnails, shot editor blocking, camera gizmo, fixed/animated camera, captions, playback, merge/split | Edit and play a shot |
| **M5** | Agent | `/api/agent` loop, SSE, chat sheet, Story + Staging tools; then Characters, Props, Shot tools; snapshots; image → layout | "Build a bar with 4 stools" works and can be undone |
| **M6** | Previs | Sequence timeline, scrubber, info panel, jump-to-edit round trip | Watch the whole cut |
| **M7** | Export | WebCodecs MP4, MediaRecorder fallback, PNG stills zip | 2-minute previs → MP4 on iPhone and Android |
| **M8** | Polish | Sync/conflict handling, PWA offline, perf passes, onboarding, sample project | Beta |

The agent (M5) can be started in parallel with M2 once the command bus exists.
Story AI tools only depend on M1.

---

## 9. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| Gizmo usability on small touch screens | Big custom handles, axis-lock buttons in the toolbar, numeric inspector fallback, snapping |
| Multiple WebGL contexts (iOS limit ~8–16) | One live renderer per page + one offscreen thumbnail renderer; thumbnails stored as images |
| WebCodecs gaps on older mobile browsers | MediaRecorder fallback; later a Cloud Run render job |
| LLM spatial reasoning errors | High-level helper tools (`frameSubjects`, relative placement like `nextTo`, `facing`), snapshot feedback, everything undoable |
| Large scripts vs. context limits | Chunked classification, prompt caching, summarised history |
| Firestore 1 MB doc limit | Script stored in chunks; one doc per shot/stage; assets in GCS |
| Offline edits and conflicts | Last-writer-wins per doc with `updatedAt`; single-user projects in v1 |

---

## 10. Testing strategy

- **Unit (Vitest):** classifier heuristics, breakdown modes, merge/split,
  caption timing, camera interpolation, `frameSubjects` math, command
  inverses.
- **Schema tests:** every agent tool's sample payloads validate against Zod.
- **Agent evals:** a small fixture set (scripts, stage requests, images) scored
  for classification accuracy and placement sanity (no overlaps, objects on the
  floor).
- **E2E (Playwright, mobile viewport emulation):** import → breakdown → stage
  → shot → previs → export happy path.
- **Visual regression:** golden thumbnails for library items and the mannequin.

---

## 11. Open questions

1. **Done button placement.** The spec says Done is at the bottom of the Shot
   editor, but the bottom has the chat bar. The plan puts Done in the header's
   Next slot. Alternative: a Done bar just above the chat bar.
2. **Character motion.** Is per-shot character movement (start/end blocking,
   like the camera) wanted in v1, or are characters static per shot?
3. **Multi-user collaboration.** Is real-time sharing needed? That would push
   toward Firestore listeners and CRDT-style merging.
4. **Script formats.** Is plain text and Fountain enough for v1, or is Final
   Draft `.fdx` / PDF import needed?
5. **Aspect ratios.** Fixed 16:9, or selectable (2.39:1, 9:16 for vertical)?
6. **Audio.** Is a scratch track or TTS of dialogue in Previs/Export wanted
   (later)?
7. **AI provider and budget.** The plan uses Claude through a server-side key.
   Is there a per-user budget, or should users bring their own key?

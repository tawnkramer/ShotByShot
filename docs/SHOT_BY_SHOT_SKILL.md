# Plan: the "Shot by Shot" skill for the in-browser agent

Status: **milestones 1–3 done**: blocking and camera passes, checker, renders, tuned from live runs on Cold Coffee.
Written 2026-10-12 so a fresh session can pick it up.

## Goal

Let the in-app assistant (OpenAI, `src/ai/`) stage and shoot a whole scene on request,
following directing rules from Steven D. Katz's *Shot by Shot* (and the standard continuity
grammar it draws on, e.g. Arijon's *Grammar of the Film Language*):

1. **Blocking pass**: "Block the scene." The agent reads the script and, for every shot, places
   actors with positions, poses, facing and movement (start/end keys), keeping continuity
   between cuts.
2. **Camera pass**: "Plan the camera." Run after the user has reviewed the blocking. The agent
   frames every shot: who to cover (speaker vs. reaction), shot size, angle, height, lens and
   movement. It respects the line of action and changes at least two camera elements every cut.
3. **Look and adjust**: the agent renders frames from the shots, looks at them, and fixes
   problems.

**Test scene:** the Cold Coffee breakup in the cafe (`samples/cold_coffee.txt`,
`INT. CORNER CAFE - MORNING`; Nora, Ben, Barista).

## Decisions

| Topic | Decision |
|---|---|
| Order | Blocking pass first, then the camera pass. They are separate requests so the user can review in between. |
| Two-element rule (C3) | **Warning by default.** The checker reports it; the agent may break it on purpose but must say why. Easy to make strict later. |
| Measurable rules | Enforced by code (`check_coverage`), not left to the model. |
| Judgment rules | Written in the skill text. The model applies them. |
| Rendering | New `render_shots` tool: offscreen contact sheet of chosen shots. Use it in batches (4–6 shots per sheet), not after every change. |
| LLM | OpenAI, the user's own key (unchanged). |
| Build first | Blocking pass, `render_shots` and multi-shot context. Then camera tools and the checker. |

## The rules

### Blocking (first pass)
- **B1. Follow the script.** Each action line becomes positions, poses and movement. "Ben hurries in
  and drops into the chair" → start walking at the door, end seated in the chair.
- **B2. Carry positions across cuts.** A shot's end key is the next shot's start key, unless the
  script moves someone. A cut doesn't teleport anyone.
- **B3. Use the set.** Seat people in real chairs at the table. Keep everyone out of furniture
  footprints (the context already lists them).
- **B4. Face each other while talking.** Characters in conversation face each other. Someone who
  isn't speaking faces what the script says they're looking at (the key, the window).
- **B5. Stage for the camera.** Put the two leads on a clear line of action, ideally with something
  meaningful behind one of them (the rainy window behind Nora).
- **Limit:** the only poses are `standing, sitting, walking, leaning, lying`. Hand business
  (wrapping hands around a mug, sliding the envelope) can't be shown. The agent leaves it to the
  image and video prompts and doesn't fake it.

### Camera (second pass)
- **C1. Line of action (180°).** The axis runs between the two characters in the exchange. The camera
  stays on one side for the scene. *Measurable:* sign of the 2D cross product
  `(B − A) × (cam − A)` on the XZ plane.
- **C2. Allowed crossings.** The camera may cross the line only:
  - on a shot that sits on the line (|cross| small);
  - on an insert or cutaway (no characters in frame, or a prop-only insert like CLOSE ON the
    envelope);
  - when a character's movement redraws the line (an actor's start and end keys differ a lot);
  - on a moving camera that crosses during the shot.
- **C3. Change at least two elements every cut** (warning by default). The elements, with
  thresholds:
  - subject (different set of characters framed);
  - shot size (≥ 1 step on EWS, WS, MS, MCU, CU…);
  - angle around the subject (≥ 30° azimuth);
  - height (≥ 10° elevation, or eye/high/low class changes);
  - lens (≥ 1.4× focal length);
  - movement (fixed ↔ moving).
- **C4. No jump cuts.** Same subject → same subject needs ≥ 30° azimuth or ≥ 2 size steps.
- **C5. Cover the speaker by default.** Cut to the listener's reaction when a line lands ("I took
  the job. In Lisbon." plays on Ben).
- **C6. Get closer as tension rises.** Wide to establish → over-the-shoulder → MCU → CU at the peak.
  Pull back out on release or exit.
- **C7. Match the reverse shots.** Shots of the two characters use the same size, lens and height on
  both sides, unless an imbalance is deliberate (power shift).
  *Measurable:* compare paired singles.
- **C8. Keep eyelines consistent.** In singles, each character looks toward the frame side where the
  other is. This follows from C1.
- **C9. Re-establish on entrances.** A new character entering (the barista) gets a wider shot.
- **C10. Move the camera only for a reason.** Follow an actor (Ben walking out) or push in on a
  beat. Otherwise stay fixed.
- **C11. Lens by size.** About 24–35 mm for wide shots, 50–85 mm for closeups.

Measurable by code: C1/C2, C3, C4, C7 (and C11 as a soft warning).
Judgment for the model: B1, B4, B5, C5, C6, C9, C10.

## What exists today (relevant code)

- `src/ai/agent.ts`: `runTurn` loop, **`MAX_ROUNDS = 8`**. The system prompt is rebuilt every round.
- `src/ai/tools.ts`: tools per step (`toolsFor`). Shot tools (`place_characters`, `frame_camera`,
  `set_camera`, `camera_mode`, `place_props`) all act on **the open shot only** (`editorShot`).
  `frame_camera` already does sizes, subjects, angle relative to the subject's facing, height and
  lens. `snapshot` only captures the visible canvas.
- `src/ai/context.ts`: `STEP_GUIDE` (one fixed paragraph per step) and `describeContext`. Outside
  the shot editor, the shots step only gets a one-line summary per shot.
- `src/shots/setup.ts`:
  - `effectiveShots` derives each shot's setup. Unedited shots carry over the previous setup on the
    same stage (`carryOver`).
  - `speakersInShot` / `charactersInShot` already exist.
  - `subjectsFor` and `frameSubjects` (`src/three/camera.ts`) compute framing. `SHOT_SIZES` is
    there too.
- `src/shots/commands.ts`: `addActor`, `setActorKey`, `setCamera`, `setCameraFixed`, … (all
  undoable commands).
- `src/export/render.ts`: `FilmRenderer(project, w, h, { captions:false, shotNumbers:true })`,
  `renderShot(shotId, u)` and `toBlob()`. It already renders any shot offscreen; used by
  `renderPrevisClip` in `src/video/shotVideo.ts`.
- `tests/comfy.live.test.ts`: the pattern for a live test gated on an env var.

## Work plan

### 1. Skills mechanism (`src/ai/skills/`)
- `src/ai/skills/shotByShot.ts` (or `.md` imported with `?raw`): the rules above plus a procedure
  for each pass. For example, blocking:
  1. Read the scene.
  2. List the beats.
  3. Decide the floor plan and line of action.
  4. Call `block_shots` for all shots.
  5. Render.
  6. Fix.
- A small registry: `{ id, title, triggers, text, tools, maxRounds }`.
- Loading: a `use_skill` tool the model calls when the request matches, which puts the skill text
  into the system prompt for the rest of the turn. Optionally also a UI entry (chat suggestion
  chips "Block the scene" / "Plan the camera", see `src/ai/suggestions.ts`).
- Raise the round limit while a skill is active (e.g. 24), still abortable.

### 2. Whole-scene context
When the skill is active, `describeContext` adds, per shot in the target scene:
- the number;
- the stage;
- the duration;
- its lines (with speakers);
- each actor's start/end key (x, z, yaw, pose);
- the camera start/end (target, arc, angle, distance, lens);
- which shots have been edited by hand.

Keep it compact. Cap the number of lines.

### 3. Multi-shot tools (shots step, no shot needs to be open)
- **`block_shots`**: `{ shots: [{ number, actors: [{ name, start: {x,z,yaw?|face?,pose}, end?: {…} }], props?: [...] }] }`.
  - Validates names and positions against stage footprints (reuse `freeSpotFor` /
    `worldRect` from `src/staging/placement.ts`).
  - Returns per-shot warnings (actor inside furniture, start ≠ previous end without a
    script reason).
- **`cover_shots`**: `{ shots: [{ number, subjects, size, angle?, height?, lens?, at?, end?: {...} }] }`.
  - Reuses `frame_camera`'s math (`frameSubjects`, `subjectsFor`) per shot.
  - `end` makes the camera move.
- Both dispatch ordinary commands so Undo works. Consider one grouped command per call so a whole
  pass is a single undo step (check `src/state/commands.ts` / store for batching).
- Keep the existing single-shot tools as they are.

### 4. `check_coverage` (pure function + tool)
- `src/shots/coverage.ts`: `checkCoverage(project, shotIds?) → { cut: 'a→b', rule, severity, message }[]`.
  - The line of action per scene comes from the two speaking leads' positions. Recompute it when an
    actor's position changes a lot.
  - Classify each shot's camera side, size step (nearest `SHOT_SIZES` from distance/lens/subject
    height), azimuth relative to the axis, elevation class, lens and movement.
  - Rules C1/C2, C3 (warning), C4 (error), C7 and C11 (info).
- A tool that wraps it and returns a short report. The skill tells the agent to run it after every
  camera change and before finishing.
- Unit tests in `tests/coverage.test.ts`, with a hand-written cafe plan that passes and variants
  that break each rule.

### 5. `render_shots` (look at the work)
- Tool: `{ shots: string[], at?: 'start'|'middle'|'end'|'all' }`, at most ~6 shots per call.
- Uses `FilmRenderer` with `shotNumbers: true` and no captions, at small size (e.g. 384 px wide per
  frame). Draws a grid (rows = shots, columns = start/middle/end) onto one canvas → JPEG data URL
  → `ctx.attachImage(url, caption)`.
- Dispose the renderer after each call (WebGL contexts are limited on iOS).
- Expose `renderContactSheet(project, shotIds)` from a non-AI module so it can be unit-tested
  where WebGL is available. In jsdom, test only the grid layout and the tool wiring with a mocked
  renderer.

### 6. Prompt and step guide
- In the shots step, list `block_shots`, `cover_shots`, `check_coverage` and `render_shots` (in
  addition to the existing tools) outside the shot editor.
- `STEP_GUIDE.shots` mentions the skill exists ("for whole-scene blocking or coverage, use the Shot
  by Shot skill").

### 7. Testing
- **Offline (CI):**
  - `tests/coverage.test.ts`: the checker rules.
  - `tests/agentSkills.test.ts`: skill loading, multi-shot tools on the sample project (import
    `samples/cold_coffee.txt` through the app's import path, build a cafe stage
    programmatically), Undo of a whole pass.
- **Live (manual):** `tests/agent.live.test.ts`, skipped unless `OPENAI_API_KEY` is set.
  - Loads the sample project with a cafe stage.
  - Runs `runTurn` with "Block the scene", then "Plan the camera".
  - Prints `check_coverage` results and writes a contact sheet PNG for review.
  - Needs a node-side `apiKey()` override (today it reads browser settings). Inject the key
    through `TurnOptions` or mock `getSetting`.
  - Rendering in node needs WebGL. Either run that part in Playwright against the dev server
    (Chromium is preinstalled at `/opt/pw-browsers/chromium`), or skip images in the live test
    and review on the phone.
- **On the phone:** run both passes on the real Cold Coffee project and review in Previs.

## Environment setup (for live tests in a cloud session)
- Environment settings → Network access: add **`api.openai.com`** to Allowed domains (it is blocked
  today), keeping package managers allowed.
- Environment settings → Network secrets (or environment variables): **`OPENAI_API_KEY`**.
- Both take effect in a **new** session.

## Milestones
1. Skills mechanism + whole-scene context + `block_shots` + `render_shots`, with tests. PR.
2. `check_coverage` + `cover_shots` + camera procedure in the skill, with tests. PR.
3. Live run on Cold Coffee, then tune the skill text from what the agent gets wrong. PR(s).

## Milestone 1 notes (what was built, what live runs showed)
- `src/ai/skills/`: registry + `shotByShot.ts` (blocking rules B1–B6, blocking procedure, camera rules for
  reference). A request matching the trigger ("block the scene") loads the skill up front; the model can also
  call `use_skill`. While a skill is active: 24 rounds, and `describeScene` adds every shot's lines, blocking and
  camera plus each stage's footprints.
- `block_shots` checks all names and face targets before changing anything (a mid-call error used to leave a
  half-blocked scene that the model then reported as done). Warnings: inside furniture (seats and doors exempt),
  outside the room, sitting with no seat, overlaps, continuity with the previous shot on the stage
  (walking↔standing is fine), and action sentences with a movement verb whose character doesn't move.
- `render_shots` has `view: "overhead"` (4:3 frames from high at the front, fitted to furniture and people),
  because unplanned auto cameras often show only someone's back.
- A pass is one undo step already: everything in one assistant reply shares a tag (`undoTag`).
- Live harness: `tests/live/sheet.html` renders with the app's own renderer in headless Chromium, driven from
  node by `tests/live/browser.ts` (Vite dev server + the global Playwright). `tests/render.live.test.ts`
  (`LIVE_RENDER=1`) and `tests/agent.live.test.ts` (`LIVE_AGENT=1` + `OPENAI_API_KEY`) write sheets and a log to
  `live-output/`. The fixture `tests/fixtures/coldCoffee.ts` furnishes the cafe and adds a Street stage.
- Live runs (gpt-5-mini, ~100–150 s, 2–5 tool rounds): with the warnings above the model fixes everything it is
  told about and the blocking reads (Ben enters and sits, barista serves and retreats, Ben exits, Nora alone).
  Still weak, for milestone 3: it often renders a sample instead of every shot, and its summary can overstate.

## Milestone 2 notes
- The assistant now uses the OpenAI **Responses API** (`src/ai/chat.ts`; stateless, `store: false`, encrypted reasoning
  carried between tool rounds). gpt-6.x models only take tools there. Default model **gpt-5.5**; the automatic pick is
  cached apart from the user's choice (old auto-saved picks are treated as automatic once); Settings has a dropdown.
- `src/shots/coverage.ts` (pure): classifies each shot (subject, single / over-the-shoulder / group / insert, size from
  the frame height at the subject, bearing, height class, lens, movement, side of the line) and checks C1/C2 (side held
  from the last shot that set it; bridges: on the line, an insert, a lead moving > 0.75 m, a camera move that crosses),
  C3 (angle = bearing around the same subject, or the camera's turn for a new subject), C4, C7 (pairs of the same kind
  within one size step), C11, and `view` (a room wall or wall between camera and aim point).
- `cover_shots` takes the line of action plus a side instead of signed angles (the tool picks the sign per shot, so
  reverses can't cross by accident); `over` for over-the-shoulders, `on` for inserts sized to the object, `end` for a
  move. Cameras that would sit behind a wall are pulled in with a wider lens. A line may end at an object for a walk.
- Fixed on the way: seated heads are at 79% of standing height (was 72%, so seated closeups in the app cut the head).
- Live (both passes, all 18 shots, one run each): gpt-5.5 129 s, matched reverses, a couple of weak frames;
  gpt-6.1-sol 44 s, more varied coverage, reverses deliberately unmatched. Both end with only C7 advice.
- Milestone 3 handled furniture occlusion, inserts and exits (below).

## Milestone 3 notes (tuning from live runs)
Seven live runs of both passes on Cold Coffee (gpt-5.5 ×4, gpt-6.1-sol ×3); every run blocked and covered all 18
shots and ended with only C7 advice. What the runs showed, and what changed:
- Furniture hiding the subject (the counter in 1.12): `view` now also checks tall furniture (≥ 0.3 m, not doors or
  windows) on the line to the subject's head, leaving out the last 35 cm so their own chair or table doesn't count.
- Heads cut off when someone stands up in a fixed shot (Ben's exit): new `frame` warning when the subject's head
  ends above the frame while still across it (walking out sideways is fine).
- Over-the-shoulders crowded by the foreground head: the camera stands 1 m behind the foreground person and swings
  until their head sits about two thirds of the way to the frame's edge.
- Too many inserts (gpt-5.5 used 4–5 of 16 shots; 2–3 after): new rule C12, inserts only for "CLOSE ON" lines and
  props the story turns on; feelings play on faces.
- Props put in the same spot (the mug on the envelope): `block_shots` warns.
- The saved reply is the model's final summary, not its announcement plus the summary.
- Seats and platforms (#32, #33): people sit on stools at the seat's height with their weight over it, and stand on
  boxes, cylinders and planes.

Model notes: gpt-6.1-sol was faster in every run (about 90–105 s for both passes, against 120–190 s for gpt-5.5) and
followed C12 most closely; gpt-5.5 matched reverses more often. Both are good choices; the default stays gpt-5.5.

## Open questions
- Scope of "the scene": settled in the skill text: the shots the user names, else the open shot's scene, else every
  scene listed.
- Should a pass be one undo step? (Plan: yes, if the store supports grouping cheaply.)
- Cost guard: show the user a rough token estimate before a full-scene pass?

## Also pending
- PR #29 (shot video prompt: voices and sound effects only, no music) is open and not merged.

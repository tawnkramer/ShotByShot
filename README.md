# ShotByShot

Mobile-first shot breakdown and previs web app. A static site (GitHub Pages) built with three.js. Projects are stored in the browser and can be saved as a project file. An AI assistant uses your own API key (OpenAI first).

Workflow: **Story → Staging → Characters → Props → Shots → Previs → Export**

See [docs/PLAN.md](docs/PLAN.md) for the product and technical plan.

## Development

```sh
npm install
npm run dev        # dev server, also reachable from a phone on the same network
npm test           # unit tests
npm run build      # production build in dist/
```

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml` (set **Settings → Pages → Source** to **GitHub Actions** once the repo is public).

## Character images

In Characters, open a character and choose **Generate character image**. A separate
image editor opens above the chat bar (full-screen on phones). Its editable prompt
starts from the character's name, sex, height, build, age and appearance notes.
Choose an image model and quality, then generate one portrait image using the
OpenAI key saved in Settings. Generation incurs charges on that API account;
model availability and any verification requirements depend on the account.

Preview the result before choosing **Use image**. Saved artwork appears on the
character card and can be viewed alongside the 3D mannequin using the viewport
toggle. It does not change the mannequin or shot renders. **Download** saves a
PNG; project `.sbs.zip` exports include saved images and prompts, and image
replacement supports Undo. Only the currently saved image is retained in the
project. Closing or canceling stops waiting for a request; OpenAI may still
complete and bill an already-started generation. The API key is never exported.

## ComfyUI Cloud and shot videos

Settings → **ComfyUI Cloud** stores a Comfy API key (from platform.comfy.org) in
this browser and imports workflows exported from ComfyUI with **Workflow → Export
(API)**, in four categories: image generation, image editing, text to speech and
image to video. Each import is analyzed for what the app can fill in: Load Image,
Load Audio and Load Video nodes, the prompt input (changeable per workflow), seed,
a duration primitive titled “duration”, and width/height. Workflows live in
browser settings and are never exported with projects.

In a shot's **Image** tab, **Generate Shot Video** opens a full-screen panel.
Each media input of the chosen video workflow is filled from the shot: the shot
image, a greyscale previs frame, character and stage images, generated dialogue
audio, or a previs clip rendered from the shot's camera and blocking. The
generated prompt (hidden by default) refers to inputs as `<Picture 1>`,
`<Audio 1>`, `<Video 1>` in order; anything typed in **Additional prompt** is
appended with the highest priority. The run uses the shot's duration, a fresh
seed and, optionally, the project aspect ratio at the workflow's pixel budget.

Jobs run through the Comfy API v2 (`/api/v2/assets`, `/api/v2/jobs`). Canceling
asks Comfy Cloud to stop the job. Costs can't be estimated in advance: Comfy Cloud
bills GPU run time on your plan, and partner nodes bill credits. To send more
references (for example MiniMax H3's reference mode), add more loader nodes wired
to the model's inputs in ComfyUI and export again. The image, editing and speech
workflows can be imported and checked here, but aren't yet selectable in the
image and voice editors.

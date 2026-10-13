# ShotByShot

Mobile-first shot breakdown and previs web app. A static site (GitHub Pages) built with three.js. Projects are stored in the browser and can be saved as a project file. An AI assistant uses your own API key: OpenAI or Google Gemini.

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

## Assistant models

The assistant runs on OpenAI or Google Gemini. Save an OpenAI key, a Gemini key
(from [Google AI Studio](https://aistudio.google.com/apikey)), or both in Settings, then
pick the **Assistant model** there. **Automatic** uses OpenAI when an OpenAI key is
saved and Gemini otherwise. Each key is stored only in this browser and sent only to
its own provider. Images and dialogue voices always use the OpenAI key.

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

Comfy Cloud's API sends no CORS headers, so the browser reaches it through a
small relay you deploy once to your own Cloudflare account (free plan is enough).
Settings → **ComfyUI Cloud** → **Set up relay on Cloudflare** opens Cloudflare's
deploy page for this repo. Its root `wrangler.jsonc` deploys [`relay/`](relay/), a Worker that forwards `/api/...` to
cloud.comfy.org and `/storage?url=...` to Comfy's signed storage URLs, adds CORS
headers for the sites in `ALLOWED_ORIGINS` (in `wrangler.jsonc`), and stores
nothing. Paste the Worker's address (`https://shotbyshot.<you>.workers.dev`)
into the relay field. Connecting the repo in the Cloudflare dashboard and pressing Deploy works too, as does
`npx wrangler deploy` from the repo root.
The app's Content Security Policy allows relays on `*.workers.dev`.

Settings → **OpenArt** → **Sign in with OpenArt** connects your OpenArt account
(OAuth with PKCE; the app registers itself with OpenArt on first use). The sign-in
is kept in this browser, and calls to OpenArt's MCP server
(`https://mcp.openart.ai/mcp`) and its token endpoint go through the same relay
(`/openart/mcp`, `/openart/oauth/*`), since OpenArt sends no CORS headers either.
**Show tools** lists what OpenArt offers, and read-only tools can be run there.
Once signed in, the shot **Video** panel offers Seedance 2.5, 2.0 Fast and 2.0 Mini
on OpenArt, paid with your OpenArt credits and priced by OpenArt before you generate.
It sends the same shot references as the Comfy Seedance workflow (element2video);
uploads and results pass through the relay's `/openart/media` route. A relay deployed
before this needs one redeploy.

Settings → **ComfyUI Cloud** also stores a Comfy API key (from
[your Comfy platform profile](https://platform.comfy.org/profile/home)) in
this browser and imports workflows exported from ComfyUI with **Workflow → Export
(API)**, in four categories: image generation, image editing, text to speech and
image to video. Each import is analyzed for what the app can fill in: Load Image,
Load Audio and Load Video nodes, the prompt input (changeable per workflow), seed,
a duration primitive titled “duration”, and width/height. Workflows live in
browser settings and are never exported with projects.

In a shot's **Image** tab, **Generate Shot Video** opens a full-screen panel.
**Seedance 2.5 reference to video** is built in and selected by default. It is a
Comfy partner node billed in Comfy credits, and it takes lists of reference
images (up to 30), videos (up to 10) and audio clips (up to 10). The panel
pre-selects the shot image, character and stage images, the dialogue audio, and
a previs clip rendered from the shot's camera and blocking (shots of at least
1.8 s) as a camera-motion reference. Tick or untick them as needed; the app adds
one loader node per file. Imported workflows with fixed Load Image, Load Audio or
Load Video nodes, such as MiniMax H3, get a picker for each input instead.

The generated prompt (hidden by default) names inputs the way the model expects:
`Image 1`, `Video 1`, `Audio 1` for reference lists, or `<Picture 1>` for fixed
inputs. Anything typed in **Additional prompt** is appended with the highest
priority. Each run uses the shot's duration within the workflow's limits
(Seedance: whole seconds, 4–30 s), a fresh seed, and optionally the closest
supported aspect ratio or size for the project.

Jobs run through the Comfy API v2 (`/api/v2/assets`, `/api/v2/jobs`). Canceling
asks Comfy Cloud to stop the job. Seedance runs show an estimated price ported
from ComfyUI's published rates. GPU workflows can't be priced in advance, because
Comfy Cloud bills run time on your plan; the panel shows how long a run took.
**Qwen Image 2.1** text-to-image is built in once a Comfy key is saved, and its
prompt is used as written (the workflow's prompt rewriter stays off). Image
generation workflows appear under **ComfyUI Cloud** in every image editor's Model
menu (marked "prompt only" for stage, prop and shot images); image editing
workflows appear for stage, prop and shot images, receiving the greyscale 3D
preview and references as their input images. In Settings, each imported
workflow's prompt input is listed by the text it holds in the export. The prompt goes to the text the workflow's encoder actually reads
(followed back through switches, so prompt-rewriter system prompts are left
alone). Speech workflows can be imported and checked but aren't used yet.

To check a workflow against Comfy Cloud outside the browser:

```sh
COMFY_API_KEY=comfyui-… npx vitest run tests/comfy.live.test.ts
```

It runs `tests/fixtures/qwen_image_2_1_t2i.json` (or `COMFY_WORKFLOW=path`) with
the app's own client and writes `comfy-live-output.png`. The run is billed.

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

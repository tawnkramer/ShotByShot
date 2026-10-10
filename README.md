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

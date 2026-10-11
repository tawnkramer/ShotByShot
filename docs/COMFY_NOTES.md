# ComfyUI Cloud integration notes

State of branch `comfy-cloud-video` (handoff between sessions).

## Built
- Settings → ComfyUI Cloud: API key, workflow import by category (src/comfy/ComfySettings.tsx).
- Workflow analysis/binding (src/comfy/workflow.ts): loader slots, Seedance-style reference
  groups (`model.reference_{images,videos,audios}.*_N`), prompt tracing through switches,
  duration/ratio/seed/size.
- Comfy API v2 client (src/comfy/client.ts) and shared runner (src/comfy/run.ts).
- Shot video panel (src/video/ShotVideoEditor.tsx) with built-in Seedance 2.5 preset and cost estimate.
- Comfy workflows in the image editor's model menu (src/images/ConceptImageEditor.tsx).
- Live test: `COMFY_API_KEY=… npx vitest run tests/comfy.live.test.ts` (Qwen Image 2.1 fixture).

## CORS findings (checked 2026-10-11 with Origin: https://tawnkramer.github.io)
- `/api/v2/jobs`, `/api/v2/assets`: preflight → 401, no Access-Control-* headers. Browser blocked.
- v1 `/api/prompt`, `/api/upload/image`, `/api/job/*/status`, `/api/view`, `/api/queue`:
  preflight → 204 but no Access-Control-Allow-Origin. Browser blocked.
- `/mcp`: preflight → 204 with `Access-Control-Allow-Origin` echoing the origin, methods
  GET/POST/DELETE, headers Authorization, X-API-Key, Mcp-Session-Id, Mcp-Protocol-Version,
  Content-Type, Accept; exposes Mcp-Session-Id. Browser allowed.

So the REST client works from Node (live test) but not from the web app. Next step: a browser
transport that calls MCP tools over JSON-RPC (Streamable HTTP) without the assistant:
`upload_file`, `submit_workflow`, `get_job_status`/`wait_for_job`, `get_output` (signed URL),
`cancel_job`, `get_billing_status`. Still unverified: how `upload_file` accepts bytes, and
whether the signed output URL's storage host allows CORS.
- `/mcp` requires auth even for `initialize` (401 JSON-RPC error -32001, with CORS headers).
  OAuth is also offered: `/mcp/.well-known/oauth-protected-resource` → authorization server
  https://cloud.comfy.org (`/oauth/authorize`, `/oauth/token`, `/oauth/register`, PKCE S256),
  scopes `comfy-mcp:tools:read`, `comfy-mcp:tools:call`. A browser "Sign in with Comfy" may be
  possible later; use the API key for now.

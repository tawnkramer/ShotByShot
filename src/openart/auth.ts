import { relayUrl } from '../comfy/client';
import { deleteSetting, getSetting, setSetting } from '../storage/db';

/**
 * "Sign in with OpenArt": OAuth 2.0 authorization code flow with PKCE and dynamic client registration,
 * run entirely in the browser. OpenArt's token and registration endpoints send no CORS headers, so those
 * calls go through the user's relay (relay/, /openart/oauth/*). Tokens stay in this browser's settings.
 */
export const OPENART_AUTHORIZE = 'https://openart.ai/suite/api/auth/oauth/authorize';
export const OPENART_RESOURCE = 'https://mcp.openart.ai/mcp';
export const OPENART_TOKEN_SETTING = 'openart.token';
const CLIENT_SETTING = 'openart.client';
const PENDING_KEY = 'openart.signin';

export interface OpenArtToken { access: string; refresh?: string; expiresAt?: number }
interface PendingSignIn { state: string; verifier: string; clientId: string; redirectUri: string }

/** The page OpenArt sends the browser back to: the app's own root, without the hash route. */
export function redirectUri(loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  return `${loc.origin}${loc.pathname}`;
}

async function needRelay(): Promise<string> {
  const relay = await relayUrl();
  if (!relay) throw new Error('Set up the relay in Settings → ComfyUI Cloud first. OpenArt is reached through it too.');
  return relay;
}

async function postForm(url: string, body: Record<string, string>, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(body).toString() });
  } catch {
    throw new Error("Couldn't reach OpenArt through the relay. Check the relay address and redeploy it if it predates OpenArt support.");
  }
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data.error_description ?? data.error ?? `OpenArt returned an error (${res.status}).`));
  return data;
}

/** Registers this app with OpenArt once per redirect address and remembers the client id. */
async function clientId(relay: string, redirect: string, fetchImpl: typeof fetch): Promise<string> {
  const saved = await getSetting<{ id: string; redirectUri: string }>(CLIENT_SETTING);
  if (saved?.redirectUri === redirect) return saved.id;
  let res: Response;
  try {
    res = await fetchImpl(`${relay}/openart/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_name: 'ShotByShot', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'full_access' }),
    });
  } catch {
    throw new Error("Couldn't reach OpenArt through the relay. Check the relay address and redeploy it if it predates OpenArt support.");
  }
  const data = await res.json().catch(() => ({})) as { client_id?: string; error_description?: string; error?: string };
  if (!res.ok || !data.client_id) throw new Error(data.error_description ?? data.error ?? `OpenArt refused to register the app (${res.status}).`);
  await setSetting(CLIENT_SETTING, { id: data.client_id, redirectUri: redirect });
  return data.client_id;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const random = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)));
async function challenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Builds the OpenArt sign-in address and remembers what's needed to finish when the browser comes back. */
export async function beginSignIn(fetchImpl: typeof fetch = fetch, loc: Pick<Location, 'origin' | 'pathname'> = window.location): Promise<string> {
  const relay = await needRelay();
  const redirect = redirectUri(loc);
  const id = await clientId(relay, redirect, fetchImpl);
  const pending: PendingSignIn = { state: random(16), verifier: random(48), clientId: id, redirectUri: redirect };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const url = new URL(OPENART_AUTHORIZE);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: id, redirect_uri: redirect, scope: 'full_access', state: pending.state,
    code_challenge: await challenge(pending.verifier), code_challenge_method: 'S256', resource: OPENART_RESOURCE,
  }).toString();
  return url.toString();
}

/** True when the page was opened by OpenArt's redirect after sign-in. */
export function isSignInCallback(search = window.location.search): boolean {
  const params = new URLSearchParams(search);
  return (params.has('code') || params.has('error')) && params.has('state') && sessionStorage.getItem(PENDING_KEY) !== null;
}

/** Exchanges the returned code for tokens. Resolves to an error message, or undefined on success. */
export async function finishSignIn(search: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  const params = new URLSearchParams(search);
  const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as PendingSignIn | null;
  sessionStorage.removeItem(PENDING_KEY);
  try {
    if (!pending || params.get('state') !== pending.state) throw new Error('The OpenArt sign-in expired or came from another tab. Try again.');
    if (params.get('error')) throw new Error(params.get('error_description') ?? `OpenArt sign-in failed: ${params.get('error')}.`);
    const relay = await needRelay();
    const data = await postForm(`${relay}/openart/oauth/token`, {
      grant_type: 'authorization_code', code: params.get('code') ?? '', redirect_uri: pending.redirectUri,
      client_id: pending.clientId, code_verifier: pending.verifier, resource: OPENART_RESOURCE,
    }, fetchImpl);
    await saveToken(data);
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function saveToken(data: Record<string, unknown>, previous?: OpenArtToken): Promise<OpenArtToken> {
  if (typeof data.access_token !== 'string') throw new Error('OpenArt did not return an access token.');
  const token: OpenArtToken = {
    access: data.access_token,
    refresh: typeof data.refresh_token === 'string' ? data.refresh_token : previous?.refresh,
    expiresAt: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : undefined,
  };
  await setSetting(OPENART_TOKEN_SETTING, token);
  return token;
}

/** A valid access token, refreshed when it is about to expire. Throws when signed out. */
export async function accessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const token = await getSetting<OpenArtToken>(OPENART_TOKEN_SETTING);
  if (!token) throw new Error('Sign in with OpenArt in Settings first.');
  if (!token.expiresAt || token.expiresAt - Date.now() > 60_000) return token.access;
  if (!token.refresh) throw new Error('Your OpenArt sign-in expired. Sign in again in Settings.');
  const relay = await needRelay();
  const client = await getSetting<{ id: string }>(CLIENT_SETTING);
  try {
    const data = await postForm(`${relay}/openart/oauth/token`, { grant_type: 'refresh_token', refresh_token: token.refresh, client_id: client?.id ?? '', resource: OPENART_RESOURCE }, fetchImpl);
    return (await saveToken(data, token)).access;
  } catch {
    await deleteSetting(OPENART_TOKEN_SETTING);
    throw new Error('Your OpenArt sign-in expired. Sign in again in Settings.');
  }
}

export async function signOut(): Promise<void> {
  await deleteSetting(OPENART_TOKEN_SETTING);
}

/** Started from main.tsx when the page loads as OpenArt's redirect; the Settings panel shows the outcome. */
export let pendingSignIn: Promise<string | undefined> | undefined;
export function completeSignInFromUrl(): void {
  if (!isSignInCallback()) return;
  const search = window.location.search;
  // Drop the code from the address bar and land on Settings, where the OpenArt panel waits for the result.
  window.history.replaceState(null, '', `${window.location.pathname}#/settings`);
  pendingSignIn = finishSignIn(search);
}

import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ShotEditor } from '../src/steps/shots/ShotEditor';
import { createProject } from '../src/state/schema';
import { useProjectStore } from '../src/state/store';
import type { ShotCanvasProps } from '../src/steps/shots/ShotCanvas';

vi.mock('../src/steps/shots/ShotCanvas', () => ({ ShotCanvas: (p:ShotCanvasProps) => {
  useEffect(() => { p.onCaptureReady?.(async () => ({blob:new Blob(['frame'],{type:'image/png'}),characterIds:[],progress:0.5})); return () => p.onCaptureReady?.(null); }, [p.onCaptureReady]);
  return <div data-testid="canvas" data-view={p.view} data-selectable={String(p.selectable)} />;
}}));
vi.mock('../src/steps/shots/CameraPad', () => ({CameraPad:()=> <div data-testid="camera-pad"/>}));
vi.mock('../src/steps/shots/BlockingPanel', () => ({BlockingPanel:()=> <div data-testid="blocking"/>}));
vi.mock('../src/steps/shots/CameraPanel', () => ({CameraPanel:()=> <div data-testid="camera"/>}));
vi.mock('../src/steps/common/AudioPanel', () => ({AudioPanel:()=>null}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();vi.restoreAllMocks();await useProjectStore.getState().close();});

it('provides three tabs, captures the shot view, and retains direction after leaving Image', async()=>{
  const project=createProject('Shot UI');
  project.script.push({id:'line',index:0,type:'action',text:'A quiet cafe.'});
  project.shots.push({id:'shot',number:'1.1',lineIds:['line']});
  useProjectStore.getState().open(project);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(<MemoryRouter><ShotEditor shotId="shot"/></MemoryRouter>));
  const tabs=[...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.map(t=>t.textContent?.trim())).toEqual(['Blocking','Camera','Image']);
  await act(async()=>tabs[2].click());
  expect(tabs[2].getAttribute('aria-selected')).toBe('true');
  expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  expect(host.querySelector('[data-testid="blocking"]')).toBeNull();
  expect(host.querySelector('[data-testid="camera-pad"]')).toBeNull();
  expect(host.querySelector('[data-testid="canvas"]')?.getAttribute('data-view')).toBe('shot');
  const input=host.querySelector('textarea')!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Warm sunset lighting');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  expect(useProjectStore.getState().project!.shots[0].imagePrompt).toBe('Warm sunset lighting');
  await act(async()=>tabs[1].click());
  expect(host.querySelector('[data-testid="camera"]')).not.toBeNull();
  await act(async()=>tabs[2].click());
  expect(host.querySelector('textarea')!.value).toBe('Warm sunset lighting');
});

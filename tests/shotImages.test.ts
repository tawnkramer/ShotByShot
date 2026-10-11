import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { SHOT_COMPOSITION_GUIDANCE, charactersInFrame, greyscalePixels, shotReferences, shotImagePrompt } from '../src/images/shotImages';
import { generateShotImage } from '../src/images/generate';
import { createProject } from '../src/state/schema';
import { newCharacter } from '../src/characters/commands';
import { putBlob } from '../src/storage/db';
import { setShotImage, setShotImagePrompt } from '../src/shots/commands';
import { emptyHistory, runCommand, undo } from '../src/state/commands';
import { referencedBlobKeys } from '../src/storage/projectIO';
import { encodeProjectZip, decodeProjectFile } from '../src/storage/projectFile';

function fixture() {
  const p = createProject('Shots');
  p.script.push({id:'line',index:0,type:'action',text:'Ben drinks coffee.'});
  p.shots.push({id:'shot',number:'1.1',lineIds:['line'],stageId:'stage',durationSec:4,durationLocked:true});
  p.characters.push(newCharacter('Ben', [], 'ben'),newCharacter('Offscreen', [], 'offscreen'));
  const image = (blob:string,prompt:string) => ({blob,prompt,model:'gpt-image-1.5',createdAt:1});
  p.characters[0].image=image('ben-art','Ben wears a red shirt.');
  p.characters[1].image=image('offscreen-art','A blue shirt.');
  p.stages.push({id:'stage',name:'Cafe',sceneLineIds:[],objects:[],image:image('stage-art','Warm cafe interior.')});
  return p;
}

describe('shot image references', () => {
  it('selects partially framed actors and excludes offscreen and behind-camera actors', () => {
    const root = new THREE.Group();
    for (const [id,x,z] of [['center',0,-5],['edge',2.5,-5],['outside',100,-5],['behind',0,5]] as const) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1,2,1)); mesh.position.set(x,0,z); mesh.userData.rigId=`actor:${id}`; root.add(mesh);
    }
    const camera = new THREE.PerspectiveCamera(60,1,0.1,100);
    expect(charactersInFrame(root,camera)).toEqual(['center','edge']);
  });
  it('excludes actors fully occluded by stage geometry', () => {
    const root = new THREE.Group();
    const actor = new THREE.Mesh(new THREE.BoxGeometry(1,2,1)); actor.position.z=-5; actor.userData.rigId='actor:hidden'; root.add(actor);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(10,10,0.2)); wall.position.z=-2; root.add(wall);
    const camera = new THREE.PerspectiveCamera(60,1,0.1,100);
    expect(charactersInFrame(root,camera)).toEqual([]);
    wall.visible=false;
    expect(charactersInFrame(root,camera)).toEqual(['hidden']);
  });
  it('makes reference pixels grey while preserving transparency', () => {
    const pixels = new Uint8ClampedArray([255,0,0,200,0,255,0,255]); greyscalePixels(pixels);
    expect([...pixels]).toEqual([54,54,54,200,182,182,182,255]);
  });
  it('loads only the stage and framed characters, labels images, and includes saved descriptions', async () => {
    const p=fixture(); await putBlob('stage-art',new Blob(['stage'])); await putBlob('ben-art',new Blob(['ben']));
    const refs = await shotReferences(p,p.shots[0],['ben','ben']);
    expect(refs.map(r=>r.blob)).toEqual(['stage-art','ben-art']);
    const prompt=shotImagePrompt(p,p.shots[0],{blob:new Blob(),characterIds:['ben'],progress:0.5},refs,'Rainy evening');
    expect(prompt).toContain('rough greyscale previs approximation'); expect(prompt).toContain('take precedence over the previs for poses'); expect(prompt).toContain('highest priority for modifications to pose and action'); expect(prompt).toContain('Image 2 is the stage'); expect(prompt).toContain('Image 3 is the character');
    expect(prompt).toContain('Warm cafe interior.'); expect(prompt).toContain('red shirt'); expect(prompt).toContain('Rainy evening'); expect(prompt).toContain('2.00 seconds');
    expect(prompt).not.toContain('Offscreen');
    expect(prompt).toContain(SHOT_COMPOSITION_GUIDANCE);
    expect(prompt).toContain(`Preview aspect ratio: ${p.aspect}.`);
    expect(SHOT_COMPOSITION_GUIDANCE).toContain('Do not introduce objects, windows, doors');
    expect(SHOT_COMPOSITION_GUIDANCE).toContain('off-screen windows or fixtures');
    expect(SHOT_COMPOSITION_GUIDANCE).not.toContain('overhead lights on the left');
    p.characters[0].image!.blob='missing-reference';
    await expect(shotReferences(p,p.shots[0],['ben'])).rejects.toThrow(/Ben.*missing/);
  });
  it('sends preview first and all appearance references in one multipart request', async () => {
    const fake=vi.fn(async()=>new Response(JSON.stringify({data:[{b64_json:'AQID'}]})));
    const reference=new Blob(['preview'],{type:'image/png'});
    await generateShotImage({apiKey:'key',prompt:'Shot',reference,referenceImages:[new Blob(['stage']),new Blob(['ben'])],aspect:9/16,model:'gpt-image-2.5-flare'},fake as typeof fetch);
    const [url,options]=fake.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    const form=options.body as FormData;
    expect(form.getAll('image[]').map(x=>(x as File).size)).toEqual([7,5,3]);
    expect(form.get('size')).toBe('864x1536');
    expect(form.get('prompt')).toBe('Shot');
  });
  it('persists additional direction without generating, and exports the full image context with undo', () => {
    const p=fixture(); const [next,h]=runCommand(p,emptyHistory(),setShotImagePrompt('shot','Rainy evening'));
    expect(next.shots[0].imagePrompt).toBe('Rainy evening'); expect(next.shots[0].image).toBeUndefined();
    expect(undo(next,h)[0].shots[0].imagePrompt).toBeUndefined();
    const image={blob:'render',guidanceBlob:'preview',prompt:'Full prompt',additionalPrompt:'Rainy evening',model:'gpt-image-1.5',createdAt:1,frameProgress:0.5,aspect:9/16,referenceImages:[{blob:'stage-art',name:'Cafe',kind:'stage' as const},{blob:'ben-art',name:'Ben',kind:'character' as const,characterId:'ben'}]};
    const [saved,history]=runCommand(next,h,setShotImage('shot',image));
    expect(referencedBlobKeys(saved)).toContain('preview');
    const assets=new Map(referencedBlobKeys(saved).map(key=>[key,new Uint8Array([1])]));
    const decoded=decodeProjectFile(encodeProjectZip({project:saved,assets}));
    expect(decoded.project.shots[0].image).toEqual(image); expect(decoded.project.shots[0].imagePrompt).toBe('Rainy evening');
    expect(decoded.assets.has('ben-art')).toBe(true); expect(undo(saved,history)[0].shots[0].image).toBeUndefined();
  });
});

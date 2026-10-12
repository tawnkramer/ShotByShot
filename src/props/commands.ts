import type { Command } from '../state/commands';
import { newId, type LibraryItem, type ObjectSource, type Project, type Prop } from '../state/schema';
import { defaultName } from '../staging/commands';

export function addProp(source: ObjectSource, name?: string, id = newId()): Command {
  return {
    label: `Add prop ${name ?? defaultName(source)}`,
    apply: (d) => {
      const base = name ?? defaultName(source);
      const names = new Set(d.props.map((p) => p.name));
      let unique = base;
      for (let n = 2; names.has(unique); n++) unique = `${base} ${n}`;
      d.props.push({ id, name: unique, source, defaultScale: 1 });
    },
  };
}

export type PropPatch = Partial<Pick<Prop, 'name' | 'defaultScale' | 'grey' | 'image'>> & { params?: Record<string, number> };

export function updateProp(id: string, patch: PropPatch, mergeKey?: string): Command {
  return {
    label: 'Edit prop',
    mergeKey,
    apply: (d) => {
      const p = d.props.find((x) => x.id === id);
      if (!p) return;
      if ('image' in patch) { if (patch.image) p.image = patch.image; else delete p.image; }
      if (patch.name !== undefined) p.name = patch.name;
      if (patch.defaultScale !== undefined) p.defaultScale = patch.defaultScale;
      if ('grey' in patch) {
        if (patch.grey === undefined) delete p.grey;
        else p.grey = patch.grey;
      }
      if (patch.params && (p.source.kind === 'library' || p.source.kind === 'primitive')) p.source.params = { ...p.source.params, ...patch.params };
    },
  };
}

export function deleteProp(id: string): Command {
  return {
    label: 'Delete prop',
    apply: (d) => {
      d.props = d.props.filter((p) => p.id !== id);
      // Placed copies stay on their stages; they just stop pointing at the library entry.
      for (const s of d.stages) for (const o of s.objects) if (o.propId === id) delete o.propId;
    },
  };
}

/** Words in action lines that suggest a library prop. */
const PROP_WORDS: [RegExp, LibraryItem][] = [
  [/\benvelopes?\b/i, 'envelope'],
  [/\b(glass|glasses|tumbler|shot glass)\b/i, 'glass'],
  [/\bbottles?\b/i, 'bottle'],
  [/\b(mugs?|cups?|coffee)\b/i, 'mug'],
  [/\b(phones?|cellphone|cell phone|smartphone|mobile)\b/i, 'phone'],
  [/\b(guns?|pistols?|revolvers?|handguns?)\b/i, 'pistol'],
  [/\b(knife|knives|blade|dagger)\b/i, 'knife'],
  [/\b(briefcases?)\b/i, 'briefcase'],
  [/\b(bags?|backpacks?|suitcases?|duffel)\b/i, 'bag'],
  [/\b(books?|notebooks?|diary|journal)\b/i, 'book'],
  [/\b(laptops?|computer)\b/i, 'laptop'],
  [/\blamps?\b/i, 'lamp'],
  [/\b(cars?|hatchbacks?|sedans?|suvs?|taxis?|cabs?)\b/i, 'car'],
];

export interface PropSuggestion {
  item: LibraryItem;
  mentions: number;
  example: string;
}

/** Props the script mentions that the project doesn't have yet. */
export function suggestProps(project: Project): PropSuggestion[] {
  const have = new Set(project.props.flatMap((p) => (p.source.kind === 'library' ? [p.source.item] : [])));
  const found = new Map<LibraryItem, PropSuggestion>();
  for (const l of project.script) {
    if (l.type !== 'action' && l.type !== 'camera') continue;
    for (const [re, item] of PROP_WORDS) {
      if (have.has(item) || !re.test(l.text)) continue;
      const s = found.get(item) ?? { item, mentions: 0, example: l.text };
      s.mentions++;
      found.set(item, s);
    }
  }
  return [...found.values()].sort((a, b) => b.mentions - a.mentions);
}

import type { Step } from '../../state/schema';
import { SHOT_BY_SHOT } from './shotByShot';

/** A set of instructions the assistant loads for a bigger job, for the rest of the turn. */
export interface Skill {
  id: string;
  title: string;
  /** When to use it, shown to the model in the use_skill tool. */
  description: string;
  /** Requests that load the skill without the model asking. */
  triggers: RegExp;
  steps: Step[];
  text: string;
  /** Tool rounds allowed while the skill is active. */
  maxRounds: number;
  /** Adds the whole scene (every shot's lines, blocking and camera) to the context. */
  sceneContext: boolean;
}

export const SKILLS: Skill[] = [
  {
    id: 'shot_by_shot',
    title: 'Shot by Shot',
    description: 'Block a whole scene (place and move every character in every shot) following directing rules. Use for "block the scene", "stage this scene", or blocking several shots at once.',
    triggers: /\b(block|stage)\b.*\b(scene|shots)\b/i,
    steps: ['shots'],
    text: SHOT_BY_SHOT,
    maxRounds: 24,
    sceneContext: true,
  },
];

export function skillById(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

export function skillsFor(step: Step): Skill[] {
  return SKILLS.filter((s) => s.steps.includes(step));
}

/** The skill a request clearly asks for, if any. */
export function matchSkill(text: string, step: Step): Skill | undefined {
  return skillsFor(step).find((s) => s.triggers.test(text));
}

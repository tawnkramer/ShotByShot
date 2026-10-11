import type { Project, Step } from '../state/schema';

/** Starter requests for each step, using the project's own names where it helps. */
export function suggestionsFor(step: Step, project: Project, inShotEditor: boolean): string[] {
  const [a, b] = project.characters.map((c) => c.name);
  switch (step) {
    case 'story':
      return ['Check my line labels and fix any mistakes.', 'Break this into shots the way an editor would.', 'Give the action beats their own shots.'];
    case 'staging':
      return ['Build a dive bar: a long bar with 4 stools, two tables with chairs, and a door.', 'Lay out this set from my photo.', 'Create a stage for every scene.', 'Take a look and tidy up anything overlapping.'];
    case 'characters':
      return ['Set up the characters from the script with ages, heights and fitting voices.', a ? `Give ${a} a tired, gravelly voice.` : 'Add a narrator with a calm voice.'];
    case 'props':
      return ['Model a vintage rotary phone.', 'Model a whiskey bottle and two tumblers.', 'Add the props the script mentions.'];
    case 'shots':
      return inShotEditor
        ? [
            'Frame a medium close-up on whoever speaks.',
            a && b ? `Over-the-shoulder on ${a}, from behind ${b}.` : 'Frame a wide shot of everyone.',
            a ? `Have ${a} walk to the bar during the shot.` : 'Make the camera slowly push in.',
            'Make this a slow push-in.',
          ]
        : ['Voice all the dialogue.', 'Which shots feel too short? Merge them.'];
    default:
      return ['Which shots run long?', 'Open the first shot of scene 2.'];
  }
}

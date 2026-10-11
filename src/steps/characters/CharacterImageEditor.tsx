import type { Character } from '../../state/schema';
import { ConceptImageEditor } from '../../images/ConceptImageEditor';
import { characterImagePrompt } from '../../images/generate';

export { ConceptImageEditor } from '../../images/ConceptImageEditor';

export function CharacterImageEditor({ character, onClose }: { character: Character; onClose: () => void }) {
  return <ConceptImageEditor subject={character} defaultPrompt={characterImagePrompt(character)} kind="character" onClose={onClose} />;
}

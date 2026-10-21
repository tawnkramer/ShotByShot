import type { FoundPerson } from '../../src/pose/detect';
import type { matchPhoto } from '../../src/pose/solveCamera';

/** What tests/live/pose.ts puts on the page for tests/pose.live.test.ts. */
declare global {
  interface Window {
    detectPhoto: (dataUrl: string) => Promise<{ width: number; height: number; people: FoundPerson[] }>;
    drawMatch: (dataUrl: string, person: FoundPerson, aspect: number) => Promise<{ image: string; result: ReturnType<typeof matchPhoto> }>;
  }
}

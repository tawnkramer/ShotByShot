import type { Step } from '../state/schema';
import { useProjectStore } from '../state/store';
import { ASPECT_RATIOS } from '../state/schema';

const COMING: Record<Step, { summary: string; milestone: string }> = {
  story: { summary: 'Import a text script, label each line, and break it into shots.', milestone: 'M1' },
  staging: { summary: 'Build grey-box sets from library items, primitives, and imported models.', milestone: 'M2' },
  characters: { summary: 'Define characters with height, build, and voice, shown as simple mannequins.', milestone: 'M3' },
  props: { summary: 'Import props or have the assistant model them.', milestone: 'M3' },
  shots: { summary: 'Frame each shot, block characters with start and end positions, and time the dialogue.', milestone: 'M4' },
  previs: { summary: 'Play every shot in order with captions and dialogue audio.', milestone: 'M7' },
  export: { summary: 'Render an MP4 and optional start/end stills for each shot.', milestone: 'M8' },
};

export function StepView({ step }: { step: Step }) {
  const project = useProjectStore((s) => s.project)!;
  const aspect = ASPECT_RATIOS.find((a) => a.id === project.aspect)!;
  const info = COMING[step];
  return (
    <div className="page">
      <div className="frame-preview" style={{ aspectRatio: String(aspect.ratio), width: `min(100%, calc(45dvh * ${aspect.ratio}))` }}>
        <span className="muted small">{aspect.label}</span>
      </div>
      <p>{info.summary}</p>
      <p className="muted small">This step is built in milestone {info.milestone}.</p>
    </div>
  );
}

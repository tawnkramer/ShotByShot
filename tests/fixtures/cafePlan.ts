/** A hand-made blocking and coverage of the Cold Coffee opening (1.1–1.11), for tests. */
const seated = [
  { name: 'Nora', start: { x: -1.5, z: -1.85, pose: 'sitting', face: 'Ben' } },
  { name: 'Ben', start: { x: -1.5, z: -0.55, pose: 'sitting', face: 'Nora' } },
];

export const CAFE_BLOCKING = {
  shots: [
    { number: '1.1', actors: [{ name: 'Nora', start: { x: -1.5, z: -1.85, pose: 'sitting', face: 'Front chair' } }], props: [{ prop: "Nora's mug", x: -1.6, z: -1.35, y: 0.75 }, { prop: "Ben's mug", x: -1.4, z: -1.05, y: 0.75 }] },
    { number: '1.2', actors: [{ name: 'Nora', start: { x: -1.5, z: -1.85, pose: 'sitting', face: 'Front chair' } }, { name: 'Ben', start: { x: 2.4, z: 1, pose: 'walking', yaw: -90 }, end: { x: -1.5, z: -0.55, pose: 'sitting', face: 'Nora' } }] },
    ...['1.3', '1.4', '1.5', '1.6', '1.7', '1.8'].map((number) => ({ number, actors: seated })),
    { number: '1.9', actors: seated, props: [{ prop: 'Envelope', x: -1.5, z: -1.45, y: 0.75, end: { z: -0.95 } }] },
    { number: '1.10', actors: seated },
    { number: '1.11', actors: seated },
  ],
};

/** Camera on Nora's left looking at Ben (+X, the open side of the room). */
export const CAFE_COVERAGE = {
  line: { from: 'Nora', to: 'Ben', side: 'left' },
  shots: [
    { number: '1.1', subjects: ['Nora'], size: 'WS' },
    { number: '1.2', subjects: ['Nora', 'Ben'], size: 'WS', end: { size: 'MS' } },
    { number: '1.3', subjects: ['Ben'], over: 'Nora', size: 'MS' },
    { number: '1.4', subjects: ['Ben'], size: 'MCU', angle: 35 },
    { number: '1.5', subjects: ['Nora'], over: 'Ben', size: 'MS' },
    { number: '1.6', subjects: ['Ben'], size: 'MCU', angle: 35 },
    { number: '1.7', subjects: ['Nora'], size: 'MCU', angle: 35 },
    { number: '1.8', subjects: ['Ben'], size: 'CU', angle: 25, lens: 85 },
    { number: '1.9', subjects: ['Nora', 'Ben'], size: 'MS', height: 'high' },
    { number: '1.10', subjects: [], on: 'Envelope', size: 'CU' },
    { number: '1.11', subjects: ['Nora'], size: 'CU', angle: 25, lens: 85 },
  ],
};

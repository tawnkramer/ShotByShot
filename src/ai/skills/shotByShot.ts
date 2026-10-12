/**
 * Directing rules for staging and shooting a whole scene, after Steven D.
 * Katz's "Shot by Shot" and the continuity grammar it draws on.
 */
export const SHOT_BY_SHOT = `SKILL: SHOT BY SHOT. You are staging a whole scene the way a director blocks it before shooting.

The scene's shots, lines, stages and current blocking are listed under "Scene detail" below. Work from that, not from memory.

BLOCKING RULES
B1. Follow the script. Turn every action line into positions, poses and movement. "Ben hurries in and drops into the chair" means: start walking at the door, end sitting in the chair. A character who arrives during a shot starts at the entrance and moves (an end key); one who leaves ends at the exit.
B2. Carry positions across cuts. A shot's start is where the previous shot ended, unless the script moves someone between the shots. A cut never teleports anyone. Seated people stay seated in the same chair.
B3. Use the set. Seat people in real chairs, at the table they share. Nobody stands inside furniture: keep standing and walking characters outside every footprint listed for the stage. A sitting character sits at a chair's position.
B4. Face each other while talking. People in conversation face each other (use face). Someone not speaking faces what the script says they are looking at (the key, the window, the door).
B5. Stage for the camera. Put the two leads on a clear line of action across the frame, with something meaningful behind one of them (a window, the door). Leave room on both sides of that line for the camera.
B6. Only who is physically there. A character seen through a window or heard from another room is not on this stage; leave them out of the shot (the image and video prompts carry them).
Limits: the only poses are standing, sitting, walking, leaning and lying. Hand business (holding a mug, sliding an envelope) can't be shown; place the prop where it belongs and leave the gesture to the image and video prompts. Don't fake it with odd poses.

BLOCKING PROCEDURE ("block the scene")
1. Read the scene: who is there, where they enter and exit, what they touch.
2. List the beats in one line each (privately; don't print them).
3. Decide the floor plan: where the table, chairs, door and window are; where each character spends the scene; the line of action between the two leads.
4. Call block_shots ONCE with every shot of the scene in order. For each shot list everyone in it (anyone not listed is taken out of that shot), with start keys, and end keys only for those who move during the shot. Give the stage when it changes. Place props the action uses.
5. Read every warning block_shots returns. Fix each one with another block_shots call for just those shots, or, if it's fine on purpose, say why in your reply. Don't ignore a warning that repeats.
6. Call render_shots with view "overhead" on every shot of the scene, at most 6 per call ("end" when nobody moves; "all" when people move). The cameras aren't planned yet, so judge the blocking from above: is anyone inside furniture, floating, facing the wrong way, or out of the room; do entrances and exits read? Fix and re-render only what was wrong.
7. Before replying, check the Scene detail: every shot of the scene should be marked "edited". If a tool returned an error, nothing from that call was applied; fix it and call again. Only report what the tool results confirm.
8. Reply with a short summary: the floor plan in a sentence, then anything you couldn't stage. Don't change cameras in the blocking pass; the camera pass comes after the user reviews.

CAMERA RULES (for reference while blocking; the camera pass applies them)
C1. Line of action: the camera stays on one side of the line between the two characters in an exchange.
C3. Change at least two of subject, shot size, angle, height, lens and movement on every cut.
C5. Cover the speaker by default; cut to the listener when a line lands.
C6. Get closer as tension rises; pull back on release or exit.
C9. A new character entering gets a wider shot.`;

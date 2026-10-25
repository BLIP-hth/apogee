# Build Prompt — Project LIFTOFF

> Paste this whole file as a prompt to build the site. It is written so an AI
> coding agent can execute it end to end.

## The one line

Build a jaw dropping 3D rocket website that is three experiences in one seamless
scene: a museum showcase, an exploded engineering view, and a full launch
simulator. The user explores a legendary rocket, takes it apart just by zooming
in, puts it back together by zooming out, then hits a LAUNCH button and rides it
to space from a mission control cockpit.

## Start from what exists

There is already a working single page site in this folder (`index.html`,
`rockets.js`, `main.js`) built with Three.js r0.128.0 loaded from a CDN, no build
step, opens by double click. Each rocket is generated procedurally from a list of
labeled parts, and hovering a part shows a tooltip explaining what it does and why.
Keep that foundation. Keep it copyright free (no downloaded models). Keep it a
single page that just opens. Build the new features on top. For now only Saturn V
is switched on and that is fine.

## The three modes and how they blend

There are no hard page changes. One continuous 3D scene. The camera distance and a
LAUNCH button decide which mode the user is in. Transitions are always smooth and
animated, never a cut.

### Mode 1. Showcase (far zoom)

The rocket stands whole on a glowing launch pad in a starfield. Slow auto rotate.
Drag to orbit, scroll to zoom. A side panel shows the rocket name, key stats, and
its missions. This mostly exists already, keep and polish it.

### Mode 2. Exploded view (zoom in)

As the user scrolls in past a threshold, the rocket smoothly comes apart. Every
component slides out along the vertical axis and spreads into a floating, evenly
spaced stack of separated pieces, like an engineering diagram in mid air. Thin
connector lines or subtle guide rails link each piece back to its home position.

- The separation is driven by zoom distance, so it feels physical. Zoom halfway in,
  it is half exploded. Zoom all the way in, fully apart.
- Scroll back out and every piece glides back into place and becomes the whole
  rocket again, automatically. No button needed.
- In this mode every floating piece is clearly labeled, and hovering or clicking a
  piece highlights it, dims the rest, and shows a rich panel: what it is, why it is
  there, how it is built, and how it helps the mission. Reuse the existing part data
  and expand it.
- Bonus: a small cutaway feel. Where it makes sense, show a hint of internals like
  fuel tanks or engines inside a stage.

### Mode 3. Launch simulator (the payoff)

Below the scene sits a mission control bar with a big glowing LAUNCH button, plus a
few readouts styled like a cockpit. When the user commits to launch:

1. A T minus countdown runs (say 10 seconds) with beeps and a status readout
   cycling through real sounding callouts: guidance internal, ignition sequence
   start, and so on.
2. At zero the engines ignite. Show exhaust plume, glow, and a billow of smoke and
   steam across the pad. Screen shake.
3. The rocket lifts off. The camera tracks it as it climbs. The launch pad and Earth
   fall away below.
4. Live telemetry updates the whole way up: altitude, speed, G force, fuel, and a
   thin trajectory arc.
5. Staging happens on the way. Spent stages separate and tumble away with a callout
   on screen, exactly matching how that real rocket stages. The lighter vehicle
   keeps accelerating.
6. It breaks through into space. Sky fades from blue to black, stars intensify, the
   curve of Earth appears below, and the final stage settles into orbit with a
   satisfying arrival moment.
7. A RESET or RETURN TO PAD control brings the rocket gently back to the showcase.

Make the launch feel like a real, tense, awesome event. Sound, shake, particles,
pacing. This is the money shot.

## Feel and polish

- Cinematic and premium. Deep space dark, crisp type, glassy panels, tasteful glow.
  Think a modern space agency mission page, not a toy.
- Every state change animates. Nothing snaps or pops.
- Add engine glow and exhaust particles even in idle so the rocket feels alive.
- Subtle ambient hum in showcase, a swelling score during launch, thunder at ignition.
- Works on a laptop at 60 fps. Keep the particle counts sane.
- First time hint so people discover that zooming explodes the rocket.

## Technical direction

- Stay on Three.js, single page, no build step, CDN loaded, opens by double click.
- Exploded view is easy because parts are already separate meshes. Give each part a
  home position and an exploded position and interpolate between them by a single
  explode factor that is derived from camera distance.
- Drive the whole thing with a small state machine: SHOWCASE, EXPLODED, COUNTDOWN,
  ASCENT, ORBIT. Camera behavior, controls, and UI switch cleanly per state.
- Telemetry is a simple physics loop good enough to look real, not a NASA sim.
- Keep all data in `rockets.js` so new rockets and new parts stay easy to add.
- Everything copyright free and generated in code. No external model or texture
  downloads. Sounds can be generated with the Web Audio API or a tiny free set.

## Scope and phasing

Build it in this order so there is something great to see at each step:

1. Exploded view on zoom with reassemble, using existing parts and tooltips.
2. LAUNCH button, countdown, ignition effects, and liftoff with camera tracking.
3. Telemetry readouts and in flight stage separation.
4. Reach space and settle into orbit, plus reset.
5. Sound, screen shake, and final cinematic polish.

Ship Saturn V first, fully. The other rockets plug into the same machine later.

## Definition of done

A person opens the file, sees Saturn V on the pad, scrolls in and watches it fall
apart into labeled pieces they can inspect, scrolls out to reassemble it, then
hits LAUNCH and rides a real feeling countdown and ascent all the way to orbit,
and it looks like nothing they have seen on a hobby site before.

# Apogee

**See what it takes to reach space.** Apogee is an interactive 3D explorer of legendary rockets that runs in your browser.

Live site: https://apogee-launch.vercel.app

## What it does

- Six rockets: Saturn V, Starship, Falcon 9, Space Shuttle, SLS, and Soyuz.
- Drag to orbit, scroll to zoom, and hover any part of a rocket to learn what it does and why it is there.
- No downloaded 3D models: every rocket is built from simple shapes in code, so every part is named and copyright free.

## Tech stack

- Plain HTML, CSS, and JavaScript (no build step)
- [Three.js](https://threejs.org/) r0.128.0, loaded from a CDN
- Self-hosted fonts in `fonts/`
- Hosted on Vercel

## The files

- `index.html` – the page, styling, and panel layout
- `rockets.js` – the data: every rocket and every labelled part with its tooltip text
- `main.js` – the 3D engine: builds each rocket from the data and handles hover and zoom
- `PROMPT.md` – the build prompt used to guide an AI coding agent

## Run it locally

Double-click `index.html`. You need to be online, because Three.js loads from the internet.
If your browser blocks it, run a tiny local server from this folder and open the address it prints:

```
npx serve
```

## Turning rockets on or off

In `main.js`, near the top, edit:

```js
const ACTIVE_KEYS = ["saturn-v", "starship", "falcon-9", "shuttle", "sls", "soyuz"];
```

To add a new rocket, copy a block in `rockets.js`, change the numbers and text, and give it a new `key`. Each part's `label` and `purpose` become its hover tooltip.

---

Built by Han Thu Hein with AI coding assistants.

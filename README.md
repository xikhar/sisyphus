# Sisyphus

A playable, painterly 2D game built with Three.js. Push a stone up a mountain, scramble over it to the lookout, see the entire valley, watch the stone roll back down, and make the descent yourself. Begin again.

## Run

Use Node.js 24 (also specified in `.nvmrc`) and a browser with WebGL 2. Node.js 22.12+ is supported.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production build:

```sh
npm run build
npm run preview
```

The `dist/` directory is a self-contained static game with relative asset paths. All artwork, fonts, music, and audio synthesis are local; gameplay makes no external requests. No API keys, backend, or account are needed.

## Commit and deploy to GitHub Pages

Create an empty GitHub repository named `sisyphus`, then commit and push this project:

```sh
git add .
git commit -m "Add Sisyphus game"
git remote add origin https://github.com/YOUR_USERNAME/sisyphus.git
git push -u origin main
```

In the GitHub repository, open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**. In **Actions**, run **Check and deploy GitHub Pages** if the initial push happened before Pages was enabled. Later pushes to `main` deploy automatically after the tests and production build pass. Pull requests run the checks without deploying. This follows GitHub's [custom Pages workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The site will be available at `https://YOUR_USERNAME.github.io/sisyphus/`; append `?record=true` to autoplay the recording scene. The relative Vite base supports repository paths and user-site roots without editing the repository name into the build.

The workflow installs locked dependencies, runs unit tests, builds the game, checks the actual production files in Chromium at `/` and `/sisyphus/`, and uploads only `dist/`. Commit the source, `package-lock.json`, artwork, tests, and workflow. `.gitignore` excludes dependencies, build output, browser captures, logs, local environment files, and `.local-archive/` (the local backup of removed unused fonts).

## Play

The game opens directly into the landscape. There are no title screens, HUD elements, narration, control overlays, or summit captions. Pausing blurs the frozen scene and shows only `continue...`.

| Input | Action |
| --- | --- |
| Hold D / right arrow | Walk uphill; push when touching the boulder; scramble over the stone at the crest |
| Hold A / left arrow | Walk or climb back downhill, including from the summit |
| Hold Space | Brace the stone and catch your breath |
| Esc | Pause / resume |
| M | Toggle sound |
| F | Fullscreen |

On touch devices, hold the left 36% of the landscape to descend, the right 36% to push, and the middle to brace. Double-tap to pause, then tap `continue...` to resume. These touch regions have no visible buttons. A soft, melancholic piano loop and ambient sound start on the first click, tap, or keypress; press M to mute/unmute. Music softens while paused and silences in a hidden tab. Switching away automatically pauses the game. Completed cycles persist locally; reloading starts that cycle at the foot of the mountain.

A steady ascent takes about 3½ minutes. Push the stone onto the ledge's upper corner, then climb over it. It stays parked until both feet reach the far side, when it rolls back down and the panorama opens. You can turn around or walk back at any point, without waiting for a timer. The descent takes about 1½ minutes, with a measured walking cadence. There is no final victory, score, upgrade tree, or finish screen.

When a returning stone reaches Sisyphus, he gives a short step backward and automatically holds it in place. Push to continue uphill or walk away to release it. The hidden K shortcut alternates between the final uphill push just below the summit and a spot near the bottom, on the uphill side of the parked stone. At the top, finish pushing onto the ledge and climb over it to release the stone. At the bottom, climb back over the stone to reach the downhill side and start pushing again. The shortcut adds no on-screen controls or completed cycles, and preserves pause.

## Record mode

Open the game URL with `?record=true` to autoplay a roughly 35-second scene as soon as the artwork loads. Sisyphus pushes for four seconds, steps back, catches the rolling stone automatically, holds it briefly, and pushes for two more seconds. A fade hides the cut to the final ledge push. He pushes onto the summit, climbs over the stone, watches it fall against the panorama, then starts downhill and fades out. The sequence ends on black without looping; reload to replay it.

The scene uses the normal physics and animation, hides the cursor, and adds no captions or controls. Movement, touch controls, and K are ignored during the take; Esc/P, M, and F still work. Switching focus to a capture tool does not show a pause dialog. A hidden tab suspends the sequence quietly. Record mode does not change saved cycles. It prepares the scene for screen capture; it does not save a video file automatically.

Click the scene to unlock audio for a take; browsers require an interaction before playing sound. The piano loops continuously through play and follows the recording fades, including the silent ending.

## Art and animation

- Built-in ImageGen created the dawn panorama, transparent forest ridge, limestone texture, and transparent character atlas. [Source artwork and generation prompts](art/README.md) live in `art/`. Runtime artwork is limited to three WebP textures and nine transparent sprites; the deployed game also bundles the pause font, piano track, and their credits.
- Orthographic Three.js scenes layer the panorama, independently scrolling forest ridges, animated haze, birds, physical terrain, the character, and dust. The near forest moves about 2.7 times faster than the distant forest. Motion follows the camera, so the summit view stays still when the boulder falls.
- The mountain uses irregular terrain, layered mineral textures, weathered bedding and fissures, separately shaded rock ledges, and scattered scree. Cool, desaturated atmospheric colors separate the scenery from the detailed foreground and warm character sprites.
- Sisyphus uses separate head, torso, cloth, upper-arm, forearm, thigh, shin, and foot sprites. The two-bone IK rig preserves both limb lengths, fits the pelvis to reachable foot contacts, and eases each swing between planted steps. The final scramble follows both faces of the boulder, keeps its holds when stopped, and smoothly turns downhill when climbing back.
- Pushing adjusts the stance to the slope and arm reach, keeps both palms on the stone with bent elbows, and anchors the shoulders to the torso artwork. Reaching and releasing follow arcs around the shoulder, avoiding collapsed or flipping elbows.
- Soft shadows conform to the terrain independently of the character's climbing height. The boulder's support point is calculated across its footprint, including the curved summit ledge.
- A fixed 60 Hz simulation handles momentum, collision, all five gameplay phases, and repeated cycles. Rendering interpolates between simulation steps; walking speed, pelvis movement, turns, and arm targets ease through changes while the head and waistband stay attached to the torso.
- A local 69-second original piano arrangement loops using Web Audio, alongside synthesized wind, stone friction, and footsteps. Piano recordings: Salamander Grand Piano by Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The [score, sample attribution, and rendering instructions](art/music/README.md) are included. Reduced-motion preferences disable drifting particles and moving atmospheric details.
- Font: Cormorant Garamond Italic, bundled with its SIL Open Font License.

To reproduce sprite extraction and runtime image encodings:

```sh
npm run assets:prepare
npm run assets:optimize
```

These scripts preserve the generated source files and alpha. If a system-wide libvips installation interferes with installing the optional asset preparation dependency, run `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install`.

## Verification

```sh
npm run check
npm run setup:browser
npm run test:production
# With the dev server running:
npm run test:browser
npm run test:record
```

The unit suite covers complete cycles, catching and holding a returning stone, acceleration/reversal, endpoint teleports, render interpolation, continuous body/limb transitions, fixed limb lengths, planted contacts, and grounded shadows. The Playwright smoke test covers actual keyboard/touch inputs, the hidden K shortcut, automatic bracing, absence of visible UI, the minimal pause screen, audio shortcuts, parallax, a stopped climb, the full game loop, mobile rotation, and browser/shader errors. It saves screenshots to `test-results/`.

The recording browser test watches a full take play automatically, checks the hidden cut and final stop, and saves screenshots of each scene. The production test starts its own local preview servers and verifies root and repository paths. Browser checks prefer Playwright's installed Chromium and fall back to `/usr/bin/chromium` on Linux; set `CHROMIUM_PATH` to override the browser. Set `TEST_URL` to override the development server URL. The deterministic simulation hook is available only on the Vite development server with `?test=1`; production does not expose it. Record mode itself works in both development and production.

## Structure

- `src/game-state.js`: deterministic gameplay and phase transitions
- `src/render-state.js`: interpolation between fixed simulation steps
- `src/record-sequence.js`: autoplay direction and fades for `?record=true`
- `src/terrain.js`: the hill, summit, and scramble surfaces
- `src/character.js`: articulated sprite rig and inverse kinematics
- `src/locomotion.js`: planted steps, stone footholds, and pelvis reach constraints
- `src/shadow.js`: soft shadows conforming to the mountain surface
- `src/scene.js`: rendering, camera, and particles
- `src/mountain.js`: rock surfaces, ledges, scree, and vegetation
- `src/parallax.js`: independent background layers and atmospheric color grading
- `src/audio.js`: looping piano and synthesized soundscape
- `scripts/render-piano.py`: reproducible piano composition and audio renderer
- `src/main.js`: keyboard/touch controls, minimal pause, accessibility, and fixed timestep
- `public/assets/`: assets needed by the deployed game, including the font license
- `art/`: original ImageGen artwork, prompts, and sprite crop metadata
- `.github/workflows/pages.yml`: checks and GitHub Pages deployment

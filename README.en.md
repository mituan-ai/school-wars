<div align="center">

# School Wars · 校园战争

**A fan remake of GAMEDESIGN's classic Flash real-time strategy game *School Wars***

[简体中文](README.md) | English

[![Play online](https://img.shields.io/badge/play_online-schoolwars.yhdmt.site-e8513f?style=flat-square)](http://schoolwars.yhdmt.site)
[![Version](https://img.shields.io/badge/version-v0.1.0-3fb35e?style=flat-square)](https://github.com/mituan-ai/school-wars/releases)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Zero runtime dependencies](https://img.shields.io/badge/runtime_deps-0-8b5cf6?style=flat-square)

<img src="docs/images/battle-en.png" alt="Gameplay: four schools fighting over ♠ tiles" width="860">

</div>

Four high schools, one 16×16 isometric board, and two commands: **move** and **attack**. Idle students sit down. Sitting on a ♠ captures it and speeds up your reinforcements; sitting on a ♥ heals. Sit on a rival's base until it falls, knock out their last student, and that school is out.

The remake first rebuilt every rule of the original SWF function by function. It then fixed what made the original drag on or feel unfair, without adding any new systems.

## ✨ Highlights

- **Two rule sets, switchable in Settings**
  - **School Wars (default)**: games reach an ending and fights feel fair. Games still undecided after 40 minutes fell from 57% in the original to 1.7%.
  - **Classic**: a frame-exact recreation of the original, including the original AI.
- **An AI that doesn't cheat**: the computer plays by the same rules and uses the same commands as you. There are three levels (Easy, Normal, Hard), and each school has its own personality.
- **Comfortable controls**: drag-select, control groups, double-click to select all, rally points, spread-out group moves, threat alerts and hover tooltips.
- **Everything redrawn**: students, school buildings and tiles are drawn in code, and the sound effects are synthesized with WebAudio. The repository contains no original assets.
- **Chinese and English UI**, plus saving and loading (3 manual slots and an autosave, with import and export), pause and 2× speed, and a colorblind mode.
- **Instant play**: it runs in the browser with no runtime dependencies. The production bundle is about 80 KB (29 KB gzipped).

<div align="center">
<img src="docs/images/title-en.png" alt="Title screen: choose your school" width="860">
</div>

## 🎮 How to play

| | Rule |
|---|---|
| **♠ tiles** | Sit on one to capture it. The more ♠ you hold, the faster your reinforcements arrive |
| **♥ tiles** | Sit on your own ♥ to heal. They can be captured too |
| **Base** | Each school's home: it spawns students and heals them. If enemies sit on your base for about 33 student-seconds, it **falls**: no more reinforcements and no healing. Sit on it again for about 17 student-seconds to retake it |
| **Elimination** | Your base has fallen and you have no students left |
| **Growth** | Each knockout heals the student 30% and raises their max HP by 2. Every 3 knockouts adds a star above their head |
| **Top dog** | A school holding more than 40% of the board's strength becomes the computer's preferred target (this rule turns off once only two schools remain) |

Punches land 50% of the time, and a whiff shows "miss". A hit interrupts the target's own punch, so ganging up is strong. That is the soul of the original, and the remake keeps it intact.

### Controls

| Action | Input |
|---|---|
| Select | Left-click or drag a box · double-click a student to select all of yours on screen · `Ctrl` + `A` selects everyone |
| Move / attack | Right-click the ground / right-click an enemy |
| Groups | `Ctrl` or `Shift` + number to assign · number to select · press twice to jump the camera there |
| Rally point | Click your school building, then right-click the ground; new students walk there · right-click your base to clear it |
| Camera | `Space` + drag · `WASD` / arrow keys · click the minimap · mouse wheel to zoom |
| Pause / speed | Buttons in the top-right corner |

### The four schools

| School | Style | HP | ATK | Reinforcements |
|---|---|---|---|---|
| ⚫ Black | Balanced | 18 (classic 20) | 4 | Slow |
| 🟢 Green | Swarm | 12 (classic 10) | 4 (classic 2) | Very fast |
| 🟡 Yellow | Sturdy | 28 (classic 25) | 3 | Slow |
| 🟣 Purple | Striker | 14 (classic 15) | 5 | Slow |

The values in brackets are the original's, used under Classic rules. The new values were tuned over thousands of headless games. In the original, Green won 0% of AI-only games.

## 🔧 What changed from the original

Every change fits in one sentence and was checked with headless simulations:

- **Games reach an ending**:
  - Bases can be taken.
  - Reinforcements bank up while you're at the unit cap instead of being wasted.
  - Capture progress slowly decays when nobody keeps it up.
  - "Top dog" turns off once only two schools remain, and no longer protects a school whose base has fallen.
- **Fairer fights**:
  - Idle students engage the nearest enemy, and prefer one that is hitting their teammates, instead of picking one at random.
  - Moving units can be hit.
  - Students on a move order aren't pulled away by enemies.
  - Automatic chases stop after 12 cells.
  - Knocked-out students free their cell immediately.
- **Easier to read**: a strength bar, capture rings, a reinforcement timer, "miss" pop-ups, hit flashes, knockout stars and hover tooltips.

The full design, data and trade-offs are in [docs/03_优化方案.md](docs/03_优化方案.md) (Chinese).

## 🤖 AI results

All numbers come from reproducible headless simulations (`npm run sim`, capped at 40 minutes):

| Matchup | Result |
|---|---|
| 4 × Normal free-for-all (300 games) | School win rates 26 / 27 / 20 / 25%, median length 14 min, 1.7% undecided |
| Hard vs original AI | Hard wins 98.9% |
| Normal vs original AI | Normal wins 77.8% |
| Hard vs Normal | Hard wins 86.9% |

At regular intervals, a commander reassesses the board and assigns each student to one of four tasks: retreat, defend, expand or attack. It can only issue the same commands a player can, never reads hidden information, and gets no stat bonuses. The three levels differ only in reaction speed, coordination and whether the AI focuses its fire.

## 🚀 Running locally

Requires [Node.js](https://nodejs.org/) **22.18** or newer, because the command-line tools run `.ts` files directly.

```bash
git clone https://github.com/mituan-ai/school-wars.git
cd school-wars
npm install
npm run dev          # dev server; open the printed URL
```

| Command | What it does |
|---|---|
| `npm run build` | Type-check and build to `dist/` (plain static files that any web server can host) |
| `npm test` | 54 rule, AI and simulation tests |
| `npm run sim -- 300 40 --rules remake --ai normal` | Headless AI-only games: game count, minute cap, rules, difficulty |
| `npm run sim -- 100 40 --rules remake --vs hard,classic` | Two AIs control two schools each; reports which AI wins |
| `node tools/balance.ts 160 '18,12,28,14' '4,4,3,5' '1500,500,1500,1500' hard` | Sweep school stats |

## 🏗️ Architecture

- **TypeScript (strict), Vite and Canvas 2D**, with a vanilla DOM UI: no framework and no runtime dependencies.
- **Deterministic pure-logic core**: `src/core/` has no browser dependencies. It runs at a fixed 18 ticks/s, and its seeded RNG lives inside the game state. The same seed and the same commands always produce the same game, and a save file is simply that state as JSON.
- **Faithful to the original**: under Classic rules, the core maps function by function onto the original ActionScript (each file header names its source frame). Twenty games of 6000 ticks each produce identical event-stream fingerprints before and after the remake changes.
- **Balance guarded by tests**: the test suite includes small tournament gates. For example, Hard must beat the original AI more than 75% of the time, and no more than 10% of Normal free-for-alls may end in stalemate. These tests catch any AI or balance change that breaks them.

```
src/core/          pure logic; runs headless in Node
  mapgen.ts        map generation and setup
  spawn.ts         reinforcements
  unit.ts          unit state machine, combat, capture
  ai-classic.ts    original AI
  ai-commander.ts  new AI commander
  sim.ts           main loop and commands
  save.ts          saves (v2, migrates v1)
src/render/        isometric board, vector students, minimap, effects
src/ui/            title, in-game HUD, menus, save/load and settings
src/i18n/          Chinese / English
src/audio/         synthesized sound effects
tests/             Vitest tests; e2e/ holds a browser smoke script
tools/             simulation stats, stat sweeps
```

## 📚 Documentation (Chinese)

- [docs/01_原版机制考证.md](docs/01_原版机制考证.md): the original's rules, reconstructed from the SWF and its decompiled scripts. Each rule is tagged confirmed, derived or unknown, and cites its source line
- [docs/02_重构方案.md](docs/02_重构方案.md): technology choices, architecture and milestones
- [docs/03_优化方案.md](docs/03_优化方案.md): the new rules, AI, controls and visuals, with measured results and targets not yet met

## 🗺️ Roadmap

- [ ] School balance on Hard (Green's swarm is currently too strong)
- [ ] A pixel-style CJK font and optional background music
- [ ] Pre-rendered student poses to cut rendering cost further
- [ ] Touch support

Issues and pull requests are welcome. If you change the rules or the AI, please include before-and-after `npm run sim` results.

## 🙏 Credits and disclaimer

- The original *School Wars* was made by [GAMEDESIGN](https://www.gamedesign.jp/) (Taro Ito). This is an unofficial remake made by a fan out of love for the game, and it is not affiliated with the original author.
- The name "School Wars" and the original game belong to their author. This repository does **not** contain the original SWF, decompiled code or any original art or sound. All art, sound and code here are new.
- If the original author has any concerns about this project, please open an issue and we will act on it right away.

The code is released under the [MIT License](LICENSE).

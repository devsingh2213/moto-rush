# 🏍️ MOTO RUSH

A synthwave endless-traffic dodger built with three.js — no build step, no assets, no audio files.
Everything (graphics *and* sound) is generated in code.

## Run it

```bash
cd moto-rush
python3 -m http.server 8619
# open http://127.0.0.1:8619
```

(Any static file server works — ES modules just need http://, not file://.)

## How to play

| Input | Action |
|---|---|
| `←` `→` or `A` `D` (tap left/right half on touch) | change lane |
| `P` | pause |
| `M` | mute |
| `R` / Space | restart after a crash |

- Three lanes of **oncoming traffic**. Trucks are long and slow, sports cars fly.
- **Watch for blinkers + a horn** — those drivers are about to cut into *your* lane.
- Grab green-ringed **fuel cans**; the tank drains constantly and faster at speed.
- Speed ramps up forever. Near misses are worth **+50** each. High score is saved locally.

## Sound design (all procedural Web Audio)

- Engine: saw + square + sub oscillators through a fake 4-speed gearbox (pitch climbs and drops on each "shift"), lowpass opens with throttle, plus band-passed wind noise that rises with speed².
- Music: a 4-bar Am–F–C–G synthwave loop on a 16th-note lookahead scheduler — kick/snare/hats, filtered 16th bass, detuned pad, delayed arp lead, sidechain-style ducking under the kick. **Tempo rises with game speed** (104→130 BPM).
- SFX: fuel pickup arpeggio, panned near-miss whoosh, horn before lane cuts, low-fuel beeps, engine sputter when the tank runs dry, and a filtered noise-slam crash.

## Tuning knobs (`src/main.js`)

| Constant | Meaning |
|---|---|
| `BASE_SPEED` / `MAX_SPEED` / `RAMP_RATE` | difficulty curve |
| `FUEL_PICKUP`, drain term in `updatePlaying` | fuel economy |
| cut-in chance `0.14 + speed01() * 0.3` | how aggressive traffic gets |
| `LANES`, `SPAWN_Z`, spawn timers | road layout & density |

## Deploying to GitHub Pages

It's a pure static site — push the folder (or `gh --pages` via Settings → Pages) and it runs.

Before deploying, edit the two config blocks at the top of the contact section in `src/main.js`:

- `CONTACT` — your GitHub / X / email links (shown in the menu and game-over screens)
- `COUNTER.ns` — the Abacus namespace for the global play counter; keep its unique suffix so
  no other site shares your tally

**Play counting:** every "START ENGINE" fires an anonymous increment to
`abacus.jasoncameron.dev` (free CountAPI-style service, no account). The menu shows the live
global count; if the service is unreachable it falls back to a per-device count from
localStorage. The game itself never depends on it — offline play is unaffected.

## Files

```
index.html          shell + HUD/menus
styles.css          neon synthwave UI
src/main.js         game: world, bike, traffic AI, fuel, camera
src/audio.js        AudioEngine: engine sim, music sequencer, SFX
vendor/three.module.js  three.js r170 (vendored, works offline)
```

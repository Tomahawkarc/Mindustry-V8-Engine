# Mod Engine (Mindustry V8)

**Mod Engine** is a Rhino/JS control panel and runtime for **Mindustry V8** (min game version **154+**, tested with **159.x**).

It provides a full in-game **NexusOS** UI with sandbox tools, fleet mining, content inspector, range overlays, and a JS console.

---

## Install

1. Copy the whole `mod-engine` folder (this repository root) into:
   - Desktop: `Mindustry/mods/`
   - Android: `Mindustry/mods/`
2. Restart Mindustry.
3. Enable **Mod Engine** in Mods.
4. On first launch a **welcome dialog (EN/RU)** appears with important tips.

---

## Open the menu

In-game HUD button: **Mod Engine** (gear/settings icon attached next to the mobile button row / status area).

Nav modes:

| Mode | Meaning |
|------|---------|
| **ALL** | Every tab |
| **USUAL** | Normal play tools |
| **SANDBOX** | Cheat / override tools |

---

## Feature list

### Home
- Sector label & threat estimate
- **Live core item flow** (amount + items/s delta)
- Power grid balance

### Waves
- Force next wave / auto-wave
- Wave composition preview
- Simulation speed helpers

### World
- Time of day & ambient light
- Wind strength
- Clear active weather
- Sector capture / team transfer tools (campaign helpers)

### Items
- Inject items into core
- Fill / clear core storage
- Base vs modded content filters

### Units
- Spawn units (ally/enemy, amount)
- Planet / mod filters
- Unit action dialogs (health, team, etc.)

### Player
- Max health, move speed, jump, mine speed, regen
- Status effects & quick heal / ammo / self-destruct

### Weapon
- Unit weapon damage / range / spread
- Instant reload for **own team**
- Turret reload / range / damage / spread buffs

### Mining
- Global mine speed multipliers
- **Fleet cards**: assign one or more ores per unit type
- Uses CommandAI mine stances (multi-ore capable)

### Inspector
- Browse blocks / units / items
- Mod registry
- **Pagination** - if FPS drops, lower **PAGE SIZE** to **20–40**

### Builds
- Instant build / structure godmode
- Green area selection + mass actions (heal, wipe, replace, fill ammo)

### Radius
- Turret range overlay
- Unit weapon / mining range overlay
- Shield-style non-stacking fill (private FBO, no crash with force projectors)

### Console
- Rhino JS interactive shell
- Aliases: `player`, `state`, `world`, `logic`, `items`
- Clear log / export trace

### Hotkeys / Links
- Remap UI hooks (interface placeholders)
- External link / support stubs

---

## Performance tips

1. **Inspector lag** → reduce page size to 20–40.  
2. **Many mods** → use mod filters, avoid “ALL” content dumps.  
3. **Radius overlays** → disable on weak devices during large battles.  
4. **Console** → don’t spam huge loops every frame.

---

## Files

```
mod.json
README.md
README_RU.md
scripts/
  main.js
  runtime.js
  render.js
  user-workbench.js
  UI/
    engine-ui.js
    slider.js
assets/shaders/rangezone.frag
```

---

## Compatibility

- **JS / Rhino mod** (no Java sources)
- Mindustry **V8** API (`CommandAI`, `ItemUnitStance`, etc.)
- Desktop + Mobile

---

## License / credit

Author: **Tomahawk**  
Discord:  **weihalt**
Display name: **Mod Engine**

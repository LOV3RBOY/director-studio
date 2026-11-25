# Five Star style bible

What the two Five Star looks must reproduce, and why each prompt line exists. Built from the released game's technical reviews (Digital Foundry, Nov 2026), trailer and Extended Look analysis, and breakdowns of the official artwork. The prompts in `src/server/apps/catalog/fivestar.ts` are written from this file; change both together.

## 1. In-Engine (the game's real-time graphics)

| Trait | What the game does | Prompt consequence |
|---|---|---|
| Lighting model | Ray-traced global illumination is the core of the look; RT reflections on every console, RT shadows on PS5 Pro. Sunlight bounces off floors and walls in real time and softly fills rooms. | Ask for soft bounced fill light picking up the colour of nearby surfaces, never flat studio light. |
| Light direction | Expressive, not strictly realistic: sunset backlight, strong silhouettes, neon spill light at night. | Backlit or low-sun key, rim on hair and shoulders, coloured spill from signs. |
| Atmosphere | Humid ocean haze over the city; low mist over water at dawn and dusk. | Visible humid haze that softens distance; never crisp alpine air. |
| Colour script | Saturated, Florida-inspired: turquoise, pink, orange, gold. Neon nightlife vs sun-bleached suburbs; glamour vs decay. | Name the four colours; pair glossy luxury with a worn, real detail. |
| Characters | The standout feature: strand-simulated hair with follow-through, detailed skin shading, sweat, make-up; cloth wrinkles and bunches at elbows and shoulders. | Skin with pores, sheen of sweat, real make-up, hair strands catching light, believable fabric creases. |
| Reflections | Crisp RT reflections nearby (puddles, car paint, shop glass); simpler far away. | Wet asphalt and car paint mirroring neon and sky. |
| Image character | 1440p at 30 fps, reconstructed to near-4K; slight softness, a little shimmer on fine detail. It reads as a very good real-time render, not a photograph. | "In-game frame, real-time render", slight temporal softness, no film grain, no bokeh balls, no lens flare clichés. |
| World | Vice City: palm trees, pastel art-deco, neon, wet streets, bay views, dense crowds. | Use per scene; keep backgrounds busy and lived-in. |

## 2. Key Art (the official illustrations)

| Trait | What the artwork does | Prompt consequence |
|---|---|---|
| Lineage | One painted style carried from GTA III to VI; the VI pieces read more grounded and realistic than V's. | Life-like proportions; never cartoon, never photo. |
| Rendering | Digitally painted, life-like characters with a clearly painted finish; recreations use oil-paint smoothing, hard tonal levels and strong sharpening. | Smooth painted skin, shading in a few hard-edged bands, crisp sharpened detail. |
| Edge | A dark stroke around the cut-out figure (recreations: a 4 px outer plus 2 px centred black stroke). | Clean dark contour around the silhouette; thinner interior lines. |
| Layering | Figure layered over a separately painted, simpler background (skyline, palms, art-deco hotel, sunset gradient with dry-brush grain). | Cut-out figure; background flatter and softer than the figure. |
| Colour | Warm overall cast; boosted but not neon saturation. | Warm orange cast; Florida colour script. |

## 3. Rules for every prompt

- Name the reference style inside the prompt (it measurably improves fidelity); never in the product UI or marketing.
- Always forbid logos, titles, watermarks, HUD and on-screen text.
- Identity comes from the user's photos; the style must never override face, skin tone, hair or build.

/**
 * FIVE STAR: put yourself in an open-world crime-saga scene. Two apps that chain:
 *   five-star         selfie + scene + look  -> a 9:16 still (Nano Banana Pro, identity from refs)
 *   five-star-motion  that still + scene     -> a 5s 9:16 clip with sound (Seedance 2.5, still as first frame)
 *
 * The prompts name the reference style so the model hits it exactly, but every prompt forbids logos,
 * titles and on-screen text, and the product itself never uses the game's name or marks.
 */
import type { AppDef, ChoiceOption } from "../types";
import { app, choice, input, text } from "./helpers";

const ADDED = "2026-11-25";
const NO_MARKS = "No logos, no watermarks, no on-screen text, no game interface.";

/** The two looks. `prompt` is the locked style block. */
export const FIVE_STAR_LOOKS: ChoiceOption[] = [
  {
    value: "key-art",
    label: "Key Art",
    // See docs/five-star-style-bible.md section 2.
    prompt:
      "Official Grand Theft Auto VI promotional artwork style, as in Rockstar Games' Jason and Lucia key art and loading-screen illustrations. " +
      "The character is a grounded, life-like digital painting with realistic proportions and anatomy, not a cartoon and not a photo: smooth painted skin, " +
      "shading in a few hard-edged tonal bands per colour, crisp sharpened detail in the face, hair, fabric folds and jewellery. " +
      "A clean dark contour runs around the figure's silhouette so it reads as cut out and layered over the background, with thinner dark lines only on major folds and facial features. " +
      "Warm low-sun key light from one side with a clean shadow side. The background is a separately painted, simpler Vice City scene: flat colour shapes, smooth sunset gradients, slight dry-brush grain. " +
      "Florida colour script of turquoise, pink, orange and gold under a warm overall cast; rich but not neon saturation; no lens effects, no bokeh. Confident, cool, slightly cocky attitude.",
  },
  {
    value: "in-engine",
    label: "In-Engine",
    // See docs/five-star-style-bible.md section 1.
    prompt:
      "An in-game frame from Grand Theft Auto VI, captured in photo mode on PS5 Pro: Rockstar's RAGE real-time graphics, near-photoreal but clearly a real-time render, not a photograph. " +
      "Ray-traced global illumination: soft bounced fill light that picks up the colour of nearby walls and pavement, expressive low-sun or sunset backlight with a warm rim on hair and shoulders, coloured neon spill light at night, strong readable silhouettes. " +
      "Humid ocean haze softening the distance. Florida colour script of turquoise, pink, orange and gold; glossy glamour beside worn, lived-in detail. " +
      "Character detail at the level of the game's protagonists: skin pores, a light sheen of sweat, make-up where worn, individual hair strands catching the light, fabric that creases and bunches at elbows and shoulders. " +
      "Crisp ray-traced reflections in nearby wet asphalt, car paint and shop glass. Vice City setting: palm trees, pastel art-deco, neon, busy lived-in streets. " +
      "Slight real-time temporal softness; no film grain, no bokeh balls, no lens-flare streaks.",
  },
];

/** The six scenes. `prompt` stages the still; the motion app reuses the value with a motion beat. */
export const FIVE_STAR_SCENES: (ChoiceOption & { motion: string })[] = [
  {
    value: "mugshot",
    label: "Mugshot",
    prompt:
      "a police booking mugshot: the character stands against a height-chart wall under harsh flash, holding a booking placard with a case number, smirking at the camera, slightly dishevelled, attitude intact.",
    motion:
      "The booking camera flashes twice; the character lowers the placard, tilts their head and breaks into a slow, knowing grin. Static locked-off camera, flash pops, fluorescent hum.",
  },
  {
    value: "chase",
    label: "Five-Star Chase",
    prompt:
      "a five-star police chase at night: the character leans out of the window of a speeding muscle car on a neon boulevard, red and blue lights flooding the scene, a helicopter searchlight cutting through the haze.",
    motion:
      "The car tears down the boulevard, the camera tracks alongside low and fast, red-blue lights strobe across the character's face, a helicopter searchlight sweeps over them. Sirens, roaring engine, rotor wash.",
  },
  {
    value: "beach",
    label: "Beach Day",
    prompt:
      "a sun-drenched beach day: the character strides along a crowded oceanfront promenade at golden hour, art-deco hotels and palm trees behind them, sunglasses on, effortlessly the main character.",
    motion:
      "The character walks toward camera in slow motion, pulls their sunglasses down and looks straight into the lens. Handheld tracking shot backing away, palms swaying. Waves, distant music, crowd chatter.",
  },
  {
    value: "heist",
    label: "The Heist",
    prompt:
      "a bank heist in progress: the character stands in a marble vault doorway with a duffel bag of cash over one shoulder, alarm lights spinning, masked crew members blurred behind them.",
    motion:
      "Alarm lights spin, the character swings the duffel bag onto their shoulder and walks out of the vault toward camera as cash flutters down. Slow push-in. Alarm bells, footsteps, rustling bills.",
  },
  {
    value: "night-drive",
    label: "Night Drive",
    prompt:
      "a night drive: the character at the wheel of a classic convertible cruising a palm-lined causeway, city skyline glowing behind, wind in their hair, one hand on the wheel.",
    motion:
      "The convertible glides along the causeway, the camera drifts from the hood to a profile of the character as neon reflections roll over the car. Engine purr, wind, faint synth radio.",
  },
  {
    value: "penthouse",
    label: "Penthouse",
    prompt:
      "a penthouse at sunset: the character leans on the glass railing of a luxury high-rise balcony over the city, drink in hand, stacks of cash on the table behind them, sky blazing orange and pink.",
    motion:
      "The camera slowly orbits the character on the balcony as they raise their glass to the skyline and the sun dips behind the towers. City hum, ice clinking, a distant siren.",
  },
];

const IDENTITY =
  "The first reference photos show the main character: keep their exact face, skin tone, hairstyle and build recognisable. " +
  "Any further reference photos show other people: put each of them in the scene beside the main character as their crew, each one just as recognisable.";

const sceneChoice = (motion: boolean) =>
  choice(
    "scene",
    "Scene",
    FIVE_STAR_SCENES.map(({ value, label, prompt, motion: m }) => ({ value, label, prompt: motion ? m : prompt })),
  );

export const fiveStarApps: AppDef[] = [
  app({
    id: "five-star", name: "Five Star", category: "template", badge: "new", added: ADDED,
    pitch: "Put yourself and your crew in an open-world crime-saga scene. One selfie, one tap.",
    tags: ["character", "game", "poster", "selfie"],
    modelId: "nano-banana-pro", values: { aspect: "9:16", resolution: "2K" },
    inputs: [
      input("you", "You", "refs", { min: 1, max: 3, hint: "1 to 3 clear photos of your face." }),
      input("crew", "Friends", "refs", { min: 0, max: 3, hint: "Optional. One clear photo per friend, with their OK." }),
    ],
    fields: [
      sceneChoice(false),
      choice("look", "Look", FIVE_STAR_LOOKS),
      text("concept", "Your twist", { placeholder: "wearing my black suit, holding a gold phone", maxLength: 160 }),
    ],
    template: `{{look}} Vertical 9:16 frame. The scene: {{scene}} {{?concept}}Also: {{concept}}.{{/concept}} ${IDENTITY} ${NO_MARKS}`,
  }),
  app({
    id: "five-star-motion", name: "Five Star: Make it move", category: "template", badge: "new", added: ADDED,
    pitch: "Turn your Five Star still into a 5-second trailer shot with sound.",
    tags: ["character", "game", "trailer", "video"],
    modelId: "seedance-2.5", values: { aspect: "9:16", duration: 5, resolution: "720p", audio: true },
    inputs: [input("still", "Your still", "start", { hint: "Your Five Star picture. It becomes the first frame." })],
    fields: [sceneChoice(true)],
    template: `Starting from the image, a cinematic game-trailer shot: {{scene}} Keep the character's face and outfit exactly as in the first frame. ${NO_MARKS}`,
  }),
];

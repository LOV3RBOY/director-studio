/**
 * FIVE STAR: put yourself in an open-world crime-saga scene. Two apps that chain:
 *   five-star         photos + the member's own scene + look -> a 9:16 still (Nano Banana Pro, identity from refs)
 *   five-star-motion  that still + the same scene            -> a 5s 9:16 clip with sound (Seedance 2.5, still as first frame)
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

const IDENTITY =
  "The first reference photos show the main character: keep their exact face, skin tone, hairstyle and build recognisable. " +
  "Any further reference photos show other people: put each of them in the scene beside the main character as their crew, each one just as recognisable.";

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
      text("concept", "Your scene", { required: true, placeholder: "Leaning out of a muscle car in a police chase at night", maxLength: 400 }),
      choice("look", "Look", FIVE_STAR_LOOKS),
    ],
    template: `{{look}} Vertical 9:16 frame. The scene: {{concept}}. ${IDENTITY} ${NO_MARKS}`,
  }),
  app({
    id: "five-star-motion", name: "Five Star: Make it move", category: "template", badge: "new", added: ADDED,
    pitch: "Turn your Five Star still into a 5-second trailer shot with sound.",
    tags: ["character", "game", "trailer", "video"],
    modelId: "seedance-2.5", values: { aspect: "9:16", duration: 5, resolution: "720p", audio: true },
    inputs: [input("still", "Your still", "start", { hint: "Your Five Star picture. It becomes the first frame." })],
    fields: [text("concept", "Your scene", { required: true, placeholder: "Leaning out of a muscle car in a police chase at night", maxLength: 400 })],
    template: `Starting from the image, a cinematic game-trailer shot that brings this scene to life: {{concept}}. One natural camera move and character action that fit the moment, with matching ambient sound and effects. Keep every face and outfit exactly as in the first frame. ${NO_MARKS}`,
  }),
];

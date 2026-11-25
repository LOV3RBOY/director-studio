/**
 * FIVE STAR: a thin wrapper around the models, with the game's look locked into every prompt.
 *   five-star         reference photos + scene + look       -> a 9:16 still (Nano Banana Pro)
 *   five-star-video   reference photos + scene + look       -> a 9:16 clip (Seedance 2.5 omni-reference on MuAPI)
 *   five-star-frames  first frame (+ last) + scene + look   -> a clip (Seedance 2.5 frames on MuAPI)
 * "Make it move" on a photo is five-star-frames with that photo as the first frame.
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

/** The same looks for moving pictures: footage, not a still. */
export const FIVE_STAR_LOOKS_VIDEO: ChoiceOption[] = FIVE_STAR_LOOKS.map((o) => ({
  ...o,
  prompt: (o.prompt ?? "")
    .replace("An in-game frame from Grand Theft Auto VI, captured in photo mode on PS5 Pro:", "In-game footage from Grand Theft Auto VI, as in its trailers and gameplay captured on PS5 Pro, at a steady cinematic 30 fps:")
    .replace("Official Grand Theft Auto VI promotional artwork style,", "Animated in the official Grand Theft Auto VI promotional artwork style, every frame a painted illustration,"),
}));

const IDENTITY =
  "The first reference photos show the main character: keep their exact face, skin tone, hairstyle and build recognisable. " +
  "Any further reference photos show other people: put each of them in the scene beside the main character as their crew, each one just as recognisable.";

const VIDEO_IDENTITY =
  "The reference images are the cast: the first show the main character, any others are their crew. Keep every face, skin tone, hairstyle and build exactly as in the references.";
const FRAME_IDENTITY = "Keep every face, outfit and the setting exactly as in the frames; the motion fills in the time between them.";
const concept = () => text("concept", "Your scene", { required: true, placeholder: "Leaning out of a muscle car in a police chase at night", maxLength: 400 });
const cast = () => [
  input("you", "You", "refs", { min: 1, max: 3, hint: "1 to 3 clear photos of your face." }),
  input("crew", "Friends", "refs", { min: 0, max: 3, hint: "Optional. One clear photo per friend, with their OK." }),
];

export const fiveStarApps: AppDef[] = [
  app({
    id: "five-star", name: "Five Star", category: "template", badge: "new", added: ADDED,
    pitch: "Put yourself and your crew in any scene, in the style of the game. A photo or a video.",
    tags: ["character", "game", "poster", "selfie"],
    modelId: "nano-banana-pro", values: { aspect: "9:16", resolution: "2K" },
    inputs: cast(),
    fields: [concept(), choice("look", "Look", FIVE_STAR_LOOKS)],
    template: `{{look}} Vertical 9:16 frame. The scene: {{concept}}. ${IDENTITY} ${NO_MARKS}`,
  }),
  app({
    id: "five-star-video", name: "Five Star: Video", category: "template", badge: "new", added: ADDED,
    pitch: "Seedance 2.5 from your reference photos, in the style of the game.",
    tags: ["character", "game", "trailer", "video"],
    modelId: "seedance-2.5-refs", values: { aspect: "9:16", duration: "5", resolution: "1080p" },
    inputs: cast(),
    fields: [concept(), choice("look", "Look", FIVE_STAR_LOOKS_VIDEO)],
    template: `{{look}} Vertical 9:16 video. The scene: {{concept}}. ${VIDEO_IDENTITY} ${NO_MARKS}`,
  }),
  app({
    id: "five-star-frames", name: "Five Star: Frames", category: "template", badge: "new", added: ADDED,
    pitch: "Seedance 2.5 from a first frame and an optional last frame, in the style of the game.",
    tags: ["game", "trailer", "video", "frames"],
    modelId: "seedance-2.5-frames", values: { duration: "5", resolution: "1080p" },
    inputs: [
      input("first", "First frame", "start", { hint: "The shot starts on this image." }),
      input("last", "Last frame", "end", { min: 0, hint: "Optional. The shot lands on this image." }),
    ],
    fields: [concept(), choice("look", "Look", FIVE_STAR_LOOKS_VIDEO)],
    template: `{{look}} The shot: {{concept}}. ${FRAME_IDENTITY} ${NO_MARKS}`,
  }),
];

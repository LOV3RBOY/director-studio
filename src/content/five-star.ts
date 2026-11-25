/** Words for the Five Star page. Scene and look ids match src/server/apps/catalog/fivestar.ts. */
export const fiveStarCopy = {
  title: "Five Star",
  pitch: "Upload a selfie, pick a scene, and come out as the lead of your own crime saga. As a still or a trailer shot.",
  cast: "Cast",
  you: "You",
  friend: "Friend",
  castHint: "1–3 clear photos of you. Add up to 3 friends, one photo each, only with their OK.",
  castSaved: "Your cast is saved. Every scene uses it.",
  make: "Make",
  photo: "Photo",
  video: "Video",
  look: "Look",
  scene: "Scene",
  today: "Today",
  twist: "Your twist",
  twistPlaceholder: "Optional · black suit, gold phone",
  run: { photo: "Make my photo", video: "Make my video", signIn: "Sign in to start", needYou: "Add your photo first" },
  result: "Your scene",
  emptyResult: "Your scene appears here, vertical and ready to post.",
  renderingPhoto: "Painting your scene",
  renderingVideo: "Shooting your scene",
  makeMove: "Make it move",
  again: "New scene",
  reel: "Trailer",
  reelHint: "Three video shots make a trailer.",
  playTrailer: "Play trailer",
  history: "Rap sheet",
  failed: "That one didn’t render. Your credits came back.",
  retry: "Try again",
  wanted: (n: number) => (n >= 5 ? "Most wanted" : `Wanted level ${n}`),
} as const;

export const fiveStarScenes: Record<string, string> = {
  mugshot: "Booked, unbothered",
  chase: "Five stars, no brakes",
  beach: "Golden hour on the strip",
  heist: "In and out of the vault",
  "night-drive": "Top down, city on",
  penthouse: "Made it, obviously",
};

export const fiveStarLooks: Record<string, string> = {
  "in-engine": "In-Game",
  "key-art": "Key Art",
};

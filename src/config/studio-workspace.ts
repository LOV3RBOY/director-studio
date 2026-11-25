export const studioDestinations = [
  { id: "studio", label: "Studio", href: "/studio" },
  { id: "styles", label: "Style Library", href: "/style-library" },
  { id: "five-star", label: "Five Star", href: "/five-star" },
  { id: "agents", label: "Agents", href: "/agents" },
  { id: "cinema", label: "Cinema", href: "/cinema" },
  { id: "library", label: "Library", href: "/library" },
  { id: "uploads", label: "Uploads", href: "/library?upload=1" },
  { id: "image", label: "Image", href: "/image" },
  { id: "video", label: "Video", href: "/video" },
  { id: "audio", label: "Audio", href: "/audio" },
  { id: "canvas", label: "Canvas", href: "/canvas" },
  { id: "apps", label: "Apps", href: "/apps" },
  { id: "remix", label: "Remix", href: "/remix" },
  { id: "shorts", label: "Shorts", href: "/shorts" },
  { id: "ads", label: "Ads", href: "/ads" },
] as const;

export function studioDestination(id: unknown) {
  return studioDestinations.find((destination) => destination.id === id);
}

export function workspaceLabel(path: string) {
  if (path === "/") return "Home";
  const section = path.split("/")[1];
  const secondary = {
    supercomputer: "Agent chat", notifications: "Notifications", "whats-new": "What’s new",
    settings: "Settings", enterprise: "Enterprise", search: "Search", wallet: "Wallet", explore: "Explore",
    community: "Community", horizon: "Horizon", guide: "Guide", mcp: "MCP",
    developer: "Developer", contests: "Contests", pricing: "Plans", invite: "Invite", u: "Profile",
  } as const;
  if (section && Object.hasOwn(secondary, section)) return secondary[section as keyof typeof secondary];
  return studioDestinations.find(({ href }) => href === `/${section}`)?.label;
}

import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:https";
import next from "next";

const { STUDIO_LISTEN_ADDRESS, STUDIO_TLS_CERT, STUDIO_TLS_KEY, STUDIO_PILOT_CODE, STUDIO_PILOT_EMAIL, COOKIE_SECURE, PARALLAX_ORIGIN } = process.env;
const origin = new URL(PARALLAX_ORIGIN);
const port = Number(origin.port || 443);

if (
  origin.protocol !== "https:" || !origin.hostname.endsWith(".local") ||
  !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(STUDIO_LISTEN_ADDRESS ?? "") ||
  COOKIE_SECURE !== "1" || !/^[a-f0-9]{64}$/.test(STUDIO_PILOT_CODE ?? "") || !STUDIO_PILOT_EMAIL
) {
  throw new Error("Set a private listen address, HTTPS .local origin, and the pilot account and secure cookie settings.");
}

const credentials = { cert: readFileSync(STUDIO_TLS_CERT), key: readFileSync(STUDIO_TLS_KEY), minVersion: "TLSv1.2" };
const app = next({ dev: false, hostname: origin.hostname, port });
const handle = app.getRequestHandler();
const mcpPort = Number(process.env.STUDIO_LOCAL_MCP_PORT);
await app.prepare();

createServer(credentials, (request, response) => {
  if (request.headers.host?.toLowerCase() !== origin.host.toLowerCase()) {
    response.writeHead(421).end();
    return;
  }
  if (mcpPort && request.url?.split("?")[0] === "/api/super/mcp") {
    response.writeHead(404).end();
    return;
  }
  void handle(request, response);
}).listen(port, STUDIO_LISTEN_ADDRESS, () => console.log(`Out of Order listening at ${origin.origin}`));

if (mcpPort > 0 && mcpPort < 65536) {
  createHttpServer((request, response) => {
    if (request.url !== "/api/super/mcp") {
      response.writeHead(404).end();
      return;
    }
    void handle(request, response);
  }).listen(mcpPort, "127.0.0.1");
}

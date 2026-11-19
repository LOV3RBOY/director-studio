import { createServer } from "node:http";
import next from "next";

const port = Number(process.env.PORT || 8080);
const mcpPort = Number(process.env.STUDIO_LOCAL_MCP_PORT || 3215);
const app = next({ dev: false, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();
await app.prepare();

function pathOf(request) {
  return request.url?.split("?")[0];
}

createServer((request, response) => {
  if (/^\/api\/super\/mcp(?:\/|$)/.test(pathOf(request) ?? "")) {
    response.writeHead(404).end();
    return;
  }
  void handle(request, response);
}).listen(port, "0.0.0.0");

createServer((request, response) => {
  if (pathOf(request) !== "/api/super/mcp") {
    response.writeHead(404).end();
    return;
  }
  void handle(request, response);
}).listen(mcpPort, "127.0.0.1");

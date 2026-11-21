"""Full-account agent access over MCP: route index, acting as the owner, file import and limits.

Runner: own-server
"""
import functools
import http.server
import json
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import director
from director import API, Client
from director_recovery import server


def mcp(key, name, arguments=None):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments or {}}}).encode()
    request = urllib.request.Request(director.BASE + "/api/mcp", data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.loads(response.read())["result"]
    return result["isError"], result.get("structuredContent") or result["content"][0]["text"]


def tools(key):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).encode()
    request = urllib.request.Request(director.BASE + "/api/mcp", data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return {tool["name"] for tool in json.loads(response.read())["result"]["tools"]}


def main(folder):
    clip = folder / "reference.mp4"
    (folder / "big.mp4").write_bytes(b"\0" * (31 * 1024 * 1024))
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=128x72:rate=12", "-f", "lavfi", "-i", "sine=frequency=330",
                    "-t", "2", "-c:v", "libx264", "-c:a", "aac", str(clip)], check=True)
    files = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(folder)))
    threading.Thread(target=files.serve_forever, daemon=True).start()
    with server("mock", PARALLAX_ALLOW_LOCAL_WEBHOOKS="1"):
        owner = Client()
        owner.request("/api/auth/signup", {"email": "agent-owner@example.test", "password": "fixture-password"})
        assert owner.request("/api/developer/keys", {}, status=201)["key"]["scopes"] == ["read", "generate"]
        full = owner.request("/api/developer/keys", {"name": "Agent", "scopes": ["read", "generate", "account"]}, status=201)["secret"]
        limited = owner.request("/api/developer/keys", {"scopes": ["read", "generate"]}, status=201)["secret"]
        assert {"app_routes", "app_request", "import_file", "generate"} <= tools(full)

        failed, text = mcp(limited, "app_request", {"method": "GET", "path": "/api/director/styles"})
        assert failed and "account" in json.dumps(text), text
        failed, index = mcp(full, "app_routes", {"query": "director projects"})
        assert not failed and any(r["method"] == "POST" and r["path"] == "/api/director/projects" for r in index["routes"]), index
        failed, index = mcp(full, "app_routes", {})
        assert not any(r["path"].startswith(("/api/auth", "/api/developer", "/api/account", "/api/billing", "/api/director/store")) for r in index["routes"])
        paths = {(r["method"], r["path"]) for r in index["routes"]}
        assert {("GET", "/api/jobs/:id"), ("DELETE", "/api/jobs/:id")} <= paths and not any("[" in p for _, p in paths)

        for method, path in [("POST", "/api/auth/logout"), ("GET", "/api/developer/keys"), ("DELETE", "/api/account"),
                             ("GET", "/api/director/../auth/me"), ("GET", "http://example.com/api/jobs"),
                             ("GET", "/api/director/store"), ("POST", "/api/director/store/transactions")]:
            failed, text = mcp(full, "app_request", {"method": method, "path": path})
            assert failed, (path, text)

        # Import a reference by link, learn a style from it and read the finished job, all as the owner.
        failed, imported = mcp(full, "import_file", {"url": f"http://127.0.0.1:{files.server_address[1]}/reference.mp4", "title": "Reference"})
        assert not failed and imported["file"]["kind"] == "video", imported
        asset = imported["file"]["id"]
        owner.request(f"/api/assets/{asset}/file")
        failed, made = mcp(full, "app_request", {"method": "POST", "path": f"{API}/styles", "body": {"assetIds": [asset], "title": "Agent style"}})
        assert not failed and made["status"] == 200, made
        job = made["body"]["job"]["id"]
        for _ in range(120):
            failed, read = mcp(full, "app_request", {"method": "GET", "path": f"{API}/jobs/{job}"})
            if read["body"]["job"]["state"] in {"succeeded", "failed"}:
                break
            time.sleep(0.25)
        assert read["body"]["job"]["state"] == "succeeded", read
        assert owner.request(f"{API}/styles")["styles"][0]["title"] == "Agent style"
        # A write action with no body still reaches its handler.
        failed, retried = mcp(full, "app_request", {"method": "POST", "path": f"{API}/styles/{made['body']['styleId']}/retry"})
        assert not failed and retried["status"] == 200, retried
        failed, raw = mcp(full, "app_request", {"method": "GET", "path": f"/api/assets/{asset}/file"})
        assert not failed and raw["status"] == 200 and "body" not in raw, raw

        # Each call's session is gone afterwards; the owner's own session is untouched.
        sessions = owner.request("/api/account/sessions")["sessions"]
        assert len(sessions) == 1 and all("Agent" not in (s.get("userAgent") or "") for s in sessions), sessions
        failed, text = mcp(full, "import_file", {"url": "file:///etc/passwd"})
        assert failed, text
        failed, text = mcp(full, "import_file", {"url": f"http://127.0.0.1:{files.server_address[1]}/big.mp4"})
        assert failed and "30 MB" in json.dumps(text), text
    files.shutdown()
    print("PASS: full-account agent access — route index, acting as the owner, file import and limits")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as folder:
        main(Path(folder))

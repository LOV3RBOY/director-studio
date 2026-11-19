"""Run the hosted Studio and its two private Hermes profiles as one service."""

from pathlib import Path
import json
import os
import pwd
import re
import secrets
import signal
import subprocess
import sys
import time

os.umask(0o077)
environment = dict(os.environ)
origin = environment.get("RAILWAY_PUBLIC_DOMAIN", "")
if origin:
    environment.setdefault("PARALLAX_ORIGIN", f"https://{origin}")
if not environment.get("PARALLAX_ORIGIN", "").startswith("https://"):
    raise SystemExit("Set the Studio HTTPS origin before starting.")
if not re.fullmatch(r"[a-f0-9]{64}", environment.get("STUDIO_PILOT_CODE", "")):
    raise SystemExit("Set the private Studio pairing code before starting.")

environment.update(
    COOKIE_SECURE="1",
    PARALLAX_DEMO_BILLING="off",
    STUDIO_PILOT_EMAIL=environment.get("STUDIO_PILOT_EMAIL", "owner@studio.invalid"),
)
mcp_port = "3215"
environment["STUDIO_LOCAL_MCP_PORT"] = mcp_port
processes = []
stopping = False


def stop(*_):
    global stopping
    stopping = True


def start(command, cwd, env):
    processes.append(subprocess.Popen(command, cwd=cwd, env=env))


def model_gateway(parent, label, port, model, tools, api_key, engine_token):
    home = parent / label
    home.mkdir(exist_ok=True)
    config = {
        "model": {"default": model, "provider": "anthropic", "context_length": 65536},
        "agent": {"max_turns": 8 if tools else 2, "api_max_retries": 0, "auto_recovery_cycles": 0},
        "memory": {"memory_enabled": False, "user_profile_enabled": False},
        "compression": {"enabled": False},
        "platform_toolsets": {"api_server": tools},
    }
    if tools:
        config["mcp_servers"] = {
            "parallax": {
                "url": f"http://127.0.0.1:{mcp_port}/api/super/mcp",
                "headers": {"Authorization": f"Bearer {engine_token}"},
                "timeout": 90,
            }
        }
    (home / "config.yaml").write_text(json.dumps(config))
    # Gateway processes receive only their provider key and their private HTTP settings.
    env = {name: environment[name] for name in ("PATH", "LANG") if name in environment}
    env.update(
        HOME=str(home), HERMES_HOME=str(home), HERMES_WORKDIR=str(home),
        HERMES_GATEWAY_LOCK_DIR=str(home / "locks"), API_SERVER_ENABLED="true",
        API_SERVER_HOST="127.0.0.1", API_SERVER_PORT=str(port), API_SERVER_KEY=api_key,
        ANTHROPIC_API_KEY=environment["ANTHROPIC_API_KEY"],
    )
    start(["/opt/hermes/.venv/bin/hermes", "gateway", "run"], home, env)


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
exit_code = 0
data = Path(environment.get("RAILWAY_VOLUME_MOUNT_PATH") or environment["PARALLAX_DATA_DIR"])
data.mkdir(parents=True, exist_ok=True)
if os.geteuid() == 0:
    user = pwd.getpwnam("node")
    if data.stat().st_uid != user.pw_uid:
        for parent, dirs, files in os.walk(data, followlinks=False):
            for name in dirs + files:
                os.chown(Path(parent) / name, user.pw_uid, user.pw_gid, follow_symlinks=False)
        os.chown(data, user.pw_uid, user.pw_gid)
    os.initgroups(user.pw_name, user.pw_gid)
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)
environment.update(PARALLAX_DATA_DIR=str(data), HOME=str(data))
profiles = data / "hermes"
profiles.mkdir(exist_ok=True)
try:
    if environment.get("ANTHROPIC_API_KEY"):
        gateway = profiles / "local-keys.json"
        if not gateway.exists():
            gateway.write_text(json.dumps([secrets.token_hex(32) for _ in range(3)]))
        crew, director, mcp = json.loads(gateway.read_text())
        environment.update(
            SUPER_ENGINE="hermes", SUPER_ENGINE_NAME="Hermes", SUPER_MODE="live",
            HERMES_URL="http://127.0.0.1:8642", HERMES_API_KEY=crew, SUPER_ENGINE_TOKEN=mcp,
            DIRECTOR_MODE="live", DIRECTOR_HERMES_URL="http://127.0.0.1:8643", DIRECTOR_HERMES_KEY=director,
            DIRECTOR_HERMES_MODEL="claude-fable-5-2", DIRECTOR_HERMES_PROVIDER="anthropic",
            DIRECTOR_HERMES_CHAT_MODEL="claude-haiku-5-5",
        )
        model_gateway(profiles, "crew", 8642, "claude-haiku-5-5", ["parallax"], crew, mcp)
        model_gateway(profiles, "director", 8643, "claude-fable-5-2", [], director, mcp)
    else:
        environment.update(DIRECTOR_MODE="mock", SUPER_MODE="mock")
    environment.pop("ANTHROPIC_API_KEY", None)
    start(["node", "scripts/studio-hosted.mjs"], "/app", environment)
    while not stopping:
        if any(process.poll() is not None for process in processes):
            exit_code = 1
            break
        time.sleep(0.5)
finally:
    for process in processes:
        if process.poll() is None:
            process.terminate()
    for process in processes:
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
sys.exit(exit_code)

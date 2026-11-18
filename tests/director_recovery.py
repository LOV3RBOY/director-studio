"""Durable jobs and the live Hermes request contract using a loopback-only stub.

Runner: own-server
"""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request

import director
from director import API, Client, fixtures


APP, DATA = map(Path, sys.argv[1:3])
PORT = sys.argv[3]
director.BASE = f"http://127.0.0.1:{PORT}"


@contextmanager
def server(mode, **env):
    settings = {key: value for key, value in os.environ.items() if not key.startswith("DIRECTOR_")}
    settings.update(DIRECTOR_MODE=mode, TREG_MODE="mock", SUPER_MODE="mock", PARALLAX_DEMO_BILLING="0", PARALLAX_DATA_DIR=str(DATA))
    settings.update(env)
    path = DATA.parent / f"director-server-{mode}.log"
    with path.open("ab") as log:
        child = subprocess.Popen(
            ["node", "node_modules/next/dist/bin/next", "start", "-p", PORT, "-H", "127.0.0.1"],
            cwd=APP, env=settings, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(director.BASE + "/api/auth/me", timeout=1):
                        break
                except OSError:
                    if child.poll() is not None:
                        raise AssertionError(path.read_text()[-3000:])
                    time.sleep(0.15)
            else:
                raise AssertionError("Director fixture server did not start")
            yield
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=10)


def sqlite_path():
    candidates = list(DATA.glob("*.sqlite*"))
    return next(path for path in candidates if not path.name.endswith(("-wal", "-shm")))


def brief(style_id, title):
    return {
        "title": title, "styleVersionId": style_id, "brief": "A dancer enters from the right and pauses in a pool of light.",
        "duration": 5, "aspect": "9:16", "model": "seedance-2.0",
    }


class Hermes(BaseHTTPRequestHandler):
    turns = []

    def log_message(self, *args):
        pass

    def answer(self, value):
        encoded = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        assert self.path == "/v1/toolsets"
        assert self.headers["Authorization"] == "Bearer loopback-fixture"
        self.answer([{"enabled": False, "tools": []}])

    def do_POST(self):
        assert self.path == "/v1/responses"
        assert self.headers["Authorization"] == "Bearer loopback-fixture"
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        contents = request["input"][0]["content"]
        assert request["stream"] is False and request["store"] is False
        evidence_tool = len(contents) > 1
        if evidence_tool:
            assert all(part["type"] == "input_image" and part["image_url"].startswith("data:image/jpeg;base64,") for part in contents[1:])
            assert request["model"] == "claude-fable-5-2" and request["provider"] == "anthropic"
            first_part, _, extra = contents[0]["text"].partition("\n")
            analyzed = json.loads(first_part)
            if not extra:
                response = {"windowSeconds": 0.6}
            else:
                response = {
                    "guide": "Loopback fixture confirms the model sees JPEG frames with measured timing.",
                    "rules": [
                        {"topic": topic, "basis": "inferred", "reuse": "adaptable", "detail": f"Concrete fixture interpretation for the {topic} topic.", "evidence": [len(contents) - 2]}
                        for topic in analyzed["topics"]
                    ],
                }
        else:
            plan_or_chat = json.loads(contents[0]["text"])
            if "current" in plan_or_chat:
                assert request["model"] == "grok-4.7" and request["provider"] == "xai"
                response = {"reply": "The loopback Director received the shot note."}
            else:
                assert request["model"] == "claude-fable-5-2" and request["provider"] == "anthropic"
                response = {
                    "clips": [{
                        "startMs": 0, "endMs": 5000, "mode": "continuous", "references": [],
                        "shots": [{
                            "startMs": 0, "endMs": 5000, "start": "Eye-height wide on the empty space.", "action": "A dancer enters right.",
                            "movement": "Ease forward on the entrance.", "end": "Hold on a settled pose.", "framing": "Keep the light centered.",
                            "continuity": "Maintain key-light direction.", "sound": "Soft footfall.", "transition": "continuous",
                        }],
                    }],
                    "imagePrompts": [],
                }
        self.turns.append((request["model"], request["provider"], len(contents)))
        self.answer({"model": request["model"], "status": "completed", "output_text": json.dumps(response), "usage": {"input_tokens": 7, "output_tokens": 11}})


def main():
    work = DATA.parent / "director-assets"
    work.mkdir(exist_ok=True)
    still, media, _ = fixtures(work)
    a = Client()
    with server("mock"):
        user_id = a.request("/api/auth/signup", {"email": "director-recovery@example.test", "password": "fixture-password"})["user"]["id"]
        video = a.upload(media)
        image = a.upload(still)
        request = a.request(f"{API}/styles", {"assetId": image["id"], "title": "Mock style"})
        a.job(request["job"])
        style_url = f"{API}/styles/{request['styleId']}"
        style = a.request(style_url)["versions"][0]
        saved = a.request(style_url + "/save", {"previousId": style["id"], "guide": style["profile"]["guide"]})["version"]
        job = a.request(f"{API}/projects", brief(saved["id"], "Mock recovery"))
        a.job(job["job"])
        project = a.request(f"{API}/projects/{job['projectId']}")["pack"]
        pending = a.request(f"{API}/packs/{project['id']}/render", {"clip": 0, "requestKey": "fixture-recovery-0001", "maxCredits": 0})["job"]
        a.request(f"{API}/store", status=503)

    database = sqlite_path()
    with sqlite3.connect(database) as db:
        db.execute("UPDATE director_jobs SET state = 'running', result = NULL WHERE id = ?", (pending["id"],))
        photo_file = DATA / db.execute("SELECT path FROM assets WHERE id = ?", (image["id"],)).fetchone()[0]
        hidden_file = photo_file.with_suffix(".missing")
        photo_file.rename(hidden_file)
    with server("mock"):
        take = a.job(pending)
        assert a.request(take["result"]["url"])[4:8] == b"ftyp"
        a.request(f"{style_url}/frames/{style['id']}/0", status=404)
    hidden_file.rename(photo_file)
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT COUNT(*) FROM assets WHERE job_id = ?", (pending["id"],)).fetchone() == (1,)

    with server("live"):
        assert a.request(f"{API}/styles") == {"styles": []}
        assert a.request(f"{API}/projects") == {"projects": []}
        a.request(f"{API}/jobs/{pending['id']}", status=404)
        a.request(f"{API}/styles", {"assetId": video["id"], "title": "Requires Hermes"}, status=503)
        a.request(f"{API}/store", status=503)

    gateway = ThreadingHTTPServer(("127.0.0.1", 0), Hermes)
    thread = threading.Thread(target=gateway.serve_forever, daemon=True)
    thread.start()
    try:
        with server(
            "live", DIRECTOR_HERMES_URL=f"http://127.0.0.1:{gateway.server_port}",
            DIRECTOR_HERMES_KEY="loopback-fixture", DIRECTOR_DAILY_AUTHORING_JOBS="8",
        ):
            requested = a.request(f"{API}/styles", {"assetId": video["id"], "title": "Loopback Hermes"})
            result = a.job(requested["job"])
            assert result["result"]["usage"]["input_tokens"] == 14
            style_url = f"{API}/styles/{requested['styleId']}"
            draft = a.request(style_url)["versions"][0]
            assert draft["profile"]["provenance"]["model"] == "claude-fable-5-2" and not draft["profile"]["fixture"]
            last = draft["profile"]["evidence"]["frames"][-1]
            assert 0.45 <= last["seconds"] <= 0.9 and last["filename"].startswith("window-")
            assert a.request(f"{style_url}/frames/{draft['id']}/{last['ordinal']}").startswith(b"\xff\xd8")
            saved = a.request(style_url + "/save", {"previousId": draft["id"], "guide": draft["profile"]["guide"]})["version"]
            requested = a.request(f"{API}/projects", brief(saved["id"], "Live contract test"))
            a.job(requested["job"])
            project_id = requested["projectId"]
            pack = a.request(f"{API}/projects/{project_id}")["pack"]
            a.job(a.request(f"{API}/projects/{project_id}/chat", {"message": "Give me a closer start."})["job"])
            a.request(f"{API}/packs/{pack['id']}/quote/0", status=503)
            a.request(f"{API}/packs/{pack['id']}/image-quote/0", status=503)
        assert [entry[:2] for entry in Hermes.turns] == [
            ("claude-fable-5-2", "anthropic"), ("claude-fable-5-2", "anthropic"),
            ("claude-fable-5-2", "anthropic"), ("grok-4.7", "xai"),
        ]
    finally:
        gateway.shutdown()
        gateway.server_close()

    review = "fixture-ambiguous-job"
    now = int(time.time() * 1000)
    with sqlite3.connect(database) as db:
        db.execute(
            """INSERT INTO director_jobs
              (id,user_id,kind,mode,state,project_id,snapshot_id,request_key,input,reserved,next_run,created_at,updated_at)
              VALUES (?,?,'render','live','submitting',?,?,?,?,100,?,?,?)""",
            (review, user_id, project_id, pack["id"], "fixture-live-review-01", '{"clip":0,"quotedUsd":0.42}', now, now, now),
        )
        db.execute("INSERT INTO ledger (user_id,kind,amount,job_id,note,created_at) VALUES (?,'hold',-100,?,'fixture hold',?)", (user_id, review, now))
    with server("live"):
        recovered = a.request(f"{API}/jobs/{review}")["job"]
        assert recovered["state"] == "review" and recovered["credits"] == {"reserved": 100, "spent": 0, "released": 0}
        replayed = a.request(f"{API}/packs/{pack['id']}/render", {"clip": 0, "requestKey": "fixture-live-review-01", "maxCredits": 100})["job"]
        assert replayed["id"] == review
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT kind, amount FROM ledger WHERE job_id = ?", (review,)).fetchall() == [("hold", -100)]
    print("Director recovery passed: mock restart, mode isolation, missing credentials, scoped Hermes requests, supplemental evidence, ambiguous live attempt and replay.")


main()

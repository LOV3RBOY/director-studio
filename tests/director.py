"""Provider-free Director Studio flow against a built server."""
import concurrent.futures
import copy
import http.cookiejar
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile


BASE = sys.argv[1]
API = "/api/director"


class Client:
    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def request(self, url, body=None, status=200, content_type="application/json"):
        if isinstance(body, dict):
            body = json.dumps(body).encode()
        request = urllib.request.Request(BASE + url, data=body, headers={"Content-Type": content_type})
        try:
            response = self.opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            data = response.read()
            assert response.status == status, (url, response.status, data[:500])
            if response.headers.get_content_type() == "application/json":
                return json.loads(data)
            return data

    def upload(self, file):
        boundary = "DirectorFixtureBoundary"
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file.name}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + file.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
        return self.request("/api/assets", body, content_type=f"multipart/form-data; boundary={boundary}")["asset"]

    def job(self, job):
        until = time.monotonic() + 45
        while time.monotonic() < until:
            fresh = self.request(f"{API}/jobs/{job['id']}")["job"]
            if fresh["state"] in {"succeeded", "failed", "review"}:
                assert fresh["state"] == "succeeded", fresh
                return fresh
            time.sleep(0.25)
        raise AssertionError(f"job did not finish: {job['id']}")


def fixtures(directory):
    image, footage, wave = [directory / name for name in ("cast.png", "scene.mp4", "sound.wav")]
    ffmpeg = ["ffmpeg", "-nostdin", "-loglevel", "error", "-y"]
    subprocess.run(ffmpeg + ["-f", "lavfi", "-i", "color=red:size=128x72", "-threads", "1", "-frames:v", "1", str(image)], check=True)
    subprocess.run(ffmpeg + [
        "-f", "lavfi", "-i", "testsrc2=size=128x72:rate=12", "-f", "lavfi", "-i", "sine=frequency=330",
        "-t", "2", "-c:v", "libx264", "-c:a", "aac", str(footage),
    ], check=True)
    subprocess.run(ffmpeg + ["-f", "lavfi", "-i", "sine=frequency=220", "-t", "1", str(wave)], check=True)
    return image, footage, wave


def main(directory):
    image, footage, wave = fixtures(directory)
    a, b = Client(), Client()
    a.request(f"{API}/status", status=401)
    a.request("/api/auth/guest", {})
    a.request(f"{API}/status", status=401)
    a.request("/api/auth/signup", {"email": "director-a@example.test", "password": "fixture-password", "name": "A"})
    b.request("/api/auth/signup", {"email": "director-b@example.test", "password": "fixture-password", "name": "B"})
    assert a.request(f"{API}/status") == {"mode": "mock"}
    video, cast, audio, foreign = a.upload(footage), a.upload(image), a.upload(wave), b.upload(image)

    requested = a.request(f"{API}/styles", {"assetId": video["id"], "title": "Test style", "notes": "Keep pacing. Ignore subject."})
    style_url = f"{API}/styles/{requested['styleId']}"
    a.job(requested["job"])
    draft = a.request(style_url)["versions"][0]
    evidence = draft["profile"]["evidence"]
    assert draft["profile"]["fixture"] and not draft["saved"]
    assert evidence["width"] == 128 and evidence["height"] == 72 and evidence["hasAudio"]
    assert 1.9 <= evidence["duration"] <= 2.1 and len(evidence["frames"]) >= 4
    timecodes = [frame["seconds"] for frame in evidence["frames"]]
    assert timecodes == sorted(set(timecodes)) and timecodes[0] == 0 and timecodes[-1] < evidence["duration"]
    frame = f"{style_url}/frames/{draft['id']}/0"
    assert a.request(frame).startswith(b"\xff\xd8")
    b.request(frame, status=404)
    saved = a.request(style_url + "/save", {"previousId": draft["id"], "guide": draft["profile"]["guide"] + "\nReviewed."})["version"]
    assert saved["saved"] and saved["version"] == 2
    b.request(style_url, status=404)

    brief = {
        "title": "Night departure", "styleVersionId": saved["id"],
        "brief": "A courier steps out from behind a doorway and checks for an approaching train.",
        "constraints": "Keep the original jacket.",
        "cast": [{"name": "Courier", "assetIds": [cast["id"]]}],
        "duration": 5, "aspect": "9:16", "model": "seedance-2.0",
    }
    req = a.request(f"{API}/projects", brief)
    a.job(req["job"])
    project = f"{API}/projects/{req['projectId']}"
    b.request(project, status=404)
    original = a.request(project)["pack"]
    edit_style = a.request(style_url + "/save", {"previousId": saved["id"], "guide": "Edited guide. Preserve the rules."})["version"]
    assert edit_style["version"] == 3
    assert a.request(project)["pinnedStyle"]["id"] == saved["id"]
    second = a.request(f"{API}/projects", {
        **brief, "title": "Different subject", "brief": "A ceramic cup slides across the counter and stops next to steam.", "cast": [],
    })
    a.job(second["job"])
    other_project = a.request(f"{API}/projects/{second['projectId']}")
    assert other_project["pinnedStyle"]["id"] == saved["id"]
    assert "ceramic cup" in other_project["pack"]["body"]["clips"][0]["prompt"]
    assert "courier" not in other_project["pack"]["body"]["clips"][0]["prompt"]

    changed = copy.deepcopy(original["body"]["plan"])
    refs = changed["clips"][0]["references"]
    refs.extend([
        {"assetId": video["id"], "modality": "video", "role": "motion", "scope": "Use the camera move only"},
        {"assetId": audio["id"], "modality": "audio", "role": "sound", "scope": "Soft ambience"},
    ])
    settings = original["body"]["settings"]
    bad = copy.deepcopy(changed)
    bad["clips"][0]["references"][1]["assetId"] = foreign["id"]
    a.request(project + "/pack", {"previousId": original["id"], "plan": bad, "settings": settings}, status=404)
    bad = copy.deepcopy(changed)
    bad["clips"][0]["references"][1]["modality"] = "image"
    a.request(project + "/pack", {"previousId": original["id"], "plan": bad, "settings": settings}, status=400)
    bad = copy.deepcopy(changed)
    bad["clips"][0]["shots"][0]["endMs"] = 4100
    a.request(project + "/pack", {"previousId": original["id"], "plan": bad, "settings": settings}, status=400)
    bad = copy.deepcopy(changed)
    bad["clips"][0]["shots"][0]["transition"] = "cut"
    a.request(project + "/pack", {"previousId": original["id"], "plan": bad, "settings": settings}, status=400)
    v2 = a.request(project + "/pack", {"previousId": original["id"], "plan": changed, "settings": settings})["pack"]
    assert v2["version"] == 2
    pack = f"{API}/packs/{v2['id']}"
    assert a.request(pack + "/quote/0") == {"millicredits": 0, "estimatedUsd": 0, "fixture": True}
    submit = {"clip": 0, "requestKey": "same-approved-request-001", "maxCredits": 0}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        queued = list(pool.map(lambda _: a.request(pack + "/render", submit)["job"], range(4)))
    assert len({job["id"] for job in queued}) == 1
    take = a.job(queued[0])
    assert take["snapshotId"] == v2["id"] and take["credits"] == {"reserved": 0, "spent": 0, "released": 0}
    clip_file = take["result"]["url"]
    raw = a.request(clip_file)
    b.request(clip_file, status=404)
    stored = directory / "downloaded-take.mp4"
    stored.write_bytes(raw)
    streams = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(stored)], text=True)
    assert "video" in streams and "audio" in streams

    def portable(pack_url):
        job = a.job(a.request(pack_url + "/export", {})["job"])
        b.request(job["result"]["url"], status=404)
        with zipfile.ZipFile(io.BytesIO(a.request(job["result"]["url"]))) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            entry = manifest["clips"][0]
            prompt = archive.read(entry["promptFile"]).decode().strip()
            assert prompt == entry["providerRequest"]["prompt"]
            assert "https://" not in json.dumps(manifest)
            for item in entry["attachments"]:
                assert archive.read(item["path"])
            return manifest

    first_export = portable(pack)
    first_body = first_export["clips"][0]["providerRequest"]
    assert "@image1" in first_body["prompt"] and "@video1" in first_body["prompt"] and "@audio1" in first_body["prompt"]
    assert list(key for key in ("images_list", "video_files", "audio_files", "quality") if key in first_body) == ["images_list", "video_files", "audio_files", "quality"]
    changed["clips"][0]["promptOverride"] = "Hold the open door in the foreground as the train arrives in the background."
    v3 = a.request(project + "/pack", {
        "previousId": v2["id"], "plan": changed,
        "settings": {"model": "seedance-2.5", "resolution": "720p", "seed": 190},
    })["pack"]
    new_export = portable(f"{API}/packs/{v3['id']}")
    live_body = new_export["clips"][0]["providerRequest"]
    assert live_body["seed"] == 190 and live_body["omni_reference_task_type"] == "reference"
    assert "videos_list" in live_body and "audios_list" in live_body and "video_files" not in live_body
    assert "Hold the open door" in live_body["prompt"] and "Hold the open door" not in first_body["prompt"]
    assert a.request(pack)["pack"] == v2
    assert a.job(a.request(project + "/chat", {"message": "Move the camera closer."})["job"])["result"]["reply"]
    print("Director end-to-end passed: sign-in, evidence, tenant isolation, style reuse, snapshots, export, model mappings, concurrent render, audio take, chat.")


with tempfile.TemporaryDirectory() as temp:
    main(Path(temp))

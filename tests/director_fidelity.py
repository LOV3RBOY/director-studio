"""Phase C: fidelity scores and the deterministic style grade, through the Director API.

Runner: own-server
"""

import hashlib
import subprocess
import tempfile
import time
from pathlib import Path

from director import API, Client
from director_recovery import server
from director_style_metrics import learn, run_ffmpeg


def probe(path):
    return subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)], text=True,
    ).split()


def review(client, take_id, status=200):
    return client.request(f"{API}/renders/{take_id}/fidelity", status=status)


def settled(client, take_id, previous=None):
    until = time.monotonic() + 90
    while time.monotonic() < until:
        current = review(client, take_id)["fidelity"]
        if current and current["id"] != previous and current["state"] in {"succeeded", "failed"}:
            assert current["state"] == "succeeded", current
            return current
        time.sleep(0.3)
    raise AssertionError(f"fidelity did not finish for {take_id}")


def main(directory):
    reference = directory / "reference.mp4"
    run_ffmpeg(
        "-f", "lavfi", "-i", "color=c=0xD9662B:size=96x54:rate=24:duration=6,noise=alls=70:allf=t",
        "-f", "lavfi", "-i", "sine=frequency=220:duration=6",
        "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
        "-c:a", "aac", "-threads", "1", reference,
    )
    a, b = Client(), Client()
    a.request("/api/auth/signup", {"email": "fidelity-a@example.test", "password": "fixture-password"})
    b.request("/api/auth/signup", {"email": "fidelity-b@example.test", "password": "fixture-password"})
    url, draft = learn(a, assetId=a.upload(reference)["id"])
    saved = a.request(url + "/save", {"previousId": draft["id"], "guide": draft["profile"]["guide"]})["version"]
    style = saved["profile"]["evidence"]["metrics"]
    assert style["palette"] and style["grain"] is not None

    started = a.request(API + "/projects", {
        "title": "Fidelity fixture", "styleVersionId": saved["id"], "brief": "A slow push across a warm room.",
        "constraints": "", "cast": [], "duration": 5, "aspect": "16:9", "model": "seedance-2.5",
    })
    a.job(started["job"])
    project = f"{API}/projects/{started['projectId']}"
    detail = a.request(project)
    pack = f"{API}/packs/{detail['pack']['id']}"
    plan_job = next(job for job in detail["jobs"] if job["kind"] == "plan")
    take = a.job(a.request(pack + "/render", {"clip": 0, "requestKey": "fidelity-fixture-take-01", "maxCredits": 0})["job"])
    original = a.request(take["result"]["url"])

    # A delivered take is scored automatically, and only its owner can read the score.
    first = settled(a, take["id"])
    report = first["report"]
    assert first["styleVersionId"] == saved["id"] and report["takeAssetId"] == take["result"]["assetId"]
    checks = {check["metric"]: check for check in report["numeric"]}
    assert {"palette", "tone.p50", "tone.contrast", "tone.saturation"} <= checks.keys(), checks.keys()
    assert not checks["palette"]["pass"] and checks["palette"]["actual"] > 12
    assert all(item["reason"] for item in report["skipped"])
    signature = [index for index, rule in enumerate(saved["profile"]["rules"])
                 if rule["reuse"] == "signature" and rule["basis"] != "unknown"]
    assert [item["index"] for item in report["judged"]] == signature
    assert report["judge"]["fixture"] and all(item["note"].startswith("Fixture review") for item in report["judged"])
    rates = [rate for rate in (report["numericRate"], report["judgedRate"]) if rate is not None]
    assert first["score"] == round(100 * sum(rates) / len(rates))
    assert report["numericRate"] == sum(check["pass"] for check in report["numeric"]) / len(report["numeric"])
    review(b, take["id"], status=404)
    b.request(f"{API}/renders/{take['id']}/fidelity", {}, status=404)
    review(a, plan_job["id"], status=404)
    a.request(f"{API}/renders/{plan_job['id']}/grade", {}, status=404)

    # Scoring again queues one new score; a second request while it waits returns the same one.
    again = a.request(f"{API}/renders/{take['id']}/fidelity", {})["fidelity"]
    assert again["id"] != first["id"] and again["state"] in {"queued", "running", "succeeded"}
    if again["state"] != "succeeded":
        duplicate = a.request(f"{API}/renders/{take['id']}/fidelity", {})["fidelity"]
        assert duplicate["id"] == again["id"] or duplicate["state"] == "queued"
    second = settled(a, take["id"], previous=first["id"])
    assert second["score"] == first["score"] and second["report"]["numeric"] == report["numeric"]

    # Grading moves the palette toward the style, adds the missing grain and keeps the original take.
    for strength in (0, 1.5):
        a.request(f"{API}/renders/{take['id']}/grade", {"strength": strength}, status=400)
    b.request(f"{API}/renders/{take['id']}/grade", {}, status=404)
    graded = a.request(f"{API}/renders/{take['id']}/grade", {})["grade"]
    grade_report = graded["report"]
    distance = grade_report["paletteDistance"]
    assert graded["strength"] == 0.6 and len(graded["lutSha256"]) == 64
    assert distance["after"] <= 0.6 * distance["before"], distance
    file = directory / "graded.mp4"
    file.write_bytes(a.request(graded["url"]))
    assert probe(file) == ["video", "audio"]
    b.request(graded["url"], status=404)
    assert hashlib.sha256(a.request(take["result"]["url"])).digest() == hashlib.sha256(original).digest()
    assert review(a, take["id"])["grade"]["id"] == graded["id"]

    # Identical inputs build a byte-identical LUT. The style is grainier than the graded take,
    # so the default grade adds grain that a grain-free grade does not.
    plain = a.request(f"{API}/renders/{take['id']}/grade", {"strength": 0.6, "grain": False})["grade"]
    assert plain["lutSha256"] == graded["lutSha256"] and plain["assetId"] != graded["assetId"]
    assert plain["report"]["grainAdded"] == 0 < grade_report["grainAdded"]
    assert grade_report["grain"]["after"] > plain["report"]["grain"]["after"], (grade_report["grain"], plain["report"]["grain"])
    stronger = a.request(f"{API}/renders/{take['id']}/grade", {"strength": 1, "grain": False})["grade"]
    assert stronger["lutSha256"] != graded["lutSha256"]
    assert stronger["report"]["paletteDistance"]["after"] <= distance["after"]

    print("PASS: automatic and repeated fidelity scores, tenant isolation, palette-reducing deterministic grades, added grain")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as scratch, server("mock"):
        main(Path(scratch))

"""Director projects on registry video models, provider-free, against a built server."""
import copy
import subprocess
import sys
import tempfile
from pathlib import Path

import director
from director import API, Client, fixtures


def main(directory):
    image, footage, _ = fixtures(directory)
    key = directory / "key.png"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=blue:size=128x72",
                    "-frames:v", "1", str(key)], check=True)
    a, b = Client(), Client()
    a.request("/api/auth/signup", {"email": "models-a@example.test", "password": "fixture-password", "name": "A"})
    b.request("/api/auth/signup", {"email": "models-b@example.test", "password": "fixture-password", "name": "B"})

    # Every eligible registry video model is listed once; Seedance stays omni-reference.
    listed = {item["id"]: item for item in a.request(f"{API}/models")["models"]}
    assert listed["seedance-2.0"]["engine"] == listed["seedance-2.5"]["engine"] == "omni"
    assert {"veo-3.1", "kling-3-std", "minimax-h3", "hailuo-2.3", "wan-3"} <= listed.keys()
    assert not {"hailuo-2.3-fast", "heygen-avatar-iv", "runway-aleph-2", "sora-2-pro"} & listed.keys()
    assert all(item["available"] for item in listed.values())
    veo, hailuo = listed["veo-3.1"], listed["hailuo-2.3"]
    assert veo["durations"] == [4, 6, 8] and veo["slots"] == ["start", "end"] and veo["references"] == {"image": 2, "video": 0, "audio": 0}
    assert hailuo["aspects"] is None and hailuo["slots"] == ["start"]

    video, cast, keyframe = a.upload(footage), a.upload(image), a.upload(key)
    requested = a.request(f"{API}/styles", {"assetId": video["id"], "title": "Model style", "notes": ""})
    style_url = f"{API}/styles/{requested['styleId']}"
    a.job(requested["job"])
    draft = a.request(style_url)["versions"][0]
    saved = a.request(style_url + "/save", {"previousId": draft["id"], "guide": draft["profile"]["guide"]})["version"]
    brief = {
        "title": "Platform", "styleVersionId": saved["id"], "brief": "A courier waits on a platform as a train arrives.",
        "constraints": "", "cast": [{"name": "Courier", "assetIds": [cast["id"]]}], "duration": 14, "aspect": "16:9", "model": "veo-3.1",
    }

    # The model's own limits gate the brief.
    for patch, message in [
        ({"model": "hailuo-2.3-fast"}, "available video model"), ({"model": "nope"}, "available video model"),
        ({"aspect": "4:3"}, "aspect ratios"), ({"duration": 5}, "cannot make 5 seconds"),
    ]:
        assert message in str(a.request(f"{API}/projects", {**brief, **patch}, status=400)), patch

    # 14 s on Veo (4, 6 or 8 s clips) becomes 8 + 6: the fewest clips the model can render.
    started = a.request(f"{API}/projects", brief)
    a.job(started["job"])
    pack = a.request(f"{API}/projects/{started['projectId']}")["pack"]["body"]
    assert [(c["endMs"] - c["startMs"]) // 1000 for c in pack["plan"]["clips"]] == [8, 6]
    assert pack["settings"] == {"model": "veo-3.1", "resolution": "1080p"}
    assert [clip["endpoint"] for clip in pack["clips"]] == ["veo-3.1", "veo-3.1"]
    assert all(not clip["attachments"] and "Reference" not in clip["prompt"] for clip in pack["clips"])
    assert any("Veo 3.1 renders from the prompt" in note and "clip 1, clip 2" in note for note in pack["notes"]), pack["notes"]

    # A project on any start-frame model accepts any aspect; Hailuo has no aspect control.
    hail = a.request(f"{API}/projects", {**brief, "model": "hailuo-2.3", "aspect": "4:3", "duration": 16, "cast": []})
    a.job(hail["job"])
    hail_pack = a.request(f"{API}/projects/{hail['projectId']}")["pack"]
    assert [clip["duration"] for clip in hail_pack["body"]["clips"]] == [10, 6]

    # Kling renders through the shared pipeline: keyframes become start and end frames.
    started = a.request(f"{API}/projects", {**brief, "model": "kling-3-std", "duration": 5})
    a.job(started["job"])
    project = f"{API}/projects/{started['projectId']}"
    original = a.request(project)["pack"]
    plan, settings = copy.deepcopy(original["body"]["plan"]), original["body"]["settings"]
    assert settings == {"model": "kling-3-std", "resolution": "720p"}
    plan["clips"][0]["references"].append({"assetId": keyframe["id"], "modality": "image", "role": "keyframe", "scope": "Opening frame"})
    edit = lambda value, status=200: a.request(project + "/pack", {"previousId": original["id"], "plan": plan, "settings": value}, status=status)
    assert "no documented seed" in str(edit({**settings, "seed": 4}, 400))
    assert "renders at 720p" in str(edit({**settings, "resolution": "1080p"}, 400))
    revised = edit(settings)["pack"]
    files = revised["body"]["clips"][0]["attachments"]
    assert [(file["assetId"], file["slot"], file["role"]) for file in files] == [(keyframe["id"], "start", "keyframe")]

    url = f"{API}/packs/{revised['id']}"
    b.request(url + "/quote/0", status=404)
    quote = a.request(url + "/quote/0")
    assert quote["fixture"] and quote["estimatedUsd"] == 0 and quote["millicredits"] > 0
    before = a.request("/api/wallet")["balance"]
    a.request(url + "/render", {"clip": 0, "requestKey": "kling-render-low-0001", "maxCredits": quote["millicredits"] - 1}, status=409)
    submit = {"clip": 0, "requestKey": "kling-render-approved-1", "maxCredits": quote["millicredits"]}
    queued = a.request(url + "/render", submit)["job"]
    assert queued["state"] == "polling" and a.request(url + "/render", submit)["job"]["id"] == queued["id"]
    take = a.job(queued)
    # Charged once, by the shared pipeline; the Director reserved nothing.
    assert take["credits"] == {"reserved": 0, "spent": 0, "released": 0}
    assert a.request("/api/wallet")["balance"] == before - quote["millicredits"]
    shared = [job for job in a.request("/api/jobs")["jobs"] if job["modelId"] == "kling-3-std"]
    assert len(shared) == 1 and shared[0]["inputs"] == {"start": [keyframe["id"]]} and shared[0]["params"]["duration"] == 5
    assert shared[0]["assets"][0]["id"] == take["result"]["assetId"]
    stored = directory / "take.mp4"
    stored.write_bytes(a.request(take["result"]["url"]))
    assert "video" in subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(stored)], text=True)
    b.request(take["result"]["url"], status=404)
    print("PASS: Director projects on registry video models — limits, planning, frames, single charge and delivery")


if __name__ == "__main__":
    director.BASE = sys.argv[1]
    with tempfile.TemporaryDirectory() as folder:
        main(Path(folder))

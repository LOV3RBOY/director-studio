"""Provider-free measurements and multi-reference evidence through the Director API."""

import copy
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import director
from director import API, Client


def run_ffmpeg(*args):
    subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)],
        check=True, timeout=45, capture_output=True,
    )


def delta_e_2000(first, second):
    l1, a1, b1 = first
    l2, a2, b2 = second
    average_c = (math.hypot(a1, b1) + math.hypot(a2, b2)) / 2
    adjust = (1 - math.sqrt(average_c**7 / (average_c**7 + 25**7))) / 2
    a1, a2 = a1 * (1 + adjust), a2 * (1 + adjust)
    c1, c2 = math.hypot(a1, b1), math.hypot(a2, b2)
    h1, h2 = [math.degrees(math.atan2(b, a)) % 360 for a, b in [(a1, b1), (a2, b2)]]
    dh = (h2 - h1 + 180) % 360 - 180 if c1 * c2 else 0
    h = (h1 + dh / 2) % 360 if c1 * c2 else h1 + h2
    l, c = (l1 + l2) / 2, (c1 + c2) / 2
    cos = lambda degrees: math.cos(math.radians(degrees))
    t = 1 - .17 * cos(h - 30) + .24 * cos(2*h) + .32 * cos(3*h + 6) - .20 * cos(4*h - 63)
    sl = 1 + .015 * (l - 50)**2 / math.sqrt(20 + (l - 50)**2)
    sc, sh = 1 + .045*c, 1 + .015*c*t
    rt = -2 * math.sqrt(c**7 / (c**7 + 25**7)) * math.sin(math.radians(60 * math.exp(-((h - 275) / 25)**2)))
    dl, dc = (l2 - l1) / sl, (c2 - c1) / sc
    dh = 2 * math.sqrt(c1 * c2) * math.sin(math.radians(dh / 2)) / sh
    return math.sqrt(dl*dl + dc*dc + dh*dh + rt*dc*dh)


def learn(client, **sources):
    style = client.request(f"{API}/styles", {"title": "Measured fixture", **sources})
    client.job(style["job"])
    url = f"{API}/styles/{style['styleId']}"
    return url, client.request(url)["versions"][0]


def main(directory):
    clip = directory / "two-colors.mp4"
    run_ffmpeg(
        "-f", "lavfi", "-i", "color=blue:size=128x72:rate=12:duration=2",
        "-f", "lavfi", "-i", "color=yellow:size=128x72:rate=12:duration=2",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=4",
        "-filter_complex_threads", "1", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map", "[v]", "-map", "2:a:0", "-c:v", "libx264", "-c:a", "aac", "-threads", "1", clip,
    )
    clicks = directory / "clicks.mp4"
    run_ffmpeg(
        "-f", "lavfi", "-i", "color=gray:size=128x72:rate=12:duration=8",
        "-f", "lavfi", "-i", r"aevalsrc=0.75*sin(2*PI*1000*t)*lt(mod(t\,0.5)\,0.03):s=22050:d=8",
        "-c:v", "libx264", "-c:a", "aac", "-threads", "1", clicks,
    )
    a, b = Client(), Client()
    a.request("/api/auth/signup", {"email": "metrics-a@example.test", "password": "fixture-password"})
    b.request("/api/auth/signup", {"email": "metrics-b@example.test", "password": "fixture-password"})
    color_id, clicks_id = a.upload(clip)["id"], a.upload(clicks)["id"]
    foreign_id = b.upload(clicks)["id"]
    _, single = learn(a, assetId=color_id)
    evidence = single["profile"]["evidence"]
    metrics = evidence["metrics"]
    assert single["profile"]["schemaVersion"] == 2
    assert len(metrics["editing"]["cutTimes"]) == 1, metrics["editing"]
    assert abs(metrics["editing"]["cutTimes"][0] - 2) <= .1, metrics["editing"]
    assert abs(metrics["editing"]["shotLengths"]["mean"] - 2) <= .1
    # CIE Lab (D65) for the known sRGB fixtures, blue and yellow.
    for expected in [(32.30, 79.19, -107.86), (97.14, -21.55, 94.48)]:
        assert min(delta_e_2000(entry["lab"], expected) for entry in metrics["palette"]) < 5, metrics["palette"]
    assert abs(metrics["audio"]["integratedLufs"] - (-21.1)) <= 1, metrics["audio"]
    _, repeat = learn(a, assetIds=[color_id])
    assert repeat["profile"]["evidence"]["metrics"] == metrics
    _, click_style = learn(a, assetId=clicks_id)
    click_metrics = click_style["profile"]["evidence"]["metrics"]
    assert abs(click_metrics["audio"]["tempo"] - 120) <= 2, click_metrics["audio"]
    assert click_metrics["audio"]["confidence"] >= .35

    if "vidstabdetect" in subprocess.run(["ffmpeg", "-hide_banner", "-filters"], check=True, capture_output=True, text=True, timeout=10).stdout:
        texture = directory / "texture.png"
        run_ffmpeg("-f", "lavfi", "-i", "testsrc2=size=512x288:rate=12", "-frames:v", "1", "-threads", "1", texture)
        push = directory / "push.mp4"
        run_ffmpeg("-i", texture, "-vf",
                   "zoompan=z=1+0.012*on:x=iw/2-iw/zoom/2:y=ih/2-ih/zoom/2:d=36:s=256x144:fps=12",
                   "-frames:v", "36", "-c:v", "libx264", "-threads", "1", push)
        _, zoom_style = learn(a, assetId=a.upload(push)["id"])
        motion = zoom_style["profile"]["evidence"]["metrics"]["motion"]
        assert motion["camera"] == "push", motion
    else:
        assert metrics["motion"]["camera"] is None and metrics["motion"]["motionEnergy"] is not None
        assert "vidstabdetect" in metrics["reasons"]["motion"]

    endpoint = f"{API}/styles"
    a.request(endpoint, {"title": "Ambiguous", "assetId": color_id, "assetIds": [clicks_id]}, status=400)
    a.request(endpoint, {"title": "Duplicate", "assetIds": [color_id, color_id]}, status=400)
    a.request(endpoint, {"title": "Foreign", "assetIds": [color_id, foreign_id]}, status=404)
    url, version = learn(a, assetIds=[color_id, clicks_id])
    combined = version["profile"]["evidence"]
    assert [source["assetId"] for source in combined["sources"]] == [color_id, clicks_id]
    assert combined["sources"][0]["metrics"] == metrics
    assert combined["sources"][1]["metrics"] == click_metrics
    expected_mean = (metrics["tone"]["p50"] + click_metrics["tone"]["p50"]) / 2
    assert math.isclose(combined["metrics"]["tone"]["p50"], expected_mean)
    assert math.isclose(combined["metricSpread"]["tone.p50"], abs(expected_mean - metrics["tone"]["p50"]))
    assert 2 <= len(combined["frames"]) <= 10
    assert [frame["ordinal"] for frame in combined["frames"]] == list(range(len(combined["frames"])))
    frame = next(item for item in combined["frames"] if item["source"] == 1)
    frame_url = f"{url}/frames/{version['id']}/{frame['ordinal']}"
    result = a.request(frame_url)
    assert result.startswith(b"\xff\xd8") and result != a.request(f"{url}/frames/{version['id']}/0")
    b.request(frame_url, status=404)
    rules = version["profile"]["rules"]
    assert next(rule for rule in rules if rule["topic"] == "palette")["measures"] == ["palette"]
    invalid = copy.deepcopy(rules)
    invalid[0]["measures"] = ["tone.fake"]
    save = {"previousId": version["id"], "guide": version["profile"]["guide"]}
    a.request(url + "/save", {**save, "rules": invalid}, status=400)
    assert combined["metrics"]["editing"]["cutTimes"] is None
    invalid[0]["measures"] = ["editing.cutTimes"]
    a.request(url + "/save", {**save, "rules": invalid}, status=400)
    invalid[0] = {**rules[0], "basis": "observed", "reuse": "signature", "evidence": [0]}
    a.request(url + "/save", {**save, "rules": invalid}, status=400)
    invalid[0]["evidence"].append(frame["ordinal"])
    saved = a.request(url + "/save", {**save, "rules": invalid})["version"]
    assert saved["saved"] and saved["id"] != version["id"]
    assert a.request(url)["versions"][1] == version
    print("PASS: deterministic media metrics, ownership, multi-reference evidence, and immutable saves")


if __name__ == "__main__":
    director.BASE = sys.argv[1]
    with tempfile.TemporaryDirectory() as scratch:
        main(Path(scratch))

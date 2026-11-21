"""Provider-free Style Kit checks against the built app.

Runner: own-server
"""
import json
import os
import sqlite3
import subprocess
import tempfile
from pathlib import Path

from director import API, Client
from director_recovery import APP, DATA, server
from director_style_metrics import learn, run_ffmpeg


SCOPE = "Style reference only: match lighting, palette, composition, texture and camera behavior. Do not reproduce its people, objects, text or location."
PACK_NOTE = "Prompt timing is a creative target. Compare delivered cuts, motion and identity with the storyboard."


def probe(filename):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration",
        "-of", "json", str(filename),
    ], timeout=45))


def download(client, asset_id, filename):
    filename.write_bytes(client.request(f"/api/assets/{asset_id}/file"))
    return probe(filename)


def save(client, url, draft, status=200):
    return client.request(url + "/save", {
        "previousId": draft["id"], "guide": draft["profile"]["guide"],
    }, status=status)


def ref(asset, modality, role, scope):
    return {"assetId": asset, "modality": modality, "role": role, "scope": scope}


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def compile_contract(user_id, brief, plan, settings, style, body):
    script = """
import { tsImport } from "tsx/esm/api";
const { compilePack, providerBody } = await tsImport("./src/server/director/compiler.ts", import.meta.url);
const { userId, brief, plan, settings, style } = JSON.parse(process.argv[1]);
const pack = compilePack(userId, brief, plan, settings, style);
process.stdout.write(JSON.stringify([pack, providerBody(pack.clips[0], pack.settings, brief.aspect, (file) => file.filename)]));
"""
    output = subprocess.check_output([
        "node", "--conditions=react-server", "--input-type=module", "-e",
        script, encode({"userId": user_id, "brief": brief, "plan": plan, "settings": settings, "style": style}),
    ], cwd=APP, env={**os.environ, "PARALLAX_DATA_DIR": str(DATA)}, text=True, timeout=30)
    clip = body["clips"][0]
    expected_provider = {
        "prompt": clip["prompt"], "resolution": "720p", "duration": 5, "aspect_ratio": "16:9",
        "images_list": [file["filename"] for file in clip["attachments"]],
    }
    if settings["model"] == "seedance-2.0":
        expected_provider["quality"] = "high"
    else:
        expected_provider.update(seed=-1, omni_reference_task_type="reference")
    assert output == encode([body, expected_provider]), output


def main(directory):
    clip, still = directory / "source.mp4", directory / "still.png"
    run_ffmpeg(
        "-f", "lavfi", "-i", "testsrc2=size=768x432:rate=12:duration=16",
        "-f", "lavfi", "-i", "sine=frequency=330:duration=16",
        "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-threads", "1", clip,
    )
    run_ffmpeg("-f", "lavfi", "-i", "color=red:size=704x400", "-frames:v", "1", "-threads", "1", still)
    a, b = Client(), Client()
    user_id = a.request("/api/auth/signup", {"email": "kit-a@example.test", "password": "fixture-password"})["user"]["id"]
    b.request("/api/auth/signup", {"email": "kit-b@example.test", "password": "fixture-password"})
    still_id, video_id = a.upload(still)["id"], a.upload(clip)["id"]
    url, draft = learn(a, assetIds=[still_id, video_id])
    profile = draft["profile"]
    assert not draft["saved"] and "kit" not in profile
    selections = profile["exemplars"]
    assert 3 <= len(selections) <= 6 and {item["role"] for item in selections} == {"lighting", "composition"}
    assert all(item["why"] for item in selections)
    frames = {frame["ordinal"]: frame for frame in profile["evidence"]["frames"]}
    window = profile["motionWindow"]
    assert window["source"] == 1 and window["startSec"] == 0 and window["endSec"] == 15

    with sqlite3.connect(DATA / "parallax.db") as db:
        for patch, message in [
            ({"exemplars": [{**selections[0], "ordinal": 900}, *selections[1:]]}, "outside its evidence"),
            ({"exemplars": [{**selections[0], "role": "motion"}, *selections[1:]]}, "lighting"),
            ({"motionWindow": {**window, "source": 0}}, "inside a video reference"),
            ({"motionWindow": {**window, "startSec": 14, "endSec": 17}}, "inside a video reference"),
            ({"motionWindow": {**window, "endSec": 15.5}}, "up to 15 seconds"),
        ]:
            db.execute("UPDATE director_style_versions SET profile = ? WHERE id = ?", (encode({**profile, **patch}), draft["id"]))
            db.commit()
            assert message in encode(save(a, url, draft, status=400))
        db.execute("UPDATE director_style_versions SET profile = ? WHERE id = ?", (encode(profile), draft["id"]))
    b.request(url + "/save", {"previousId": draft["id"], "guide": profile["guide"]}, status=404)
    saved = save(a, url, draft)["version"]
    kit = saved["profile"]["kit"]
    assert len(kit["images"]) == len(selections) and len(set(kit["images"])) == len(selections)
    assert {still_id, video_id}.isdisjoint([*kit["images"], kit["motion"]])
    for selection, asset in zip(selections, kit["images"]):
        image = download(a, asset, directory / "exemplar.jpg")["streams"][0]
        assert (image["width"], image["height"]) == [(704, 400), (768, 432)][frames[selection["ordinal"]]["source"]]
        small = directory / "evidence.jpg"
        small.write_bytes(a.request(f"{url}/frames/{draft['id']}/{selection['ordinal']}"))
        assert probe(small)["streams"][0]["width"] == 640
        b.request(f"/api/assets/{asset}/file", status=404)
    motion = download(a, kit["motion"], directory / "motion.mp4")
    assert 14.9 <= float(motion["format"]["duration"]) <= 15
    assert [(s["codec_type"], s["codec_name"]) for s in motion["streams"]] == [("video", "h264")]
    assert (motion["streams"][0]["width"], motion["streams"][0]["height"]) == (768, 432)
    b.request(f"/api/assets/{kit['motion']}/file", status=404)
    edited = save(a, url, saved)["version"]
    assert edited["id"] != saved["id"] and edited["profile"]["kit"] == kit
    assert a.request(url)["versions"] == [edited, saved, draft]
    still_url, still_draft = learn(a, assetId=still_id)
    assert save(a, still_url, still_draft)["version"]["profile"]["kit"]["motion"] is None

    legacy = {}
    with sqlite3.connect(DATA / "parallax.db") as db:
        style_id = url.rsplit("/", 1)[-1]
        for version in (1, 2):
            identity = f"legacy_style_{version}"
            old = {key: value for key, value in profile.items() if key not in ("exemplars", "motionWindow")}
            old["schemaVersion"] = version
            if version == 1:
                old["evidence"] = {key: value for key, value in profile["evidence"].items() if key not in ("metrics", "metricSpread", "sources")}
                old["rules"] = [{key: value for key, value in rule.items() if key != "measures"} for rule in profile["rules"]]
            legacy[identity] = old
            db.execute("INSERT INTO director_style_versions SELECT ?, user_id, style_id, ?, 1, ?, created_at FROM director_style_versions WHERE id = ? AND style_id = ?",
                       (identity, 10 + version, encode(old), draft["id"], style_id))
        # Reuse one fixture file under distinct owned IDs to exercise the compiler's capacity.
        db.execute("CREATE TEMP TABLE reference_fixture AS SELECT * FROM assets WHERE id = ?", (still_id,))
        copies = [row[1] for row in db.execute("PRAGMA table_info(assets)") if row[1] not in ("id", "seq")]
        columns = ", ".join(copies)
        for number in range(28):
            db.execute(f"INSERT INTO assets (id, {columns}) SELECT ?, {columns} FROM reference_fixture", (f"kit_image_{number}",))
        for number in range(10):
            db.execute(f"INSERT INTO assets (id, {columns}) SELECT ?, {columns} FROM assets WHERE id = ?", (f"kit_video_{number}", video_id))

    def project(style_id, model):
        brief = {
            "title": "Style kit fixture", "styleVersionId": style_id, "brief": "A camera crosses the room.",
            "constraints": "", "cast": [{"name": "Cast", "notes": "", "assetIds": [still_id]}],
            "duration": 5, "aspect": "16:9", "model": model,
        }
        started = a.request(API + "/projects", brief)
        a.job(started["job"])
        endpoint = f"{API}/projects/{started['projectId']}"
        detail = a.request(endpoint)
        assert detail["pinnedStyle"]["id"] == style_id
        return endpoint, detail["pack"], brief

    def update(endpoint, previous, plan, settings):
        return a.request(endpoint + "/pack", {"previousId": previous["id"], "plan": plan, "settings": settings})["pack"]

    for model, cap in [("seedance-2.0", 2), ("seedance-2.5", 4)]:
        is20 = cap == 2
        endpoint, initial, brief = project(saved["id"], model)
        settings = {"model": model, "resolution": "720p"}
        identity = ref(still_id, "image", "identity", "Keep the actor")
        framing = ref("kit_image_0", "image", "composition", "Match the framing")
        plan = {
            "clips": [{
                "startMs": 0, "endMs": 5000, "mode": "continuous",
                "shots": [{
                    "startMs": 0, "endMs": 5000, "start": "Wide shot.", "action": "Cross the room.",
                    "movement": "Track laterally.", "end": "Hold.", "framing": "Eye level.",
                    "continuity": "Keep the eyeline.", "sound": "", "transition": "continuous",
                }],
                "references": [framing, identity], "promptOverride": "Cross the room.",
            }],
            "imagePrompts": [], "notes": "",
        }
        enabled = update(endpoint, initial, plan, settings)
        attachments = enabled["body"]["clips"][0]["attachments"]
        assert [a["assetId"] for a in attachments] == [still_id, "kit_image_0", *kit["images"][:cap], *([] if is20 else [kit["motion"]])]
        assert [(a["role"], a["scope"]) for a in attachments[2:]] == [
            (selection["role"], SCOPE) for selection in selections[:cap]
        ] + ([] if is20 else [("motion", SCOPE)])
        assert [a["index"] for a in attachments if a["modality"] == "image"] == list(range(1, 3 + cap))

        # Snapshot the Phase A renderer bytes, including its original manual reference order.
        label = "@image" if is20 else "Reference image "
        expected = {
            "plan": plan, "settings": {**settings, **({"quality": "high"} if is20 else {"seed": -1})},
            "clips": [{
                "endpoint": model + "-omni-reference", "duration": 5,
                "attachments": [
                    {**item, "index": index, "filename": item["assetId"] + ".png", "mime": "image/png", "duration": None}
                    for index, item in enumerate((framing, identity), 1)
                ],
                "prompt": f"One continuous take.\n{label}1 — composition: Match the framing.\n{label}2 — identity: Keep the actor.\nCross the room.",
            }],
            "notes": [PACK_NOTE, plan["notes"]] if plan["notes"] else [PACK_NOTE],
        }
        for style_id, old in legacy.items():
            legacy_url, legacy_pack, legacy_brief = project(style_id, model)
            compiled = update(legacy_url, legacy_pack, plan, settings)
            assert encode(compiled["body"]) == encode(expected)
            compile_contract(user_id, legacy_brief, plan, settings, old, expected)
        disabled = update(endpoint, enabled, plan, {**settings, "styleRefs": False})
        assert disabled["body"]["settings"].pop("styleRefs") is False
        assert encode(disabled["body"]) == encode(expected)
        compile_contract(user_id, brief, plan, {**settings, "styleRefs": False}, saved["profile"], expected)

        plan["clips"][0]["references"] = [
            *[ref(f"kit_image_{i}", "image", "composition", "Match framing") for i in range(7 if is20 else 28)], identity,
            *([] if is20 else [ref(f"kit_video_{i}", "video", "motion", "Match motion") for i in range(10)]),
        ]
        packed = update(endpoint, disabled, plan, settings)["body"]["clips"][0]["attachments"]
        assert packed[0]["assetId"] == still_id
        assert [a["assetId"] for a in packed if a["assetId"] in {*kit["images"], kit["motion"]}] == kit["images"][:1]
        assert sum(a["modality"] == "image" for a in packed) == (9 if is20 else 30)
        assert sum(a["modality"] == "video" for a in packed) == (0 if is20 else 10)

    print("PASS: Style Kit selections, full-resolution owned media, immutable saves, model ordering and limits, and byte-identical compatibility")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as scratch, server("mock"):
        main(Path(scratch))

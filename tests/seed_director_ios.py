"""Seed the provider-free iPhone simulator's account and real backend records."""
from pathlib import Path
import sys
import tempfile

import director
from director import API, Client, fixtures


director.BASE = sys.argv[1]
client = Client()
client.request("/api/auth/signup", {"email": "studio-ios@example.test", "password": "fixture-password"})
with tempfile.TemporaryDirectory() as temporary:
    image, _, _ = fixtures(Path(temporary))
    asset = client.upload(image)

style = client.request(f"{API}/styles", {"title": "iPhone fixture style", "assetId": asset["id"]})
client.job(style["job"])
path = f"{API}/styles/{style['styleId']}"
draft = client.request(path)["versions"][0]
version = client.request(path + "/save", {"previousId": draft["id"], "guide": draft["profile"]["guide"]})["version"]
project = client.request(f"{API}/projects", {
    "title": "iPhone fixture project", "styleVersionId": version["id"],
    "brief": "A courier pauses in the doorway before stepping into the light.",
    "duration": 5, "aspect": "9:16", "model": "seedance-2.0",
})
client.job(project["job"])

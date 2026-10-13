"""Download the site's photos and save web-sized JPEGs into img/.

Usage: python3 fetch_images.py   (needs Pillow: pip install pillow)

The photos were generated for this site with Higgsfield (Nano Banana). People shown are
AI-generated models, not customers, and the page labels them "Model for illustration only."
"""
import io
import pathlib
import urllib.request

from PIL import Image

BASE = "https://d8j0ntlcm91z4.cloudfront.net/user_3HCDkKwaqEhAIKEp2Sa0KJ9KM0U/hf_20261013_"
IMAGES = {
    "hero-walk": "004406_45cba9a7-7f12-4b88-a874-d34f8ca7e2d8",
    "kitchen": "004406_f3934914-adfd-4685-9bdc-ff6eefba14c0",
    "telehealth": "004406_0497c547-2042-45d1-b621-d213857893a0",
    "pen-blue": "004406_6536f7a2-b5fd-40ab-8d51-50da3f017531",
    "pen-violet": "004406_3e930e6b-ec44-4d10-9171-788f469a69fc",
    "vial": "004406_b5e4ddd8-17d2-4f1e-8d2a-e216f8ed400b",
    "serum-blue": "004406_680dc263-3ac9-4ac7-9cdc-dd337bc6a41b",
    "serum-pink": "004406_b4a2e272-95a2-4698-ba1e-777d4f5c2b1e",
    "collagen": "004406_86117d30-a6bd-427c-bc00-4a51eb2fee9d",
    "skin": "004406_f5f5aa8b-a8e6-4ac5-bb83-94469b4d0534",
    "athlete": "004405_d708eed5-0d10-493f-89d5-9829f4e99bd1",
    "delivery": "004406_2ea3edc4-790a-4380-ad0e-ca32fa256579",
}
LONG_EDGE = 1400

out = pathlib.Path(__file__).parent / "img"
out.mkdir(exist_ok=True)
for name, key in IMAGES.items():
    with urllib.request.urlopen(BASE + key + ".png") as r:
        im = Image.open(io.BytesIO(r.read())).convert("RGB")
    im.thumbnail((LONG_EDGE, LONG_EDGE))
    path = out / f"{name}.jpg"
    im.save(path, "JPEG", quality=80, optimize=True, progressive=True)
    print(f"{path.name}: {im.size[0]}x{im.size[1]}, {path.stat().st_size // 1024} KB")

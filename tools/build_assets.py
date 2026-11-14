"""assets/ 의 원본 이미지를 게임이 불러 쓰는 가벼운 파일(assets/game/)로 만든다.

    python tools/build_assets.py      (Pillow, numpy 필요)

- 건물 외벽 텍스처 10장 -> 512px JPG (wall_01.jpg ...)
- 캐릭터 앞·뒤 모습 -> 배경을 지우고 가장자리 색으로 채운 1024px 아틀라스 (pilot.jpg, 왼쪽 절반이 앞모습)
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets"
OUT = SRC / "game"
OUT.mkdir(exist_ok=True)

# ---------- 건물 외벽 ----------
for i, f in enumerate(sorted((SRC / "texture_building").glob("*.png")), 1):
    im = Image.open(f).convert("RGB").resize((512, 512), Image.LANCZOS)
    im.save(OUT / f"wall_{i:02d}.jpg", quality=88)
    print("wall", i, f.name)

# ---------- 캐릭터 ----------
# js/pilot.js 의 PILOT_IMG 값과 맞아야 한다 (원본 1536x1024 기준 픽셀)
CX_FRONT, CX_BACK, HALF = 408, 1096, 205      # 앞·뒤 모습의 중심 x, 잘라낼 반폭
im = np.asarray(Image.open(SRC / "character" / "red-haired-boy-battle-royale.png").convert("RGB")).astype(np.float32)
bg = im[5:40, 5:40].reshape(-1, 3).mean(0)
known = np.abs(im - bg).sum(2) > 40            # 배경(회색)이 아닌 곳 = 인물
known[965:, :] = False                         # 발밑 그림자는 버린다
# 윤곽선의 픽셀은 배경과 섞여 밝으므로 3픽셀 깎아 낸 뒤에 번지게 한다
for _ in range(3):
    known = known & np.roll(known, 1, 0) & np.roll(known, -1, 0) & np.roll(known, 1, 1) & np.roll(known, -1, 1)
col = im.copy()
col[~known] = 0
# 인물 색을 바깥으로 번지게 해서, 3D 모델이 윤곽보다 조금 커도 배경색이 묻어나지 않게 한다
for _ in range(140):
    acc = np.zeros_like(col)
    cnt = np.zeros(known.shape, np.float32)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        k = np.roll(known, (dy, dx), (0, 1))
        acc += np.roll(col, (dy, dx), (0, 1)) * k[..., None]
        cnt += k
    new = ~known & (cnt > 0)
    if not new.any():
        break
    col[new] = acc[new] / cnt[new][:, None]
    known = known | new
col[~known] = (60, 60, 64)
full = Image.fromarray(col.clip(0, 255).astype(np.uint8))
atlas = Image.new("RGB", (1024, 1024))
for k, cx in enumerate((CX_FRONT, CX_BACK)):
    part = full.crop((cx - HALF, 0, cx + HALF, 1024)).resize((512, 1024), Image.LANCZOS)
    atlas.paste(part, (k * 512, 0))
atlas.save(OUT / "pilot.jpg", quality=92)
print("pilot atlas", atlas.size)

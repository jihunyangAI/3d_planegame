"""OSM 원본(data/osm_raw.json, data/osm_extra.json)을 3D 지도용 압축 데이터(map_data.js)로 변환한다.

좌표계: 홍대입구역 9번출구를 원점으로 하는 미터 단위 평면 (x=동쪽, y=북쪽).
"""
import json
import math
import random
import sys
import zlib
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LAT0, LON0 = 37.5560397, 126.9229218  # 홍대입구역 9번출구 (OSM node 3404932011)
RADIUS = 1000.0
LEVEL_H = 3.2

M_LAT = 111_132.0
M_LON = 111_320.0 * math.cos(math.radians(LAT0))


def xy(p):
    return ((p["lon"] - LON0) * M_LON, (p["lat"] - LAT0) * M_LAT)


def num(s):
    if s is None:
        return None
    try:
        return float(str(s).replace("m", "").replace(",", ".").split(";")[0].strip())
    except ValueError:
        return None


def area_centroid(pts):
    a = cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    a *= 0.5
    if abs(a) < 1e-6:
        return 0.0, pts[0]
    return abs(a), (cx / (6 * a), cy / (6 * a))


def ring(geom):
    pts = [xy(p) for p in geom]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def flat(pts):
    out = []
    for x, y in pts:
        out += [round(x, 1), round(y, 1)]
    return out


def in_poly(x, y, pts):
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def est_height(tags, eid, area):
    """높이 태그가 없을 때의 추정치. (높이, 추정여부)"""
    h = num(tags.get("height"))
    if h and h > 0:
        return h, 0
    lv = num(tags.get("building:levels"))
    if lv and lv > 0:
        return lv * LEVEL_H + 1.0, 0
    kind = tags.get("building", "yes")
    r = zlib.crc32(str(eid).encode()) % 1000 / 1000.0
    if kind in ("apartments",):
        lv = 10 + int(r * 8)
    elif kind in ("house", "detached", "residential", "hut", "shed", "garage", "roof"):
        lv = 1 + int(r * 3)
    elif area > 1500:
        lv = 5 + int(r * 6)
    elif area > 400:
        lv = 4 + int(r * 4)
    else:
        lv = 2 + int(r * 4)
    return lv * LEVEL_H, 1


# 건물 용도: 0 미상 1 주거(주택/빌라) 2 아파트 3 상업/업무 4 공공/학교
KIND = {
    "house": 1, "detached": 1, "residential": 1, "dormitory": 1,
    "apartments": 2,
    "commercial": 3, "retail": 3, "office": 3, "hotel": 3, "gusethouse": 3,
    "university": 4, "school": 4, "church": 4, "kindergarten": 4, "public": 4, "temple": 4,
}


def clip_line(pts, R=RADIUS):
    """폴리라인을 반경 R 원으로 잘라 조각 목록을 돌려준다."""
    out, cur = [], []
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        dx, dy = x1 - x0, y1 - y0
        a = dx * dx + dy * dy
        if a == 0:
            continue
        b = 2 * (x0 * dx + y0 * dy)
        c = x0 * x0 + y0 * y0 - R * R
        disc = b * b - 4 * a * c
        if disc <= 0:
            t0, t1 = (0.0, 1.0) if c <= 0 else (1.0, 0.0)
        else:
            s = math.sqrt(disc)
            t0, t1 = max(0.0, (-b - s) / (2 * a)), min(1.0, (-b + s) / (2 * a))
        if t0 >= t1:
            if cur:
                out.append(cur)
                cur = []
            continue
        p0 = (x0 + dx * t0, y0 + dy * t0)
        p1 = (x0 + dx * t1, y0 + dy * t1)
        if not cur or t0 > 0:
            if cur:
                out.append(cur)
            cur = [p0]
        cur.append(p1)
        if t1 < 1:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [s for s in out if len(s) >= 2]


ROAD = {  # class -> (그룹, 기본 폭 m)
    "motorway": (0, 24), "trunk": (0, 24), "primary": (0, 22), "primary_link": (0, 9),
    "secondary": (1, 15), "secondary_link": (1, 8), "busway": (1, 7),
    "tertiary": (2, 10), "tertiary_link": (2, 7),
    "residential": (3, 6), "unclassified": (3, 6), "living_street": (3, 5),
    "service": (4, 3.5), "track": (4, 3),
    "pedestrian": (5, 6),
    "footway": (6, 2), "path": (6, 2), "steps": (6, 2), "cycleway": (6, 2),
}

CELL = 40.0


class Grid:
    """건물 폴리곤 / 도로 선분의 간단한 격자 색인."""

    def __init__(self):
        self.polys = defaultdict(list)
        self.segs = defaultdict(list)

    @staticmethod
    def _cells(x0, y0, x1, y1):
        for i in range(int(math.floor(x0 / CELL)), int(math.floor(x1 / CELL)) + 1):
            for j in range(int(math.floor(y0 / CELL)), int(math.floor(y1 / CELL)) + 1):
                yield i, j

    def add_poly(self, pts):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        for c in self._cells(min(xs), min(ys), max(xs), max(ys)):
            self.polys[c].append(pts)

    def add_seg(self, p0, p1, hw):
        m = hw + 6
        for c in self._cells(min(p0[0], p1[0]) - m, min(p0[1], p1[1]) - m, max(p0[0], p1[0]) + m, max(p0[1], p1[1]) + m):
            self.segs[c].append((p0, p1, hw))

    def in_building(self, x, y):
        c = (int(math.floor(x / CELL)), int(math.floor(y / CELL)))
        return any(in_poly(x, y, p) for p in self.polys.get(c, ()))

    def on_road(self, x, y, margin):
        c = (int(math.floor(x / CELL)), int(math.floor(y / CELL)))
        for (x0, y0), (x1, y1), hw in self.segs.get(c, ()):
            dx, dy = x1 - x0, y1 - y0
            l2 = dx * dx + dy * dy
            t = 0 if l2 == 0 else max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / l2))
            if math.hypot(x - x0 - dx * t, y - y0 - dy * t) < hw + margin:
                return True
        return False


def merge_paths(segs):
    """같은 이름·같은 방향의 도로 조각을 이어 붙여 긴 주행 경로를 만든다."""
    key = lambda p: (round(p[0], 2), round(p[1], 2))
    starts = defaultdict(list)
    for i, s in enumerate(segs):
        starts[key(s["pts"][0])].append(i)
    ends = defaultdict(list)
    for i, s in enumerate(segs):
        ends[key(s["pts"][-1])].append(i)
    used = [False] * len(segs)
    out = []
    for i, s in enumerate(segs):
        if used[i]:
            continue
        used[i] = True
        pts = list(s["pts"])
        ok = lambda j: not used[j] and segs[j]["name"] == s["name"] and segs[j]["oneway"] == s["oneway"]
        while True:  # 앞으로 연장
            k = key(pts[-1])
            nxt = next((j for j in starts[k] if ok(j)), None)
            if nxt is not None:
                used[nxt] = True
                pts += segs[nxt]["pts"][1:]
                continue
            if not s["oneway"]:
                nxt = next((j for j in ends[k] if ok(j)), None)
                if nxt is not None:
                    used[nxt] = True
                    pts += segs[nxt]["pts"][-2::-1]
                    continue
            break
        while True:  # 뒤로 연장
            k = key(pts[0])
            prv = next((j for j in ends[k] if ok(j)), None)
            if prv is not None:
                used[prv] = True
                pts = segs[prv]["pts"][:-1] + pts
                continue
            if not s["oneway"]:
                prv = next((j for j in starts[k] if ok(j)), None)
                if prv is not None:
                    used[prv] = True
                    pts = segs[prv]["pts"][:0:-1] + pts
                    continue
            break
        length = sum(math.hypot(pts[a + 1][0] - pts[a][0], pts[a + 1][1] - pts[a][1]) for a in range(len(pts) - 1))
        if length >= 120:
            out.append([s["w"], 1 if s["oneway"] else 0, s["lanes"], flat(pts)])
    return out


def main():
    raw = json.loads((ROOT / "data" / "osm_raw.json").read_text(encoding="utf-8"))
    extra_path = ROOT / "data" / "osm_extra.json"
    extra = json.loads(extra_path.read_text(encoding="utf-8")) if extra_path.exists() else {"elements": []}

    buildings, roads, greens, waters, rails, exits, stations = [], [], [], [], [], [], []
    grid = Grid()
    green_polys = []          # (kind, pts)
    car_segs = []
    node_dir = {}             # (lat, lon) -> (dx, dy, 폭)  횡단보도 방향 계산용

    def add_building(tags, eid, outer, holes):
        if len(outer) < 3:
            return
        area, c = area_centroid(outer)
        if area < 4 or math.hypot(*c) > RADIUS:
            return
        h, est = est_height(tags, eid, area)
        buildings.append([
            round(h, 1), est, tags.get("name", ""), flat(outer),
            [flat(hh) for hh in holes if len(hh) >= 3],
            KIND.get(tags.get("building", "yes"), 0),
        ])
        grid.add_poly(outer)

    for e in raw["elements"]:
        t = e.get("tags", {})
        if e["type"] == "node":
            x, y = xy(e)
            if math.hypot(x, y) > RADIUS:
                continue
            if t.get("railway") == "subway_entrance":
                exits.append([round(x, 1), round(y, 1), t.get("ref", ""), t.get("description", t.get("name", ""))])
            elif t.get("railway") == "station":
                stations.append([round(x, 1), round(y, 1), t.get("name", "")])
            continue

        if e["type"] == "relation":
            if "building" not in t:
                continue
            outers = [ring(m["geometry"]) for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
            inners = [ring(m["geometry"]) for m in e.get("members", []) if m.get("role") == "inner" and m.get("geometry")]
            for i, o in enumerate(outers):
                add_building(t, f"r{e['id']}_{i}", o, inners if i == 0 else [])
            continue

        geom = e.get("geometry")
        if not geom:
            continue
        if "building" in t:
            add_building(t, e["id"], ring(geom), [])
        elif "highway" in t:
            hw = t["highway"]
            if hw not in ROAD:
                continue
            if t.get("tunnel") in ("yes", "building_passage") or t.get("indoor") == "yes" or (num(t.get("layer")) or 0) < 0:
                continue
            grp, w = ROAD[hw]
            lanes = num(t.get("lanes"))
            oneway = t.get("oneway") == "yes"
            if lanes and grp <= 3:
                w = max(w if grp >= 3 else 0, lanes * 3.3)
            if not lanes:
                lanes = max(1, round(w / 3.3)) if grp <= 2 else (1 if oneway else 2)
            pts_all = [xy(p) for p in geom]
            if grp <= 4:
                for i, p in enumerate(geom):
                    a, b = pts_all[max(0, i - 1)], pts_all[min(len(geom) - 1, i + 1)]
                    d = math.hypot(b[0] - a[0], b[1] - a[1])
                    k = (p["lat"], p["lon"])
                    if d > 0 and (k not in node_dir or node_dir[k][2] < w):
                        node_dir[k] = ((b[0] - a[0]) / d, (b[1] - a[1]) / d, w)
            for seg in clip_line(pts_all):
                roads.append([grp, round(w, 1), t.get("name", ""), flat(seg), 1 if oneway else 0, int(lanes)])
                for a, b in zip(seg, seg[1:]):
                    grid.add_seg(a, b, w / 2)
                if grp <= 2 and not hw.endswith("_link"):
                    car_segs.append({"pts": seg, "name": t.get("name", ""), "oneway": oneway, "w": round(w, 1), "lanes": int(lanes)})
        elif "railway" in t:
            if t.get("tunnel") == "yes" or t["railway"] == "subway" or (num(t.get("layer")) or 0) < 0:
                continue
            for seg in clip_line([xy(p) for p in geom]):
                rails.append(flat(seg))
        else:
            pts = ring(geom)
            if len(pts) < 3:
                continue
            _, c = area_centroid(pts)
            if math.hypot(*c) > RADIUS:
                continue
            if t.get("natural") == "water":
                waters.append(flat(pts))
            else:
                # 녹지 종류: 0 공원/잔디 1 숲 2 운동장 3 놀이터
                gk = 1 if t.get("natural") == "wood" or t.get("landuse") == "forest" else \
                     2 if t.get("leisure") == "pitch" else 3 if t.get("leisure") == "playground" else 0
                greens.append([t.get("name", ""), flat(pts), gk])
                green_polys.append((gk, t.get("leisure"), pts))

    # ---------- 나무 ----------
    rnd = random.Random(42)
    trees = []

    def try_tree(x, y, margin=0.6, size=None):
        if math.hypot(x, y) > RADIUS - 3 or grid.in_building(x, y) or grid.on_road(x, y, margin):
            return
        trees.append([round(x, 1), round(y, 1), round(size or rnd.uniform(0.75, 1.25), 2)])

    for e in extra["elements"]:
        t = e.get("tags", {})
        if e["type"] == "node" and t.get("natural") == "tree":
            x, y = xy(e)
            if math.hypot(x, y) < RADIUS and not grid.in_building(x, y):
                trees.append([round(x, 1), round(y, 1), round(rnd.uniform(0.9, 1.3), 2)])
        elif e["type"] == "way" and t.get("natural") == "tree_row" and e.get("geometry"):
            pts = [xy(p) for p in e["geometry"]]
            for a, b in zip(pts, pts[1:]):
                d = math.hypot(b[0] - a[0], b[1] - a[1])
                for k in range(int(d // 8) + 1):
                    s = k * 8 / d if d else 0
                    try_tree(a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, -99)
    n_osm = len(trees)
    for gk, leisure, pts in green_polys:  # 공원·숲 안에 흩뿌리기
        if gk >= 2:
            continue
        area, _ = area_centroid(pts)
        dens = 30 if gk == 1 else (75 if leisure == "park" else 160)
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        for _ in range(int(area / dens * 3)):
            x, y = rnd.uniform(min(xs), max(xs)), rnd.uniform(min(ys), max(ys))
            if in_poly(x, y, pts) and rnd.random() < 0.6:
                try_tree(x, y, 0.5, rnd.uniform(0.9, 1.5) if gk == 1 else None)
    n_park = len(trees) - n_osm
    for grp, w, _, f, _, _ in roads:  # 큰길 가로수
        if grp > 2:
            continue
        carry = rnd.uniform(0, 9)
        for i in range(0, len(f) - 2, 2):
            x0, y0, x1, y1 = f[i], f[i + 1], f[i + 2], f[i + 3]
            d = math.hypot(x1 - x0, y1 - y0)
            if d < 0.5:
                continue
            nx, ny = -(y1 - y0) / d, (x1 - x0) / d
            s = carry
            while s < d:
                for side in (1, -1):
                    off = (w / 2 + 2.4) * side
                    try_tree(x0 + (x1 - x0) * s / d + nx * off, y0 + (y1 - y0) * s / d + ny * off, 1.6, rnd.uniform(0.7, 1.0))
                s += 10 + rnd.uniform(-1, 1)
            carry = s - d

    # ---------- 횡단보도 ----------
    crossings = []
    for e in extra["elements"]:
        if e["type"] == "node" and e.get("tags", {}).get("highway") == "crossing":
            d = node_dir.get((e["lat"], e["lon"]))
            x, y = xy(e)
            if d and math.hypot(x, y) < RADIUS - 10:
                crossings.append([round(x, 1), round(y, 1), round(d[0], 3), round(d[1], 3), round(d[2], 1)])

    car_paths = merge_paths(car_segs)

    data = {
        "center": {"lat": LAT0, "lon": LON0, "name": "홍대입구역 9번출구"},
        "radius": RADIUS,
        "buildings": buildings, "roads": roads, "greens": greens,
        "waters": waters, "rails": rails, "exits": exits, "stations": stations,
        "trees": trees, "crossings": crossings, "carPaths": car_paths,
    }
    out = ROOT / "map_data.js"
    out.write_text("window.MAP_DATA=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")
    msg = (f"buildings={len(buildings)} (est_height={sum(b[1] for b in buildings)}) roads={len(roads)} greens={len(greens)} "
           f"trees={len(trees)} (osm={n_osm}, park={n_park}, street={len(trees) - n_osm - n_park}) "
           f"crossings={len(crossings)} carPaths={len(car_paths)} "
           f"carPathKm={sum(sum(math.hypot(p[3][i + 2] - p[3][i], p[3][i + 3] - p[3][i + 1]) for i in range(0, len(p[3]) - 2, 2)) for p in car_paths) / 1000:.1f}\n"
           f"{out.name}: {out.stat().st_size / 1024:.0f} KB\n")
    sys.stdout.buffer.write(msg.encode("utf-8"))


if __name__ == "__main__":
    main()

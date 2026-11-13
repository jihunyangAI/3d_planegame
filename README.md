# hongdae3d_map

홍대입구역 9번출구를 중심으로 반경 1km를 브라우저에서 돌려 볼 수 있는 3D 지도입니다.

## 보기

`index.html`을 브라우저로 열면 됩니다. three.js를 CDN에서 불러오므로 인터넷 연결이 필요합니다.

- 왼쪽 드래그 회전 · 오른쪽 드래그 이동 · 휠 확대/축소
- 건물에 마우스를 올리면 이름·높이·면적 표시
- 시간 슬라이더(5~23시)로 낮·노을·밤 전환
- `H` 키로 안내판 숨기기

## 구성

| 파일 | 내용 |
| --- | --- |
| `index.html` | 3D 지도 페이지 (three.js) |
| `map_data.js` | 지도 데이터 (`build_map.py`가 생성) |
| `build_map.py` | OSM 원본을 미터 좌표의 압축 데이터로 변환 |
| `data/` | Overpass API에서 받은 OSM 원본 |

데이터를 다시 만들려면:

```
python build_map.py
```

중심이나 반경을 바꾸려면 `build_map.py`의 `LAT0`, `LON0`, `RADIUS`를 고치고 `data/`의 OSM 원본을 같은 범위로 새로 받아야 합니다.

## 실제와 다른 점

- 건물 윤곽과 높이만 OSM 데이터입니다. 높이·층수 정보가 없는 건물(약 73%)은 종류와 면적으로 추정했습니다.
- 창문, 간판, 벽 색, 옥상 구조물, 차량, 대부분의 나무는 규칙으로 자동 생성한 것입니다.
- 지형 고저차는 반영하지 않아 전부 평지입니다.

## 데이터 출처

지도 데이터 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자, [ODbL](https://opendatacommons.org/licenses/odbl/) 라이선스.

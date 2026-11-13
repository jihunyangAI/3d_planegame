// 게임 조정값. 난이도·조작감은 여기 숫자만 바꾸면 된다.
export const CFG = {
  timeOfDay: 15,              // 시각 (5~23)
  drone: {
    radius: 1.6,              // 충돌 반지름 (m)
    speed: 18,                // 기본 수평 속도 (m/s)
    boostSpeed: 32,           // 부스트 수평 속도
    vSpeed: 10,               // 상승/하강 속도
    accel: 3.5,               // 가감속 빠르기 (클수록 즉각 반응)
    turnRate: 1.9,            // 좌우 키 선회 속도 (rad/s)
    turnAccel: 7,             // 선회가 붙고 풀리는 빠르기
    bank: 0.2,                // 선회할 때 기체가 기우는 정도
    minAlt: 1.8,              // 최저 고도
    ceiling: 45,              // 최고 고도
    boostMax: 100,
    boostDrain: 28,           // 초당 소모
    boostRegen: 16,           // 초당 충전
    boostRegenDelay: 1.0,     // 부스트를 멈춘 뒤 충전이 시작되기까지 (초)
    boostRelock: 20,          // 바닥난 뒤 다시 쓰려면 필요한 양
  },
  laser: {
    rate: 8,                  // 초당 발사 수
    speed: 300,               // 광선탄 속도 (m/s)
    range: 500,               // 사거리 (m)
    length: 9,                // 광선탄 길이 (m)
    damage: 12,
    heatPerShot: 5,           // 한 발당 과열 (100 이면 과열)
    coolRate: 32,             // 초당 냉각
    coolDelay: 0.3,           // 사격을 멈춘 뒤 식기 시작하기까지 (초)
    overheatUnlock: 30,       // 과열 뒤 이만큼 식어야 다시 쏠 수 있다
    assistDeg: 2.2,           // 조준 보정 각도 (0 이면 끔)
    color: 0x35d6ff,
  },
  player: {
    hp: 100,
    shield: 50,
    shieldDelay: 5,           // 맞은 뒤 실드가 다시 차기 시작하기까지 (초, 적도 같음)
    shieldRegen: 12,          // 초당 실드 회복
    hitRadius: 1.9,           // 피격 판정 반지름 (m)
    respawn: 3,               // 격추된 뒤 다시 출격하기까지 (초)
    spawnProtect: 2.5,        // 출격 직후 무적 시간 (초)
  },
  bot: {                      // 적 (쉬움 난이도)
    count: 7,
    hp: 60,
    shield: 30,
    hitRadius: 2.2,
    speedScale: 0.8,          // 플레이어 대비 속도
    turnRate: 2.2,            // 선회 속도 (rad/s)
    sight: 190,               // 시야 거리 (m)
    huntChance: 0.6,          // 순찰할 때 플레이어 근처로 향할 확률
    reaction: 1.0,            // 상대를 본 뒤 알아채기까지 (초)
    maxOnPlayer: 2,           // 플레이어를 동시에 노릴 수 있는 적의 수
    aimTime: 0.7,             // 쏘기 전 조준선을 보여 주는 시간 (초)
    burst: 4,                 // 한 번에 쏘는 발 수
    burstRate: 4,             // 점사 속도 (발/초)
    cooldown: [1.4, 2.6],     // 점사 사이 쉬는 시간 (초)
    damage: 8,
    spread: 2.0,              // 탄 퍼짐 (클수록 덜 맞는다. 2.0 이면 가까이서 약 25% 명중)
    lead: 0.6,                // 이동 예측 정도 (1 이면 정확히 예측)
    fireRange: 170,           // 사격 거리 (m)
    near: 35, far: 80,        // 교전 때 유지하려는 거리 (m)
    fleeBelow: 0.35,          // 체력+실드가 이 비율 아래면 달아난다
    fleeTime: 7,
    respawn: 5,               // 격추된 뒤 다시 나타나기까지 (초)
    spawnAway: 160,           // 플레이어에게서 이만큼 떨어진 곳에 나타난다 (m)
  },
  camera: { dist: 9, height: 2.6, fov: 62, zoomFov: 30, boostFov: 8 },
  mouse: { sens: 0.0022, pitchMax: 1.2 },
  spawnAlt: 20,
};

// 게임 조정값. 난이도·조작감은 여기 숫자만 바꾸면 된다.
export const CFG = {
  difficulty: 'easy',         // applyDifficulty() 로 바꾼다
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
    ceiling: 90,           // 최고 고도
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
    spawnProtect: 3,          // 경기 시작 직후 무적 시간 (초)
  },
  bot: {                      // 적 (쉬움 난이도)
    count: 7,
    hp: 60,
    shield: 30,
    hitRadius: 2.2,
    speedScale: 0.8,          // 플레이어 대비 속도
    turnRate: 2.2,            // 선회 속도 (rad/s)
    sight: 190,               // 시야 거리 (m)
    huntChance: 0.3,          // 순찰할 때 플레이어 근처로 향할 확률
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
  },
  zone: {                     // 자기장 (쉬움: 천천히 줄고 피해가 약하다). 한 판 약 5분.
    phases: [                 // wait 초 기다린 뒤 shrink 초 동안 radius(m) 까지 줄어든다. dps: 밖에 있을 때 초당 피해
      { wait: 45, shrink: 30, radius: 600, dps: 2 },
      { wait: 40, shrink: 30, radius: 350, dps: 4 },
      { wait: 35, shrink: 25, radius: 170, dps: 7 },
      { wait: 30, shrink: 25, radius: 60, dps: 12 },
      { wait: 20, shrink: 30, radius: 0, dps: 20 },
    ],
  },
  items: {
    repair: 50,               // 수리 키트 회복량
    twinTime: 30,             // 쌍발 레이저 지속 (초)
    boostTime: 30,            // 부스트 강화(게이지가 줄지 않음) 지속 (초)
    respawn: 40,              // 먹힌 자리에 다시 생기기까지 (초)
    pickup: 5,                // 줍는 거리 (m)
    alt: 7,                   // 떠 있는 높이 (m)
    parks: 8,                 // 아이템을 놓을 공원 수 (넓은 순)
  },
  match: { spawnSpread: 230 },  // 시작할 때 참가자 사이 최소 거리 (m)
  camera: { dist: 9, height: 2.6, fov: 62, zoomFov: 30, boostFov: 8 },
  mouse: { sens: 0.0022, pitchMax: 1.2 },
  spawnAlt: 20,
};

// 난이도: 쉬움이 기본값(위의 bot 설정)이고, 보통·어려움은 아래 값으로 덮어쓴다.
export const DIFFS = {
  easy: { label: '쉬움', bot: {}, assistDeg: 2.2, zoneDps: 1 },
  normal: { label: '보통', assistDeg: 1.4, zoneDps: 1.5,
    bot: { hp: 80, shield: 40, speedScale: 0.9, sight: 230, reaction: 0.6, maxOnPlayer: 3, aimTime: 0.5, burst: 5, cooldown: [1.0, 2.0], damage: 10, spread: 1.5, lead: 0.8 } },
  hard: { label: '어려움', assistDeg: 0.7, zoneDps: 2,
    bot: { hp: 100, shield: 50, speedScale: 1.0, sight: 270, reaction: 0.3, maxOnPlayer: 7, aimTime: 0.35, burst: 6, burstRate: 5, cooldown: [0.7, 1.5], damage: 12, spread: 1.1, lead: 1.0 } },
};
const BASE_BOT = { ...CFG.bot };
export function applyDifficulty(name) {
  if (!DIFFS[name]) name = 'easy';
  CFG.difficulty = name;
  Object.assign(CFG.bot, BASE_BOT, DIFFS[name].bot);
  CFG.laser.assistDeg = DIFFS[name].assistDeg;      // 조준 보정도 난이도에 따라 줄어든다
  CFG.zone.dpsScale = DIFFS[name].zoneDps;          // 자기장 피해 배율
}

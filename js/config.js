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
  camera: { dist: 9, height: 2.6, fov: 62, zoomFov: 30, boostFov: 8 },
  mouse: { sens: 0.0022, pitchMax: 1.2 },
  spawnAlt: 20,
};

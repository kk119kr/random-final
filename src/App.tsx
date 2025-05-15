import React, { useState, useEffect, useRef } from "react";
import { database } from "./firebase"; // 기존 파일 그대로 유지
import {
  ref,
  onValue,
  set,
  push,
  remove,
  off,
  update,
} from "firebase/database";
import { QRCodeSVG } from "qrcode.react";
import "./styles.css";

// QRCode 컴포넌트 에러 방지를 위한 래퍼 컴포넌트
const SafeQRCode = ({ value, size }: { value: string; size: number }) => {
  try {
    // QRCodeSVG 컴포넌트를 사용 (QRCode가 아님)
    return <QRCodeSVG value={value} size={size} />;
  } catch (error) {
    console.error("QRCode 컴포넌트 로딩 실패:", error);
    // QRCode 컴포넌트를 불러올 수 없을 때 대체 UI
    return (
      <div
        style={{
          width: size,
          height: size,
          backgroundColor: "#fff",
          color: "#000",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "12px",
          padding: "10px",
          textAlign: "center",
        }}
      >
        <div>QR 코드를 표시할 수 없습니다</div>
        <div style={{ marginTop: "10px", fontSize: "10px" }}>
          초대 코드: {value.split("session=")[1] || value}
        </div>
      </div>
    );
  }
};

type LightDirection = "none" | "left" | "right" | "both";
type GameMode =
  | "home"
  | "timing"
  | "light"
  | "result"
  | "join"
  | "lobby"
  | "create";
type PlayerScore = { round: number; points: number };

// 세션 데이터 타입
interface Session {
  id: string;
  adminId: string;
  players: { [key: string]: Player };
  gameState: GameState;
  createdAt: number;
}

// 플레이어 데이터 타입
interface Player {
  id: string;
  name: string;
  number: number;
}
// 플레이어 점수 타입 (랭킹용)
interface PlayerWithScore {
  id: string;
  name: string;
  number: number;
  totalScore: number;
}

// 게임 상태 타입
interface GameState {
  mode: GameMode;
  activeLightPlayerId: string | null;
  isGameActive: boolean;
  selectedPlayerId: string | null;
  timingScores: { [playerId: string]: PlayerScore[] };
  clickOrder: number;
  round: number;
  buttonColor: string;
  lastUpdateTime: number;
}

export default function App(): JSX.Element {
  // 게임 상태 관리
  const [gameMode, setGameMode] = useState<GameMode>("home");
  const [isGameActive, setIsGameActive] = useState<boolean>(false);
  const [buttonColor, setButtonColor] = useState<string>("#007bff");
  const [currentRound, setCurrentRound] = useState<number>(1);
  const [currentScore, setCurrentScore] = useState<number | null>(null);
  const [scores, setScores] = useState<PlayerScore[]>([]);
  const [clickOrder, setClickOrder] = useState<number>(0);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerRankings, setPlayerRankings] = useState<PlayerWithScore[]>([]);

  // 빛 이동 게임 상태
  const [isLightActive, setIsLightActive] = useState<boolean>(false);
  const [isLightGameActive, setIsLightGameActive] = useState<boolean>(false);
  const [isSelected, setIsSelected] = useState<boolean>(false);

  // 세션 및 네트워킹 상태
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerNumber, setPlayerNumber] = useState<number>(0);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [sessionCode, setSessionCode] = useState<string>("");
  const [playerName, setPlayerName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [joinUrl, setJoinUrl] = useState<string>("");

  // 타이머 및 애니메이션 ref
  const timerRef = useRef<number | null>(null);
  const lightTimerRef = useRef<number | null>(null);

  // 세션 생성 함수
  const createSession = () => {
    // 이름 검증
    if (!playerName.trim()) {
      setPlayerName("방장");
    }

    // 세션 ID 생성 (4자리 숫자)
    const newSessionId = Math.floor(1000 + Math.random() * 9000).toString();

    // 플레이어 ID 생성
    const newPlayerId = push(ref(database, "temp")).key;

    if (!newPlayerId) {
      setErrorMessage("세션 생성에 실패했습니다.");
      return;
    }

    // 나를 첫 번째 플레이어로 등록
    const newPlayer = {
      id: newPlayerId,
      name: playerName.trim() || "방장",
      number: 1,
    };

    // 게임 초기 상태 생성
    const initialGameState: GameState = {
      mode: "lobby",
      activeLightPlayerId: null,
      isGameActive: false,
      selectedPlayerId: null,
      timingScores: {},
      clickOrder: 0,
      round: 1,
      buttonColor: "#007bff",
      lastUpdateTime: Date.now(),
    };

    // 세션 데이터 생성
    const sessionData: Session = {
      id: newSessionId,
      adminId: newPlayerId,
      players: { [newPlayerId]: newPlayer },
      gameState: initialGameState,
      createdAt: Date.now(),
    };

    // 데이터베이스에 세션 데이터 저장
    set(ref(database, `sessions/${newSessionId}`), sessionData);

    // 세션 URL 생성
    const url = `${window.location.origin}?session=${newSessionId}`;
    setJoinUrl(url);

    // 로컬 상태 업데이트
    setSessionId(newSessionId);
    setPlayerId(newPlayerId);
    setPlayerNumber(1);
    setIsAdmin(true);
    setPlayers([newPlayer]);
    setGameMode("lobby");

    return newSessionId;
  };

  // 세션 참여 함수
  const joinSession = () => {
    if (!sessionCode.trim()) {
      setErrorMessage("세션 코드를 입력해주세요.");
      return;
    }

    if (!playerName.trim()) {
      setErrorMessage("이름을 입력해주세요.");
      return;
    }

    // 세션 존재 여부 확인
    const sessionRef = ref(database, `sessions/${sessionCode}`);
    onValue(
      sessionRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const sessionData = snapshot.val() as Session;

          // 플레이어 ID 생성
          const newPlayerId = push(ref(database, "temp")).key;

          if (!newPlayerId) {
            setErrorMessage("세션 참여에 실패했습니다.");
            return;
          }

          // 플레이어 번호 결정 (현재 인원 + 1)
          const playerCount = Object.keys(sessionData.players || {}).length;
          const newPlayerNumber = playerCount + 1;

          // 새 플레이어 정보
          const newPlayer = {
            id: newPlayerId,
            name: playerName.trim(),
            number: newPlayerNumber,
          };

          // 플레이어 정보 저장
          set(
            ref(database, `sessions/${sessionCode}/players/${newPlayerId}`),
            newPlayer
          );

          // 로컬 상태 업데이트
          setSessionId(sessionCode);
          setPlayerId(newPlayerId);
          setPlayerNumber(newPlayerNumber);
          setIsAdmin(false);
          setGameMode("lobby");

          // 세션 데이터 구독 해제
          off(sessionRef);
        } else {
          setErrorMessage("존재하지 않는 세션 코드입니다.");
          // 세션 데이터 구독 해제
          off(sessionRef);
        }
      },
      { onlyOnce: true }
    );
  };

  // URL에서 세션 코드 추출
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get("session");

    if (sessionParam) {
      setSessionCode(sessionParam);
      setGameMode("join");
    }
  }, []);

  // 세션 데이터 구독
  useEffect(() => {
    if (!sessionId) return;

    const sessionRef = ref(database, `sessions/${sessionId}`);
    onValue(sessionRef, (snapshot) => {
      if (snapshot.exists()) {
        const sessionData = snapshot.val() as Session;

        // 플레이어 목록 업데이트
        const playerList = Object.values(sessionData.players || {}) as Player[];
        setPlayers(playerList.sort((a, b) => a.number - b.number));

        // 게임 상태 동기화
        synchronizeGameState(sessionData.gameState, sessionData.adminId);
      } else {
        // 세션이 삭제된 경우
        setSessionId(null);
        setPlayerId(null);
        setPlayerNumber(0);
        setIsAdmin(false);
        setPlayers([]);
        setGameMode("home");
        alert("세션이 종료되었습니다.");
      }
    });

    return () => {
      // 세션 종료 시 구독 해제
      off(sessionRef);
    };
  }, [sessionId]);

  // 게임 상태 동기화 함수
  const synchronizeGameState = (gameState: GameState, adminId: string) => {
    setGameState(gameState);
    // 방장 여부 업데이트
    setIsAdmin(playerId === adminId);

    // 게임 모드 업데이트
    if (gameState.mode !== "lobby") {
      setGameMode(gameState.mode);
    }

    // 눈치 게임 상태 업데이트
    if (gameState.mode === "timing") {
      setCurrentRound(gameState.round);
      setIsGameActive(gameState.isGameActive);
      setButtonColor(gameState.buttonColor);
      setClickOrder(gameState.clickOrder);

      // 내 점수 가져오기
      if (
        playerId &&
        gameState.timingScores &&
        gameState.timingScores[playerId]
      ) {
        setScores(gameState.timingScores[playerId]);

        // 현재 라운드의 점수 찾기
        const roundScore = gameState.timingScores[playerId].find(
          (score) => score.round === gameState.round
        );

        if (roundScore) {
          setCurrentScore(roundScore.points);
        } else {
          setCurrentScore(null);
        }
      }

      // 방장인 경우 타이머 관리
      if (isAdmin && gameState.isGameActive) {
        startTimingGameTimer();
      }
    }

    // 빛 이동 게임 상태 업데이트
    if (gameState.mode === "light") {
      setIsLightGameActive(gameState.isGameActive);

      // 내 순서인지 확인
      if (playerId && gameState.activeLightPlayerId === playerId) {
        setIsLightActive(true);
      } else {
        setIsLightActive(false);
      }

      // 내가 선택되었는지 확인
      if (playerId && gameState.selectedPlayerId === playerId) {
        setIsSelected(true);
      } else {
        setIsSelected(false);
      }

      // 방장인 경우 빛 이동 관리
      if (isAdmin && gameState.isGameActive && !lightTimerRef.current) {
        startLightGameAnimation();
      }
    }

    // 결과 화면에서 랭킹 표시
    if (gameState.mode === "result") {
      calculateRankings(gameState.timingScores);
    }
  };

  // 빛 방향 표시 로직 개선
  const getLightDirection = (): LightDirection => {
    // gameState가 null인 경우 일찍 반환
    if (!gameState) return "none";

    // 플레이어가 1명이면 방향 없음
    if (players.length <= 1) return "none";

    // 플레이어 수
    const playerCount = players.length;

    // 내 위치 찾기
    const myIndex = players.findIndex((player) => player.id === playerId);
    if (myIndex === -1) return "none";

    // 빛이 있는 플레이어 찾기
    const activePlayerIndex = players.findIndex(
      (player) => player.id === gameState.activeLightPlayerId
    );
    if (activePlayerIndex === -1) return "none";

    // 빛이 나에게 있는 경우 (내가 활성 플레이어) - 버튼에만 빛이 나오므로 방향 없음
    if (activePlayerIndex === myIndex) {
      return "none"; // 버튼에서만 빛이 나오고 양쪽에서 빛이 새지 않음
    }

    // 내가 선택된 플레이어인 경우(당첨자) - 버튼에만 빛이 나오므로 방향 없음
    if (isSelected) {
      return "none"; // 버튼에서만 빛이 나오고 양쪽에서 빛이 새지 않음
    }

    // 2명일 때는 고정된 방향 설정
    if (playerCount === 2) {
      // 방향 수정: 2명일 때 1번 플레이어는 항상 오른쪽에서만 빛을 받음
      if (myIndex === 0 && activePlayerIndex === 1) {
        return "right";
      }

      // 방향 수정: 2명일 때 2번 플레이어는 항상 왼쪽에서만 빛을 받음
      if (myIndex === 1 && activePlayerIndex === 0) {
        return "left";
      }

      return "none";
    }

    // 3명 이상일 때는 직접 인접한 플레이어만 빛 효과를 보임
    // 시계 방향으로 다음 플레이어가 나인지 확인 (내 왼쪽에 있는 플레이어)
    const nextPlayerIndex = (activePlayerIndex + 1) % playerCount;
    if (nextPlayerIndex === myIndex) {
      return "left"; // 내가 다음 플레이어라면 왼쪽에서 빛이 올 것임
    }

    // 반시계 방향으로 이전 플레이어가 나인지 확인 (내 오른쪽에 있는 플레이어)
    const prevPlayerIndex = (activePlayerIndex - 1 + playerCount) % playerCount;
    if (prevPlayerIndex === myIndex) {
      return "right"; // 내가 이전 플레이어라면 오른쪽에서 빛이 올 것임
    }

    // 인접한 플레이어가 아니면 빛이 보이지 않음
    return "none";
  };

  // 여기에 당첨자 관련 변수 추가
  const showWinnerPopup = gameState?.selectedPlayerId && !isLightGameActive;
  const winner = players.find(
    (player) => player.id === gameState?.selectedPlayerId
  );

  // 게임 상태 변경 함수
  const updateGameState = (updates: Partial<GameState>) => {
    if (!sessionId) return;

    const gameStateRef = ref(database, `sessions/${sessionId}/gameState`);

    // 현재 게임 상태 가져오기
    onValue(
      gameStateRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const currentState = snapshot.val() as GameState;
          const newState = {
            ...currentState,
            ...updates,
            lastUpdateTime: Date.now(),
          };

          // 업데이트된 게임 상태 저장
          update(gameStateRef, newState);
        }
      },
      { onlyOnce: true }
    );
  };

  // 점수 추가 함수
  const addScore = (points: number) => {
    if (!sessionId || !playerId) return;

    const newScore = { round: currentRound, points };
    setScores([...scores, newScore]);
    setCurrentScore(points);

    // 데이터베이스에 점수 저장
    const scoreRef = ref(
      database,
      `sessions/${sessionId}/gameState/timingScores/${playerId}`
    );
    onValue(
      scoreRef,
      (snapshot) => {
        let playerScores: PlayerScore[] = [];

        if (snapshot.exists()) {
          playerScores = snapshot.val() as PlayerScore[];
        }

        playerScores.push(newScore);
        set(scoreRef, playerScores);
      },
      { onlyOnce: true }
    );
  };

  // 눈치 게임 시작 함수
  const startGame = () => {
    if (!sessionId || !isAdmin) {
      console.error("게임 시작 실패: 권한 없음");
      return;
    }

    console.log("눈치 게임 시작"); // 디버깅 로그

    // 게임 상태 업데이트
    updateGameState({
      mode: "timing",
      isGameActive: true,
      round: currentRound,
      buttonColor: "#007bff",
      clickOrder: 0,
    });

    // 로컬 상태 업데이트
    setIsGameActive(true);
    setCurrentScore(null);
    setButtonColor("#007bff");
    setClickOrder(0);

    // 타이머 시작
    startTimingGameTimer();
  };

  // 눈치 게임 타이머 시작

  const startTimingGameTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    console.log("타이머 시작"); // 디버깅 로그
    const startTime = Date.now();

    timerRef.current = window.setInterval(() => {
      const elapsedTime = Date.now() - startTime;
      const progress = Math.min(elapsedTime / 4000, 1); // 4초 경과 = 100%

      // 파란색(#007bff)에서 빨간색(#dc3545)로 변화
      const red = Math.floor(0 + (220 - 0) * progress);
      const green = Math.floor(123 * (1 - progress));
      const blue = Math.floor(255 * (1 - progress));

      const newColor = `rgb(${red}, ${green}, ${blue})`;
      // 디버깅을 위해 로그 추가
      console.log(
        `색상 변경: ${newColor}, 진행도: ${Math.round(progress * 100)}%`
      );

      setButtonColor(newColor);

      // 관리자인 경우 색상 상태 업데이트
      if (isAdmin && sessionId) {
        updateGameState({
          buttonColor: newColor,
        });
      }

      // 4초 후 자동 폭발
      if (elapsedTime >= 4000) {
        console.log("타이머 종료 - 폭발!");
        clearInterval(timerRef.current!);
        timerRef.current = null;

        // 게임 종료 및 폭발 효과
        if (isAdmin && sessionId) {
          updateGameState({
            isGameActive: false,
          });
        }

        setIsGameActive(false);

        // 폭발 효과
        document.body.style.backgroundColor = "#dc3545";
        setTimeout(() => {
          document.body.style.backgroundColor = "";
        }, 300);

        // 점수 추가 (폭발 = -5점)
        addScore(-5);
      }
    }, 50);
  };

  // 버튼 클릭 처리 함수
  const handleButtonClick = () => {
    if (!isGameActive || !sessionId || !playerId) return;

    // 클릭 효과 생성
    const buttonElement = document.querySelector(".game-button");
    if (buttonElement) {
      const ripple = document.createElement("span");
      ripple.classList.add("ripple-effect");
      buttonElement.appendChild(ripple);

      // 애니메이션 후 요소 제거
      setTimeout(() => {
        ripple.remove();
      }, 1000);
    }

    // 게임 상태 업데이트
    updateGameState({
      clickOrder: clickOrder + 1,
      isGameActive: false, // 한 명이 클릭하면 게임 종료
    });

    setIsGameActive(false);
    setClickOrder((prev) => prev + 1);

    // 참가자 수에 따라 점수 계산 로직 변경
    let points: number;
    const totalPlayers = players.length;

    // 2명인 경우: 첫 번째 클릭은 -2점, 두 번째 클릭은 +2점
    if (totalPlayers === 2) {
      if (clickOrder === 0) {
        points = -2; // 첫 번째 클릭한 사람은 마이너스
      } else {
        points = 2; // 두 번째 클릭한 사람은 플러스
      }
    }
    // 홀수 인원인 경우 (3, 5, 7명 등)
    else if (totalPlayers % 2 === 1) {
      const middleIndex = Math.floor(totalPlayers / 2);

      if (clickOrder < middleIndex) {
        // 중간보다 먼저 클릭한 사람들은 마이너스 점수
        points = -(middleIndex - clickOrder); // 클릭 순서가 빠를수록 더 큰 마이너스
      } else if (clickOrder === middleIndex) {
        // 중간에 클릭한 사람은 0점
        points = 0;
      } else {
        // 중간보다 늦게 클릭한 사람들은 플러스 점수
        points = clickOrder - middleIndex; // 클릭 순서가 늦을수록 더 큰 플러스
      }
    }
    // 짝수 인원인 경우 (4, 6, 8명 등)
    else {
      const middleIndex = totalPlayers / 2 - 1;

      if (clickOrder <= middleIndex) {
        // 중간 이하에 클릭한 사람들은 마이너스 점수
        points = -(middleIndex - clickOrder + 1); // 클릭 순서가 빠를수록 더 큰 마이너스
      } else {
        // 중간 초과에 클릭한 사람들은 플러스 점수
        points = clickOrder - middleIndex; // 클릭 순서가 늦을수록 더 큰 플러스
      }
    }

    // 점수 추가
    addScore(points);

    // 타이머 정지
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // 다음 라운드로 진행 함수
  const nextRound = () => {
    if (!sessionId || !isAdmin) {
      console.error("다음 라운드 진행 실패: 권한 없음");
      return;
    }

    const nextRoundNumber = currentRound < 3 ? currentRound + 1 : 1;
    console.log(`다음 라운드 진행: ${currentRound} -> ${nextRoundNumber}`); // 디버깅 로그

    if (currentRound < 3) {
      // 다음 라운드로 진행
      console.log("다음 라운드로 진행");

      // 상태 업데이트 - Firebase
      updateGameState({
        round: nextRoundNumber,
        isGameActive: true,
        buttonColor: "#007bff",
        clickOrder: 0,
      });

      // 로컬 상태 업데이트
      setCurrentRound(nextRoundNumber);
      setIsGameActive(true);
      setCurrentScore(null);
      setButtonColor("#007bff");
      setClickOrder(0);

      // 타이머 시작
      console.log("타이머 시작 호출");
      // 약간의 지연 후 타이머 시작 (상태 업데이트 완료 후)
      setTimeout(() => {
        startTimingGameTimer();
      }, 200);
    } else {
      // 게임 종료, 결과 화면으로
      console.log("모든 라운드 완료, 결과 화면으로 이동");
      updateGameState({
        mode: "result",
        round: 1,
      });

      setGameMode("result");
    }
  };

  // 빛 이동 게임 시작
  const startLightGame = () => {
    if (!sessionId || !isAdmin) return;

    // 초기 상태 설정
    updateGameState({
      mode: "light",
      isGameActive: true,
      activeLightPlayerId: null,
      selectedPlayerId: null,
    });

    setIsLightGameActive(true);
    setIsSelected(false);

    // 빛 이동 애니메이션 시작
    startLightGameAnimation();
  };

  // startLightGameAnimation 함수 전체 구현 (속도 조절 로직 포함)

  const startLightGameAnimation = () => {
    if (!sessionId || !isAdmin || players.length === 0) return;

    if (lightTimerRef.current) {
      clearInterval(lightTimerRef.current);
    }

    // 플레이어 수 확인
    const playerCount = players.length;
    if (playerCount < 2) return;

    let cycleCount = 0;
    // 최소 3바퀴(playerCount * 3)를 보장하고, 그 후 10~15 사이의 랜덤한 추가 이동
    const minCycles = playerCount * 3;
    const maxCycles = minCycles + 10 + Math.floor(Math.random() * 6);

    let currentPlayerIndex = 0;

    // 2명일 때의 방향 설정 (순차적으로 0→1→0→1...)
    let twoPlayerDirection = 1; // 1은 증가(0→1), -1은 감소(1→0)

    // 첫 번째 플레이어부터 시작
    const currentPlayer = players[currentPlayerIndex];
    updateGameState({
      activeLightPlayerId: currentPlayer.id,
    });

    // 빛 이동 속도 설정 (초기: 700ms, 최소: 200ms)
    let initialSpeed = 700; // 초기 속도
    let speed = initialSpeed;
    let slowdownStarted = false;

    const moveLight = () => {
      // 2명인 경우 0→1→0→1 식으로 번갈아가며 이동
      if (playerCount === 2) {
        // 다음 플레이어 인덱스 계산
        currentPlayerIndex = twoPlayerDirection === 1 ? 1 : 0;
        // 다음번에는 반대 방향으로 이동
        twoPlayerDirection *= -1;
      } else {
        // 3명 이상인 경우 시계방향으로 순환
        currentPlayerIndex = (currentPlayerIndex + 1) % playerCount;
      }

      const nextPlayer = players[currentPlayerIndex];

      // 데이터베이스 업데이트
      updateGameState({
        activeLightPlayerId: nextPlayer.id,
      });

      cycleCount++;

      // 속도 조절 로직
      // 처음 50% 동안은 점점 빨라지고, 나머지 50%는 점점 느려짐
      if (cycleCount < maxCycles / 2) {
        // 점점 빨라지는 단계
        speed = Math.max(initialSpeed - cycleCount * 20, 200);
      } else if (
        !slowdownStarted &&
        cycleCount >= maxCycles - playerCount * 2
      ) {
        // 마지막 2바퀴부터 점점 느려지기 시작
        slowdownStarted = true;
        speed = 300; // 느려지기 시작할 때 속도
      } else if (slowdownStarted) {
        // 점점 느려지는 단계
        speed = Math.min(speed + 50, 700); // 점점 느려짐 (최대 700ms까지)
      }

      // 타이머 재설정
      clearTimeout(lightTimerRef.current!);
      lightTimerRef.current = null;

      // 게임이 완전히 끝났는지 확인
      if (cycleCount >= maxCycles) {
        // 게임 종료 상태 저장
        const selectedPlayer = players[currentPlayerIndex];
        updateGameState({
          isGameActive: false,
          selectedPlayerId: selectedPlayer.id,
        });

        // 시각적 효과를 위해 마지막 플레이어에게 빛이 멈추는 지연 추가
        setTimeout(() => {
          // 게임 종료 상태 확인 (추가 안전 장치)
          updateGameState({
            isGameActive: false,
            selectedPlayerId: selectedPlayer.id,
          });
        }, 500);

        return; // 게임 종료
      }

      // 다음 이동을 위한 타이머 설정
      lightTimerRef.current = window.setTimeout(moveLight, speed);
    };

    // 첫 번째 이동 시작
    lightTimerRef.current = window.setTimeout(moveLight, speed);
  };

  // 새 게임 시작 함수
  const startNewGame = () => {
    if (!sessionId || !isAdmin) return;

    updateGameState({
      mode: "lobby",
      round: 1,
      isGameActive: false,
      buttonColor: "#007bff",
      clickOrder: 0,
      activeLightPlayerId: null,
      selectedPlayerId: null,
      timingScores: {},
    });

    // 로컬 상태 초기화
    setCurrentRound(1);
    setScores([]);
    setCurrentScore(null);
    setGameMode("lobby");
  };

  // 세션 나가기
  const leaveSession = () => {
    if (!sessionId || !playerId) return;

    if (isAdmin) {
      // 방장이 나가면 세션 삭제
      remove(ref(database, `sessions/${sessionId}`));
    } else {
      // 참가자만 나가면 해당 플레이어만 제거
      remove(ref(database, `sessions/${sessionId}/players/${playerId}`));
    }

    // 타이머 정리
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (lightTimerRef.current) {
      clearInterval(lightTimerRef.current);
      lightTimerRef.current = null;
    }

    // 로컬 상태 초기화
    setSessionId(null);
    setPlayerId(null);
    setPlayerNumber(0);
    setIsAdmin(false);
    setPlayers([]);
    setGameMode("home");
  };

  // 게임 선택
  const selectGame = (mode: GameMode) => {
    if (!sessionId || !isAdmin) return;

    if (mode === "timing") {
      updateGameState({
        mode: "timing",
        round: 1,
        isGameActive: false, // 시작 버튼을 표시하기 위해 게임 비활성화로 설정
        buttonColor: "#007bff",
        clickOrder: 0,
      });
      // startGame() 호출 제거
    }
    // ...
  };

  // 랭킹 계산 함수 추가
  const calculateRankings = (timingScores: {
    [playerId: string]: PlayerScore[];
  }) => {
    const rankings: PlayerWithScore[] = players.map((player) => {
      const playerScores = timingScores[player.id] || [];
      const totalScore = playerScores.reduce(
        (sum, score) => sum + score.points,
        0
      );

      return {
        ...player,
        totalScore,
      };
    });

    // 점수 내림차순으로 정렬
    rankings.sort((a, b) => b.totalScore - a.totalScore);
    setPlayerRankings(rankings);
  };

  // 눈치 게임 화면에 시작 버튼 추가

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      if (lightTimerRef.current) {
        clearInterval(lightTimerRef.current);
      }
    };
  }, []);
  const calculateTotalScore = (): number => {
    // 점수가 없으면 0 반환
    if (!scores || scores.length === 0) {
      return 0;
    }

    // 모든 라운드 점수 합산
    return scores.reduce((total, score) => total + score.points, 0);
  };
  return (
    <div className="App">
      {/* 홈 화면 */}
      {gameMode === "home" && (
        <div className="home-screen">
          <h1>제비뽑기</h1>
          <div className="home-buttons">
            <button onClick={() => setGameMode("join")} className="home-button">
              참여하기
            </button>
            <button
              onClick={() => {
                setPlayerName("");
                setGameMode("create");
              }}
              className="home-button"
            >
              방 만들기
            </button>
          </div>
        </div>
      )}

      {/* 방 생성 화면 */}
      {gameMode === "create" && (
        <div className="join-screen">
          <h2>방 만들기</h2>
          <div className="form-container">
            <div className="input-group">
              <label>이름</label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="이름을 입력하세요"
              />
            </div>

            <button onClick={createSession} className="create-button">
              방 생성하기
            </button>

            <button
              onClick={() => setGameMode("home")}
              className="back-button-alt"
            >
              뒤로
            </button>
          </div>
        </div>
      )}

      {/* 참여 화면 */}
      {gameMode === "join" && (
        <div className="join-screen">
          <h2>게임 참여하기</h2>
          <div className="form-container">
            <div className="input-group">
              <label>방 코드</label>
              <input
                type="text"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value)}
                placeholder="4자리 코드 입력"
              />
            </div>

            <div className="input-group">
              <label>이름</label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="이름을 입력하세요"
              />
            </div>

            {errorMessage && (
              <div className="error-message">{errorMessage}</div>
            )}

            <button onClick={joinSession} className="join-button">
              참여하기
            </button>

            <button
              onClick={() => setGameMode("home")}
              className="back-button-alt"
            >
              뒤로
            </button>
          </div>
        </div>
      )}

      {/* 로비 화면 */}
      {gameMode === "lobby" && (
        <div className="lobby-screen">
          <h2>게임 로비</h2>
          <div className="session-info">
            <div className="session-code">
              방 코드: <span>{sessionId}</span>
            </div>

            {isAdmin && joinUrl && (
              <div className="qr-container">
                <QRCodeSVG value={joinUrl} size={150} />
                <div className="qr-caption">QR 코드 스캔으로 참여</div>
              </div>
            )}
          </div>{" "}
          {/* session-info div 닫기 */}
          <div className="player-list">
            <h3>참가자 ({players.length}명)</h3>
            <div className="players">
              {players.map((player) => (
                <div
                  key={player.id}
                  className={`player-item ${
                    player.id === playerId ? "current-player" : ""
                  }`}
                >
                  <div className="player-number">{player.number}번</div>
                  <div className="player-name">{player.name}</div>
                  {player.id === playerId && (
                    <span className="you-badge">나</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          {isAdmin && (
            <div className="game-selection">
              <h3>게임 선택</h3>
              <div className="game-buttons">
                <button onClick={() => selectGame("timing")}>눈치 게임</button>
                <button onClick={() => selectGame("light")}>
                  빛 이동 게임
                </button>
              </div>
            </div>
          )}
          <button onClick={leaveSession} className="leave-button">
            나가기
          </button>
        </div>
      )}

      {/* 눈치 게임 화면 */}
      {gameMode === "timing" && (
        <div className="game-screen">
          <div className="game-header">
            <div className="round-indicator">라운드 {currentRound}/3</div>
            {currentScore !== null && (
              <div
                className={`score-bubble ${
                  currentScore > 0
                    ? "positive"
                    : currentScore < 0
                    ? "negative"
                    : "neutral"
                }`}
              >
                {currentScore > 0 ? `+${currentScore}` : currentScore}
              </div>
            )}
          </div>

          <div className="button-container">
            {!isGameActive && isAdmin ? (
              <button onClick={startGame} className="start-button">
                게임 시작
              </button>
            ) : (
              <button
                className="game-button"
                style={{ backgroundColor: buttonColor }}
                onClick={handleButtonClick}
                disabled={!isGameActive}
              >
                {/* 게임 활성화 상태에서만 "Freshhh" 텍스트 표시 */}
                {isGameActive && <span className="tap-text">Freshhh</span>}
              </button>
            )}
          </div>

          {/* 방장에게만 다음 버튼 표시 (게임 비활성화 상태일 때) */}
          {!isGameActive && isAdmin && (
            <button onClick={nextRound} className="next-button">
              {currentRound < 3 ? "NEXT" : "결과"}
            </button>
          )}

          <button onClick={leaveSession} className="back-button">
            ×
          </button>
        </div>
      )}

      {/* 빛 이동 게임 화면 */}
      {gameMode === "light" && (
        <div className="game-screen">
          <div className="player-indicator">{playerNumber}번</div>

          {/* 빛 방향 효과 추가 - both 효과 제거 */}
          <div className="light-container">
            {getLightDirection() === "left" && (
              <div className="light-left"></div>
            )}
            {getLightDirection() === "right" && (
              <div className="light-right"></div>
            )}
            {/* 양쪽 빛 효과 제거 */}

            <div className="button-container">
              <button
                className={`light-button ${isLightActive ? "active" : ""} ${
                  isSelected ? "selected" : ""
                }`}
                onClick={
                  isAdmin && !isLightGameActive ? startLightGame : undefined
                }
                disabled={!isAdmin || isLightGameActive}
              >
                {/* 당첨자 정보 표시 - 모든 참가자에게 표시 */}
                {showWinnerPopup ? (
                  <div className="winner-content">
                    <div className="winner-name-large">{winner?.name}</div>
                    <div className="chill-text-large">Chill</div>
                  </div>
                ) : isAdmin && !isLightGameActive ? (
                  "Chill"
                ) : (
                  ""
                )}
              </button>
            </div>

            {/* 다시 하기 버튼 - 방장에게만 표시 */}
            {showWinnerPopup && isAdmin && (
              <button onClick={startNewGame} className="restart-button">
                다시 하기
              </button>
            )}
          </div>

          <button onClick={leaveSession} className="back-button">
            ×
          </button>
        </div>
      )}

      {/* 결과 화면 */}
      {gameMode === "result" && (
        <div className="result-screen">
          <h2>게임 결과</h2>

          <div className="total-score-container">
            <div className="total-score-label">총점</div>
            <div
              className={`total-score ${
                calculateTotalScore() >= 0 ? "positive" : "negative"
              }`}
            >
              {calculateTotalScore() >= 0
                ? `+${calculateTotalScore()}`
                : calculateTotalScore()}
            </div>
          </div>

          <div className="score-list">
            {scores.map((score, index) => (
              <div key={index} className="score-item">
                <span className="round-label">라운드 {score.round}</span>
                <span
                  className={`score-value ${
                    score.points > 0
                      ? "positive"
                      : score.points < 0
                      ? "negative"
                      : "neutral"
                  }`}
                >
                  {score.points > 0 ? `+${score.points}` : score.points}
                </span>
              </div>
            ))}
          </div>

          {/* 전체 플레이어 랭킹 표시 */}
          <div className="ranking-container">
            <h3>전체 랭킹</h3>
            <div className="ranking-list">
              {playerRankings.map((player, index) => (
                <div
                  key={player.id}
                  className={`ranking-item ${
                    player.id === playerId ? "current-player" : ""
                  }`}
                >
                  <div className="rank-number">{index + 1}</div>
                  <div className="player-info">
                    <span className="player-name">{player.name}</span>
                    <span className="player-number">({player.number}번)</span>
                  </div>
                  <div
                    className={`player-score ${
                      player.totalScore > 0
                        ? "positive"
                        : player.totalScore < 0
                        ? "negative"
                        : "neutral"
                    }`}
                  >
                    {player.totalScore > 0
                      ? `+${player.totalScore}`
                      : player.totalScore}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {isAdmin ? (
            <button onClick={startNewGame} className="new-game-button">
              새 게임
            </button>
          ) : (
            <div className="waiting-message">
              방장이 새 게임을 시작하기를 기다리는 중...
            </div>
          )}

          <button onClick={leaveSession} className="back-button">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

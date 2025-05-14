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
  };

  // 빛 방향 표시 로직 추가
  const getLightDirection = () => {
    if (!gameState || (!isLightActive && !isSelected)) {
      // 게임 상태가 없거나, 빛이 나에게 없고 선택되지 않았을 때 방향 계산
      if (players.length <= 1 || !gameState) return "none";

      // 빛이 있는 플레이어 찾기
      const activePlayerIndex = players.findIndex(
        (player) => player.id === gameState.activeLightPlayerId
      );

      // 내 위치 찾기
      const myIndex = players.findIndex((player) => player.id === playerId);

      if (activePlayerIndex === -1 || myIndex === -1) return "none";

      // 플레이어 수
      const playerCount = players.length;

      // 방향 계산 로직
      // 시계 방향으로 배치된다고 가정하고 가장 가까운 방향 계산
      const clockwiseDistance =
        (activePlayerIndex - myIndex + playerCount) % playerCount;
      const counterClockwiseDistance =
        (myIndex - activePlayerIndex + playerCount) % playerCount;

      // 가장 가까운 방향 선택
      if (clockwiseDistance <= counterClockwiseDistance) {
        return "right"; // 시계 방향이 더 가까우면 오른쪽
      } else {
        return "left"; // 반시계 방향이 더 가까우면 왼쪽
      }
    }

    return "none"; // 빛이 나에게 있거나 선택된 경우
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
    if (!sessionId || !isAdmin) return;

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
    }

    const startTime = Date.now();

    timerRef.current = window.setInterval(() => {
      const elapsedTime = Date.now() - startTime;
      const progress = Math.min(elapsedTime / 10000, 1); // 10초 경과 = 100%

      // 파란색(#007bff)에서 빨간색(#dc3545)로 변화
      const red = Math.floor(0 + (220 - 0) * progress);
      const green = Math.floor(123 * (1 - progress));
      const blue = Math.floor(255 * (1 - progress));

      const newColor = `rgb(${red}, ${green}, ${blue})`;
      setButtonColor(newColor);

      // 관리자인 경우 색상 상태 업데이트
      if (isAdmin && sessionId) {
        updateGameState({
          buttonColor: newColor,
        });
      }

      // 10초 후 자동 폭발
      if (elapsedTime >= 10000) {
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
    }, 100);
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

    // 클릭 순서에 따라 점수 부여
    let points: number;

    switch (clickOrder) {
      case 0:
        points = -3;
        break; // 첫 번째 클릭
      case 1:
        points = -2;
        break; // 두 번째 클릭
      case 2:
        points = -1;
        break; // 세 번째 클릭
      case 3:
        points = 1;
        break; // 네 번째 클릭
      case 4:
        points = 2;
        break; // 다섯 번째 클릭
      default:
        points = 3;
        break; // 여섯 번째 이상 클릭
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
    if (!sessionId || !isAdmin) return;

    const nextRoundNumber = currentRound < 3 ? currentRound + 1 : 1;

    if (currentRound < 3) {
      // 다음 라운드로
      updateGameState({
        round: nextRoundNumber,
        isGameActive: true,
        buttonColor: "#007bff",
        clickOrder: 0,
      });

      setCurrentRound(nextRoundNumber);
      startGame();
    } else {
      // 게임 종료, 결과 화면으로
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

  // 빛 이동 애니메이션
  const startLightGameAnimation = () => {
    if (!sessionId || !isAdmin || players.length === 0) return;

    if (lightTimerRef.current) {
      clearInterval(lightTimerRef.current);
    }

    let cycleCount = 0;
    const maxCycles = 10 + Math.floor(Math.random() * 15); // 10-25 사이클
    let currentPlayerIndex = 0;

    // 첫 번째 플레이어부터 시작
    const currentPlayer = players[currentPlayerIndex];
    updateGameState({
      activeLightPlayerId: currentPlayer.id,
    });

    let speed = 700; // 초기 이동 속도 (ms)

    lightTimerRef.current = window.setInterval(() => {
      // 다음 플레이어로 이동
      currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
      const nextPlayer = players[currentPlayerIndex];

      updateGameState({
        activeLightPlayerId: nextPlayer.id,
      });

      cycleCount++;

      // 속도 점점 빨라지게
      if (cycleCount > 5) {
        speed = Math.max(speed - 50, 200);
        clearInterval(lightTimerRef.current!);
        lightTimerRef.current = null; // 이 줄을 추가하세요

        lightTimerRef.current = window.setInterval(() => {
          // 다음 플레이어로 이동
          currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
          const nextPlayer = players[currentPlayerIndex];

          updateGameState({
            activeLightPlayerId: nextPlayer.id,
          });

          cycleCount++;

          // 일정 확률로 게임 종료
          if (cycleCount > maxCycles && Math.random() < 0.3) {
            clearInterval(lightTimerRef.current!);
            lightTimerRef.current = null;

            const selectedPlayer = players[currentPlayerIndex];

            // 게임 종료 상태 저장
            updateGameState({
              isGameActive: false,
              selectedPlayerId: selectedPlayer.id,
            });
          }
        }, speed);
      }
    }, speed);
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
        isGameActive: true,
        buttonColor: "#007bff",
        clickOrder: 0,
      });

      setCurrentRound(1);
      setScores([]);
      setGameMode("timing");
      startGame();
    } else if (mode === "light") {
      updateGameState({
        mode: "light",
        isGameActive: true,
        activeLightPlayerId: null,
        selectedPlayerId: null,
      });

      setGameMode("light");
      startLightGame();
    }
  };

  // 총점 계산 함수
  const calculateTotalScore = (): number => {
    return scores.reduce((total, score) => total + score.points, 0);
  };

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
                  currentScore > 0 ? "positive" : "negative"
                }`}
              >
                {currentScore > 0 ? `+${currentScore}` : currentScore}
              </div>
            )}
          </div>

          <div className="button-container">
            <button
              className="game-button"
              style={{ backgroundColor: buttonColor }}
              onClick={handleButtonClick}
              disabled={!isGameActive}
            >
              <span className="tap-text">{isGameActive ? "TAP" : ""}</span>
            </button>
          </div>

          {!isGameActive && currentScore !== null && isAdmin && (
            <button onClick={nextRound} className="next-button">
              {currentRound < 3 ? "다음" : "결과"}
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

          {/* 빛 방향 효과 추가 */}
          <div className="light-container">
            {getLightDirection() === "left" && (
              <div className="light-left"></div>
            )}
            {getLightDirection() === "right" && (
              <div className="light-right"></div>
            )}

            <div className="button-container">
              <button
                className={`light-button ${isLightActive ? "active" : ""} ${
                  isSelected ? "selected" : ""
                }`}
                disabled
              >
                {isSelected ? "!" : ""}
              </button>
            </div>
          </div>

          {/* 방장의 시작 버튼 스타일 변경 */}
          {isAdmin && !isLightGameActive && (
            <button onClick={startLightGame} className="chill-start-button">
              {isSelected ? "Chill Again" : "Chill"}
            </button>
          )}

          {/* 당첨자 팝업 */}
          {showWinnerPopup && (
            <>
              <div className="overlay"></div>
              <div className="winner-popup">
                <h3>당첨자</h3>
                <div className="winner-name">{winner?.name}</div>
                <div className="chill-text">
                  Chill<span className="chill-emoji">😎✨</span>
                </div>
              </div>
            </>
          )}

          <button onClick={leaveSession} className="back-button">
            ×
          </button>
        </div>
      )}
      {/* 결과 화면 */}
      {gameMode === "result" && (
        <div className="result-screen">
          <h2>결과</h2>

          <div className="total-score">
            총점:{" "}
            <span
              className={calculateTotalScore() >= 0 ? "positive" : "negative"}
            >
              {calculateTotalScore()}
            </span>
          </div>

          <div className="score-list">
            {scores.map((score, index) => (
              <div key={index} className="score-item">
                <span className="round-label">라운드 {score.round}</span>
                <span
                  className={`score-value ${
                    score.points >= 0 ? "positive" : "negative"
                  }`}
                >
                  {score.points >= 0 ? `+${score.points}` : score.points}
                </span>
              </div>
            ))}
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

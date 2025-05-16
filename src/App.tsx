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
import { serverTimestamp } from "firebase/database"; // 파일 상단 import 부분에 추가
import { runTransaction } from "firebase/database";
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
  startTime?: any; // 타입을 any로 변경
  clickTime?: any; // 타입을 any로 변경
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

      // 항상 서버의 버튼 색상을 적용 (이전: isGameActive 조건부 적용)
      setButtonColor(gameState.buttonColor);

      // 중요: 타이머 진행 중일 때는 서버의 색상 값을 무시
      // 타이머가 활성화된 상태에서만 로컬에서 색상을 관리하고,
      // 비활성화 상태에서는 서버의 색상 값을 사용
      if (!isGameActive && gameState.isGameActive) {
        // 게임이 시작될 때 색상 초기화
        setButtonColor("#007bff");
      } else if (!gameState.isGameActive) {
        // 게임이 종료되면 서버 색상 적용
        setButtonColor(gameState.buttonColor);
      }
      // 그 외 타이머 진행 중에는 로컬 색상 유지

      setClickOrder(gameState.clickOrder);

      // 내 점수 가져오기
      if (
        playerId &&
        gameState.timingScores &&
        gameState.timingScores[playerId]
      ) {
        const playerScores = gameState.timingScores[playerId];
        setScores(playerScores);

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

      // 방장인 경우에만 타이머 시작
      if (isAdmin && gameState.isGameActive && !isGameActive) {
        startTimingGameTimerForced();
      }
      // 참가자인 경우 타이머 없이 상태만 동기화
      else if (!isAdmin) {
        // 기존 타이머 정리
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }

        // 게임이 시작될 때 참가자도 버튼 색상 애니메이션 적용
        if (gameState.isGameActive) {
          setButtonColor("#007bff");

          // 버튼 색상 변화 애니메이션 직접 적용
          if (buttonRef.current) {
            // 트랜지션 제거
            buttonRef.current.style.transition = "none";
            buttonRef.current.style.backgroundColor = "#007bff";

            // 강제 레이아웃 재계산
            void buttonRef.current.offsetHeight;

            // 애니메이션 적용
            buttonRef.current.style.cssText = `
            background-color: #007bff !important;
            transition: background-color 4s linear !important;
            will-change: background-color;
          `;

            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (buttonRef.current) {
                  buttonRef.current.style.backgroundColor = "#dc3545";
                }
              });
            });
          }
        }
      // 방장인 경우에만 모든 플레이어가 클릭했는지 확인
  if (isAdmin && !gameState.isGameActive) {
    checkAllPlayersClicked(gameState.timingScores);
  }
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
      console.log("결과 화면으로 진입, 동기화");

      // 모드를 명시적으로 'result'로 설정
      setGameMode("result");

      // 점수 데이터 로깅
      if (gameState.timingScores) {
        console.log(
          "결과 화면 진입, 전체 점수 데이터:",
          gameState.timingScores
        );

        // 나의 점수 가져오기
        if (
          playerId &&
          gameState.timingScores &&
          gameState.timingScores[playerId]
        ) {
          let playerScores = [...gameState.timingScores[playerId]];

          // 누락된 라운드 점수 확인 및 추가
          for (let round = 1; round <= 3; round++) {
            const hasRoundScore = playerScores.some(
              (score) => score.round === round
            );
            if (!hasRoundScore) {
              // 누락된 라운드는 폭발 점수(-5) 추가
              playerScores.push({ round, points: -5 });
            }
          }

          // 라운드 순서대로 정렬
          playerScores.sort((a, b) => a.round - b.round);

          // 점수 상태 업데이트
          setScores(playerScores);

          // 총점 계산 및 로깅
          const totalScore = playerScores.reduce(
            (sum, score) => sum + score.points,
            0
          );
          console.log("총점:", totalScore);
        } else {
          console.warn(
            "결과 화면: 내 점수 데이터가 없음, 플레이어 ID:",
            playerId
          );
        }

        // 랭킹 계산
        calculateRankings(gameState.timingScores);
      } else {
        console.warn("결과 화면: 점수 데이터가 없음");
      }
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

    // 로컬 상태 업데이트
    setScores((prevScores) => {
      console.log("현재 점수 배열:", prevScores);

      // 현재 라운드의 점수가 이미 있는지 확인
      const existingScoreIndex = prevScores.findIndex(
        (s) => s.round === currentRound
      );

      if (existingScoreIndex !== -1) {
        // 이미 있으면 업데이트
        const updatedScores = [...prevScores];
        updatedScores[existingScoreIndex] = newScore;
        return updatedScores;
      } else {
        // 없으면 추가
        return [...prevScores, newScore];
      }
    });

    setCurrentScore(points);
    console.log("점수 추가:", newScore);

    // 명확한 경로 설정으로 구조 개선
    const scoreRef = ref(
      database,
      `sessions/${sessionId}/gameState/timingScores/${playerId}`
    );

    // 현재 DB에 저장된 점수 가져와서 업데이트
    return new Promise<void>((resolve) => {
      onValue(
        scoreRef,
        (snapshot) => {
          let playerScores = [];

          if (snapshot.exists()) {
            playerScores = snapshot.val();
            console.log("기존 DB 점수:", playerScores);
          }

          // 현재 라운드의 점수 위치 찾기
          const existingScoreIndex = playerScores.findIndex(
            (s: PlayerScore) => s.round === currentRound
          );

          if (existingScoreIndex !== -1) {
            // 이미 있으면 업데이트
            playerScores[existingScoreIndex] = newScore;
          } else {
            // 없으면 추가
            playerScores.push(newScore);
          }

          // 반드시 점수 배열을 라운드 순서대로 정렬
          playerScores.sort(
            (a: PlayerScore, b: PlayerScore) => a.round - b.round
          );

          console.log("저장할 DB 점수:", playerScores);

          // 전체 점수 배열 저장
          set(scoreRef, playerScores)
            .then(() => {
              console.log("점수 저장 성공");
              resolve();
            })
            .catch((error) => {
              console.error("점수 저장 실패:", error);
              resolve();
            });
        },
        { onlyOnce: true }
      );
    });
  };
  const clearAllTimers = () => {
    console.log("모든 타이머 정리");
    // 타이머 정리
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // 애니메이션 프레임 정리
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
  };

  // 눈치 게임 시작 함수
  const startGame = () => {
    const startTime = new Date().toISOString();
    console.log(`[${startTime}] 눈치 게임 시작`);

    if (!sessionId || !isAdmin) {
      console.error("게임 시작 실패: 권한 없음");
      return;
    }

    // 초기 버튼 색상 설정
    setButtonColor("#007bff");

    // 게임 상태 업데이트
    updateGameState({
      mode: "timing",
      isGameActive: true,
      round: currentRound,
      buttonColor: "#007bff",
      clickOrder: 0,
      startTime: serverTimestamp() as any, // 타입 단언 추가
    });

    // 로컬 상태 업데이트
    setIsGameActive(true);
    setCurrentScore(null);
    setClickOrder(0);

    console.log("타이머 시작 직전, isGameActive:", true);

    // 수정: 타이머 함수 내에서 isGameActive 체크를 건너뛰고 직접 타이머 설정
    startTimingGameTimerForced();
  };

  const buttonRef = useRef<HTMLButtonElement>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  // 강제 타이머 함수 - isGameActive 체크 없이 항상 실행됨
  const startTimingGameTimerForced = () => {
    console.log("강제 타이머 시작");

    // 1. 기존 타이머 정리
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // 중요: 결과 화면이면 타이머 시작하지 않음
    if (gameMode === "result") {
      console.log("결과 화면에서는 타이머를 시작하지 않습니다.");
      return;
    }

    // 2. 초기 색상 설정 (파란색)
    const initialColor = "#007bff";
    const finalColor = "#dc3545";
    setButtonColor(initialColor);

    // 3. 버튼에 직접 스타일 적용 (개선된 방식)
    if (buttonRef.current) {
      // 트랜지션 제거
      buttonRef.current.style.transition = "none";
      buttonRef.current.style.backgroundColor = initialColor;

      // 강제 레이아웃 재계산 (중요!)
      void buttonRef.current.offsetHeight;

      // 인라인 스타일 직접 적용으로 트랜지션 보장
      buttonRef.current.style.cssText = `
        background-color: ${initialColor} !important;
        transition: background-color 4s linear !important;
        will-change: background-color;
      `;

      // requestAnimationFrame으로 다음 프레임에서 색상 변경
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (buttonRef.current) {
            buttonRef.current.style.backgroundColor = finalColor;
            console.log("색상 변화 시작 - 중첩 RAF 사용");
          }
        });
      });
    }

    // 4초 후 폭발 함수 호출
    console.log("4초 타이머 설정");
    timerRef.current = window.setTimeout(() => {
      console.log("타이머 종료 - 폭발!");
      if ((gameMode as GameMode) === "result") {
        console.log("결과 화면에서는 타이머를 시작하지 않습니다.");
        return;
      }

      // 최종 색상 설정 및 상태 업데이트
      setButtonColor(finalColor);
      setIsGameActive(false);

      if (buttonRef.current) {
        buttonRef.current.style.transition = "none";
        buttonRef.current.style.backgroundColor = finalColor;
      }

      // Firebase 상태 업데이트 (방장인 경우)
      if (isAdmin && sessionId) {
        console.log("방장: 폭발 상태 업데이트");
        const gameStateRef = ref(database, `sessions/${sessionId}/gameState`);
        update(gameStateRef, {
          isGameActive: false,
          buttonColor: finalColor,
          lastUpdateTime: Date.now(),
        });
      }

      // 점수 추가 (폭발로 인한 -5점)
      if (currentScore === null && isGameActive) {
        // isGameActive 체크 추가
        console.log("폭발로 인한 -5점 추가");
        addScore(-5);
      }
    }, 4000);

    console.log("타이머 함수 종료");
  };
  // 버튼 클릭 처리 함수
  // 방장만 게임 상태를 변경할 수 있게 수정
  const handleButtonClick = () => {
    const clickTime = new Date().toISOString();
    console.log(`[${clickTime}] 버튼 클릭됨!`);

    // 이미 게임이 비활성화되었거나 세션이 없는 경우 무시
    if (!isGameActive || !sessionId || !playerId) {
      console.log("클릭 무시: 게임이 활성화되지 않았거나 세션이 없음");
      return;
    }

      // 즉시 버튼 비활성화 (중요!)
  setIsGameActive(false);

    // 이미 점수를 받았으면 무시 - 이 부분은 이미 있으나 강화
    if (currentScore !== null) {
      console.log("이미 점수가 있어 클릭 무시:", currentScore);
      return;
    }

    // 즉시 버튼 비활성화 (중요!)
  setIsGameActive(false);

  // 현재 색상 유지 (애니메이션 중단)
  if (buttonRef.current) {
    // 현재 표시되는 색상 가져오기
    const currentColor = window.getComputedStyle(buttonRef.current).backgroundColor;
    
    // 트랜지션 효과 제거하여 애니메이션 중단
    buttonRef.current.style.transition = "none";
    // 현재 색상 유지
    buttonRef.current.style.backgroundColor = currentColor;
  }

    // 타이머 정리
    clearAllTimers();

    // 1. 모든 타이머와 애니메이션 즉시 정리
    if (timerRef.current) {
      console.log("타이머 정리");
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (animationFrameIdRef.current) {
      console.log("애니메이션 프레임 정리");
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }

    // 2. 로컬 상태 즉시 업데이트
    setIsGameActive(false);

    // 3. 클릭 순서 증가 및 로컬 상태 업데이트
    const newClickOrder = clickOrder + 1;
    setClickOrder(newClickOrder);

    // 3. 클릭 정보를 Firebase에 저장 (방장/참가자 모두)
    console.log(`Firebase 상태 업데이트: 클릭한 플레이어 ${playerId}`);

    const gameStateRef = ref(database, `sessions/${sessionId}/gameState`);

    // 방장인 경우 전체 게임 상태 변경
    if (isAdmin) {
      // 클릭 순서 업데이트
      const newClickOrder = clickOrder + 1;
      setClickOrder(newClickOrder);

      update(gameStateRef, {
        clickOrder: newClickOrder,
        // isGameActive: false를 제거하고 게임 계속 진행
        isGameActive: false, // 이 줄 추가: 방장도 게임 비활성화
        clickTime: serverTimestamp(),
        lastUpdateTime: Date.now(),
        buttonColor: buttonColor, // 현재 색상 유지
        lastClickedPlayerId: playerId, // 누가 클릭했는지 저장
      });
    }
    // 참가자인 경우 클릭 정보 및 클릭 순서 업데이트
    else {
      // 트랜잭션을 사용하여 clickOrder를 원자적으로 증가
      runTransaction(gameStateRef, (currentData) => {
        if (currentData) {
          // 클릭한 플레이어 목록 업데이트 (없으면 새로 생성)
      const clickedPlayers = currentData.clickedPlayers || {};
      clickedPlayers[playerId] = true;
          return {
            ...currentData,
            clickOrder: (currentData.clickOrder || 0) + 1,
            lastClickedPlayerId: playerId,
            lastUpdateTime: Date.now(),
            isGameActive: false // 클릭한 참가자는 더 이상 클릭할 수 없도록 함
          };
        }
        return currentData;
      });
    }

    // 5. 점수 계산 (방장/참가자 모두 점수 계산 로직 실행)
    let points: number;
    const totalPlayers = players.length;
    console.log(
      "점수 계산 시작, 클릭 순서:",
      clickOrder + 1,
      "총 인원:",
      totalPlayers
    );

    // 점수 계산 로직
    if (totalPlayers <= 1) {
      // 혼자 테스트 중인 경우
      points = 2;
      console.log("혼자 테스트 중이므로 +2점 부여");
    } else if (totalPlayers === 2) {
      // 2인 플레이
      points = newClickOrder === 1 ? -2 : 2; // 첫번째: -2, 두번째: +2
      console.log("2인 플레이, 순서:", newClickOrder, "점수:", points);
    } else if (totalPlayers % 2 === 1) {
      // 홀수 인원
      const middleIndex = Math.floor(totalPlayers / 2);
      console.log(
        "홀수 인원, 중간 인덱스:",
        middleIndex,
        "클릭 순서:",
        newClickOrder - 1
      );

      if (newClickOrder - 1 < middleIndex) {
        points = -(middleIndex - (newClickOrder - 1)); // 마이너스 점수
      } else if (newClickOrder - 1 === middleIndex) {
        points = 0; // 중간값은 0점
      } else {
        points = newClickOrder - 1 - middleIndex; // 플러스 점수
      }
    } else {
      // 짝수 인원
      const middleIndex = totalPlayers / 2 - 1;
      console.log(
        "짝수 인원, 중간 인덱스:",
        middleIndex,
        "클릭 순서:",
        newClickOrder - 1
      );

      if (newClickOrder - 1 <= middleIndex) {
        points = -(middleIndex - (newClickOrder - 1) + 1);
      } else {
        points = newClickOrder - 1 - middleIndex;
      }
    }

    console.log(
      `최종 점수 계산: ${points} (클릭 순서: ${newClickOrder}, 총 인원: ${totalPlayers})`
    );

    // 6. 점수 추가 - 직접 로컬 상태 업데이트 (너무 빠른 업데이트 방지)
    setTimeout(() => {
      if (currentScore === null) {
        addScore(points);
      }
    }, 100);
  };

  // 다음 라운드로 진행 함수 수정
  const nextRound = async () => {
    if (!sessionId || !isAdmin) {
      console.error("다음 라운드 진행 실패: 권한 없음");
      return;
    }

    console.log(`현재 라운드: ${currentRound}, 다음 이동 결정`);

    // 현재 라운드 점수 확인
    const hasCurrentRoundScore = scores.some((s) => s.round === currentRound);

    // 3라운드가 끝났는지 확인
    if (currentRound >= 3) {
      // 3라운드 점수가 없으면 폭발 처리
      if (!hasCurrentRoundScore) {
        console.log(
          `경고: 라운드 ${currentRound}에 점수가 없습니다. 폭발 점수 추가 중...`
        );
        addScore(-5); // 점수가 없으면 폭발로 처리

        // 점수 처리를 위한 지연 후 결과 화면으로 전환
        setTimeout(() => {
          proceedToResultScreen();
        }, 500);
      } else {
        // 정상적으로 결과 화면으로 전환
        proceedToResultScreen();
      }
      return;
    }

    // 현재 라운드 점수가 없으면 폭발 처리
    if (!hasCurrentRoundScore) {
      console.log(
        `경고: 라운드 ${currentRound}에 점수가 없습니다. 폭발 점수 추가 중...`
      );
      addScore(-5); // 점수가 없으면 폭발로 처리

      // 점수 추가를 위한 약간의 지연
      setTimeout(() => {
        proceedToNextRound();
      }, 300);
    } else {
      // 정상적으로 다음 라운드 진행
      proceedToNextRound();
    }

    // 결과 화면으로 전환하는 내부 함수
    function proceedToResultScreen() {
      console.log("3라운드 완료, 결과 화면으로 전환 - 시작");

      // 중요: 모든 타이머 정리 추가
      clearAllTimers();

      // 추가: 타이머 확실하게 정리
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      // 1. 즉시 로컬 상태 변경
      setGameMode("result");
      console.log("로컬 게임모드 변경: 'result'");

      // 2. 간단한 방식으로 Firebase 상태 업데이트
      const gameStateRef = ref(database, `sessions/${sessionId}/gameState`);
      update(gameStateRef, {
        mode: "result",
        round: 1,
        isGameActive: false,
        lastUpdateTime: Date.now(),
      })
        .then(() => {
          console.log("Firebase 상태 업데이트 성공: 'result' 모드");
        })
        .catch((error) => {
          console.error("Firebase 상태 업데이트 실패:", error);
        });
    }

    // 다음 라운드로 진행하는 내부 함수
    function proceedToNextRound() {
      // 다음 라운드로 진행
      const nextRoundNumber = currentRound + 1;
      console.log(`다음 라운드로 진행: ${currentRound} -> ${nextRoundNumber}`);

      // 로컬 상태 업데이트
      setCurrentRound(nextRoundNumber);
      setButtonColor("#007bff");
      setIsGameActive(true);
      setCurrentScore(null);
      setClickOrder(0);

      // Firebase 상태 업데이트
      const gameStateRef = ref(database, `sessions/${sessionId}/gameState`);
      set(gameStateRef, {
        mode: "timing",
        round: nextRoundNumber,
        isGameActive: true,
        buttonColor: "#007bff",
        clickOrder: 0,
        lastUpdateTime: Date.now(),
        timingScores: gameState?.timingScores || {}, // 기존 점수 보존
      })
        .then(() => {
          console.log(`Firebase 상태 업데이트 성공: 라운드 ${nextRoundNumber}`);
          // 타이머 시작
          setTimeout(() => {
            startTimingGameTimerForced();
          }, 300);
        })
        .catch((error) => {
          console.error("Firebase 상태 업데이트 실패:", error);
        });
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
      clearTimeout(lightTimerRef.current);
      lightTimerRef.current = null;
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
      if (lightTimerRef.current) {
        clearTimeout(lightTimerRef.current);
        lightTimerRef.current = null;
      }

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
  // 새 게임 시작 함수 수정
  const startNewGame = () => {
    if (!sessionId || !isAdmin) {
      console.error("새 게임 시작 실패: 권한 없음");
      return;
    }

    console.log("새 게임 시작");

    // 로컬 상태 즉시 초기화
    setCurrentRound(1);
    setScores([]);
    setCurrentScore(null);
    setGameMode("lobby");
    setButtonColor("#007bff");
    setClickOrder(0);

    // Firebase 상태 직접 업데이트
    const gameStateRef = ref(database, `sessions/${sessionId}/gameState`);
    update(gameStateRef, {
      mode: "lobby",
      round: 1,
      isGameActive: false,
      buttonColor: "#007bff",
      clickOrder: 0,
      activeLightPlayerId: null,
      selectedPlayerId: null,
      timingScores: {},
      lastUpdateTime: Date.now(),
    })
      .then(() => {
        console.log("새 게임 상태 저장 성공");
      })
      .catch((error) => {
        console.error("새 게임 상태 저장 실패:", error);
      });
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
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (lightTimerRef.current) {
      clearTimeout(lightTimerRef.current);
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
    // 플레이어별 총점 계산
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

  useEffect(() => {
    // 버튼 요소에 현재 색상 상태 적용
    if (buttonRef.current && buttonColor) {
      buttonRef.current.style.backgroundColor = buttonColor;

      // 버튼 그림자 색상 동적 업데이트 (CSS 변수 사용)
      const rgbMatch = buttonColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (rgbMatch) {
        buttonRef.current.style.setProperty("--r", rgbMatch[1]);
        buttonRef.current.style.setProperty("--g", rgbMatch[2]);
        buttonRef.current.style.setProperty("--b", rgbMatch[3]);
      }
    }
  }, [buttonColor]);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;

    const handleTransitionEnd = () => {
      // 트랜지션이 끝난 후 만약 색상이 최종 상태(빨간색)라면
      if (button.style.backgroundColor === "rgb(220, 53, 69)") {
        // 트랜지션 효과 제거하여 깜빡임 방지
        button.style.transition = "none";
      }
    };

    button.addEventListener("transitionend", handleTransitionEnd);

    return () => {
      button.removeEventListener("transitionend", handleTransitionEnd);
    };
  }, []);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      if (lightTimerRef.current) {
        clearTimeout(lightTimerRef.current);
        lightTimerRef.current = null;
      }
      // 버튼 클릭 시 모든 애니메이션과 타이머를 즉시 정리
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      clearAllTimers(); // 함수 호출
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

  // 새로운 함수 추가: 모든 플레이어가 클릭했는지 확인
const checkAllPlayersClicked = (timingScores: { [playerId: string]: PlayerScore[] }) => {
  // 현재 라운드에 모든 플레이어가 점수를 가지고 있는지 확인
  const allPlayersClicked = players.every(player => {
    const playerScores = timingScores[player.id] || [];
    return playerScores.some(score => score.round === currentRound);
  });

  // 모든 플레이어가 클릭했으면 자동으로 다음 라운드 진행
  if (allPlayersClicked) {
    console.log("모든 플레이어가 클릭 완료, 자동으로 다음 라운드 진행");
    setTimeout(() => {
      if (isAdmin) {
        nextRound();
      }
    }, 2000); // 2초 후 다음 라운드 진행
  }
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
            {!isGameActive ? (
              isAdmin ? (
                // 첫 라운드에서 시작하지 않았고, 점수가 없는 경우만 Start 버튼 표시
                currentRound === 1 &&
                clickOrder === 0 &&
                currentScore === null ? (
                  // 첫 라운드 시작 - Start 버튼
                  <button
                    className="game-button"
                    onClick={startGame}
                    style={{ backgroundColor: "#28a745" }}
                  >
                    <span className="tap-text">Start</span>
                  </button>
                ) : (
                  // 그 외 모든 경우에는 Next 버튼 표시
                  <button
                    className="game-button next-round-button"
                    onClick={nextRound}
                    style={{ backgroundColor: "#28a745" }}
                  >
                    <span className="tap-text">
                      {currentRound < 3 ? "Next" : "Result"}
                    </span>
                  </button>
                )
              ) : (
                // 방장이 아닌 경우 기존 코드 유지
                <button
                  className="game-button"
                  disabled={true}
                  style={{ backgroundColor: "#1c1c1e", opacity: 0.7 }}
                >
                  <span className="tap-text" style={{ fontSize: "18px" }}>
                    {currentScore !== null
                      ? "다음 라운드 대기 중..."
                      : "대기 중..."}
                  </span>
                </button>
              )
            ) : (
              // 게임 활성화 상태일 때는 기존 코드 유지
              <button
                ref={buttonRef}
                className="game-button"
                style={{ backgroundColor: buttonColor }}
                onClick={handleButtonClick}
                disabled={!isGameActive}
              >
                <span className="tap-text">Freshhh</span>
              </button>
            )}
          </div>

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

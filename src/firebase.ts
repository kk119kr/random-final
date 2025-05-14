// src/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getDatabase } from "firebase/database";

// Firebase 설정 정보 - 테스트용 더미 값
const firebaseConfig = {
  apiKey: "AIzaSyCpkm358REiYLIXqD8QlXztvit28Ok91CA",
  authDomain: "random--rottery-gamee.firebaseapp.com",
  databaseURL: "https://random--rottery-gamee-default-rtdb.firebaseio.com",
  projectId: "random--rottery-gamee",
  storageBucket: "random--rottery-gamee.firebasestorage.app",
  messagingSenderId: "758980136451",
  appId: "1:758980136451:web:3e997a933a22a37ba00836",
  measurementId: "G-PZR9FCTP53",
};

// 전역 변수로 Firebase 앱과 데이터베이스 인스턴스 관리
let app;
let db;

// 앱 초기화 함수
function initializeFirebase() {
  try {
    // 이미 초기화된 앱이 있는지 확인
    if (getApps().length === 0) {
      // 초기화된 앱이 없으면 새로 생성
      app = initializeApp(firebaseConfig);
      console.log("Firebase 앱 초기화 완료");
    } else {
      // 이미 초기화된 앱이 있으면 사용
      app = getApps()[0];
      console.log("기존 Firebase 앱 사용");
    }

    // 데이터베이스 초기화
    db = getDatabase(app);
    console.log("Firebase 데이터베이스 초기화 완료");

    return true;
  } catch (error) {
    console.error("Firebase 초기화 오류:", error);
    return false;
  }
}

// 초기화 실행
const isInitialized = initializeFirebase();

// 데이터베이스 인스턴스 내보내기
export const database = isInitialized ? db : null;

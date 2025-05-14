// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
// Firebase 애널리틱스가 필요한 경우 주석 해제
// import { getAnalytics } from "firebase/analytics";

// Firebase 설정 정보
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

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
// Firebase 애널리틱스가 필요한 경우 주석 해제
// const analytics = getAnalytics(app);

export { database };

// 초기화 실행
const isInitialized = initializeFirebase();

// 데이터베이스 인스턴스 내보내기
export const database = isInitialized ? db : null;

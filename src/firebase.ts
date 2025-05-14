// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

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

// Firebase 초기화 및 데이터베이스 인스턴스 생성
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// 데이터베이스 인스턴스 내보내기
export { database };

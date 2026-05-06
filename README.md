# 다가구 통합 관리

브라우저에서 바로 실행할 수 있는 정적 웹앱입니다.

## 파일 구성

- `index.html`: 화면 구조
- `styles.css`: 스타일
- `app.js`: 동작 로직과 `localStorage` 저장
- `manifest.webmanifest`: 웹앱 설치 정보
- `sw.js`: 오프라인 캐시용 서비스 워커
- `icon.svg`: 웹앱 아이콘
- `IOS_APP_ARCHITECTURE.md`: iPhone 앱 전환용 구조 설계 문서

## 로컬 실행

브라우저에서 `index.html`을 열면 바로 사용할 수 있습니다.

## 배포

정적 사이트 배포가 가능한 서비스에 그대로 올리면 됩니다.

- Vercel
- Netlify
- GitHub Pages

## 주의

현재 데이터는 브라우저 `localStorage`에 저장됩니다.
같은 브라우저, 같은 기기에서만 유지됩니다.

## 아이폰에서 웹앱처럼 사용하기

1. 사파리에서 `index.html`이 배포된 주소를 엽니다.
2. 공유 버튼을 누릅니다.
3. `홈 화면에 추가`를 선택합니다.
4. 홈 화면에서 열면 앱처럼 전체 화면으로 사용할 수 있습니다.

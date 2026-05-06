# 홈 매니저 iPhone 앱 구조안

웹앱에서 검증한 기능을 iPhone 네이티브 앱으로 옮길 때의 기준 설계 문서입니다.

## 목표

- 웹앱의 기능을 그대로 억지로 옮기지 않고 iPhone 사용 흐름에 맞게 재배치
- `대시보드`, `임대관리`, `교육비`, `월간리포트` 4개 탭 구조 유지
- 입력 피로를 줄이고, 월 단위 요약과 반복 입력 자동화를 우선

## 앱 전체 구조

```text
HomeManagerApp
└─ MainTabView
   ├─ DashboardTab
   ├─ RentalTab
   ├─ EducationTab
   └─ ReportTab
```

## 탭별 역할

### 1. 대시보드

- 현재 선택 월 기준 요약
- 임대 월세 수입
- 대출이자
- 임대 순수익
- 교육비
- 최종 순흐름
- 건물별 현황
- 자녀1 / 자녀2 교육비 현황

### 2. 임대관리

- 건물 목록
- 건물 상세
- 호실 관리
- 호실 상세 입력
- 월세 기록

권장 흐름:

```text
건물 목록
→ 건물 상세
→ 호실 관리
→ 호실 상세
→ 월세 기록
```

### 3. 교육비

- 월별 교육비 요약
- 등록 학원 관리
- 등록 학원으로 빠른 입력
- 기타 교육비 직접 입력
- 이번 달 기록
- 연간 월별 기록 확인

권장 흐름:

```text
교육비 홈
→ 학원 관리
→ 학원 빠른 입력
→ 기타 직접 입력
```

### 4. 월간리포트

- 월 선택
- 임대 수입 / 이자 / 순수익
- 자녀별 교육비
- 전체 교육비
- 최종 순흐름
- 공유 / PDF 내보내기

## SwiftData 모델

필수 모델:

1. `Building`
2. `Room`
3. `RentRecord`
4. `BuildingMonthlyFinance`
5. `Academy`
6. `EducationEntry`

### 관계 요약

```text
Building
├─ [Room]
└─ [BuildingMonthlyFinance]

Room
└─ [RentRecord]

Academy
└─ [EducationEntry] (optional)
```

## ViewModel 구조

### DashboardViewModel

- 선택 월 상태
- 임대 월수입 합계
- 대출이자 합계
- 임대 순수익
- 자녀1 / 자녀2 교육비
- 전체 교육비
- 최종 순흐름
- 건물별 월 현황

### RentalViewModel

- 건물 목록 관리
- 건물 추가 / 수정 / 삭제
- 호실 생성 / 정렬 / 상태 변경
- 호실별 합계 계산
- 월세 기록 저장
- 월별 대출이자 저장

### EducationViewModel

- 선택 월 상태
- 학원 등록 / 수정 / 삭제
- 자녀별 학원 그룹 표시
- 학원 빠른 입력
- 기타 교육비 입력
- 자녀별 합계
- 연간 합계

### ReportViewModel

- 월간 결산 계산
- 임대 / 교육비 통합 요약
- 출력 / 공유용 데이터 정리

## 서비스 구조

초기 권장 서비스:

- `StorageService`
  - SwiftData 저장 / 조회 래퍼
- `ReportService`
  - 월별 요약 계산
- `FormatterService`
  - 통화 / 날짜 포맷
- `BackupService`
  - JSON 백업 / 복원

## 폴더 구조

```text
HomeManager/
├─ App/
│  ├─ HomeManagerApp.swift
│  └─ MainTabView.swift
├─ Models/
├─ Views/
│  ├─ Dashboard/
│  ├─ Rental/
│  ├─ Education/
│  ├─ Report/
│  └─ Shared/
├─ ViewModels/
├─ Services/
├─ Data/
└─ Extensions/
```

## 1차 구현 우선순위

1. `MainTabView`
2. `DashboardView`
3. `BuildingListView`
4. `BuildingDetailView`
5. `EducationHomeView`
6. `RentRecordView`
7. `MonthlyReportView`

## UI 원칙

- 한 화면에 너무 많은 입력칸을 넣지 않기
- 웹앱의 큰 표는 카드형 / 리스트형으로 재구성
- 날짜는 iOS 입력 방식 우선
- 숫자 입력은 숫자 키패드 사용
- 반복 입력은 등록 정보 선택 기반으로 단순화
- 대시보드는 보기 중심, 입력은 상세 화면으로 이동

## 웹앱과 달라지는 점

- 웹앱의 한 페이지 구조를 그대로 쓰지 않음
- 아이폰에서는 화면 이동 중심으로 재배치
- `localStorage` 대신 `SwiftData` 사용
- 백업 / 공유는 iOS 공유 시트로 전환

## 다음 단계

이 문서를 기준으로 실제 구현에 들어갈 때는 아래 순서로 진행합니다.

1. SwiftData 모델 파일 생성
2. `MainTabView` 생성
3. `DashboardView` 뼈대 생성
4. `Rental` 탭 건물 목록부터 구현
5. `Education` 탭 홈 화면 구현
6. 월간리포트 연결

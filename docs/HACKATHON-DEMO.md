# 해봄 해커톤 시연 플로우

## Live demo

연구자 워크스페이스는 서버 환경 변수 `HAEBOM_ADMIN_KEY`로 잠깁니다. 참가자는 토스 미니앱 또는 `/p/{joinCode}`로 들어가며, 그 경로는 연구자 키를 쓰지 않습니다.

- Production: https://haebomresearch.vercel.app
- 60초 시드: https://haebomresearch.vercel.app/demo
- 요금 목업: https://haebomresearch.vercel.app/pricing
- GitHub: https://github.com/mainkim/haebom (`main`)

## 해봄으로 만든 예시 (참가자 앱)

- **운동 계획 도우미**: https://exercise-demo-xi.vercel.app/
- 생성형 AI 운동계획 · 개인화 × 어조 실험 런타임
- 발표에서 “해봄으로 실제로 만든 연구 앱” 예시로 사용

## 자료 기반 생성 (RAG)

- 용어: **RAG / Retrieval-Augmented Generation** = 노트북 LLM처럼 **넣은 자료만** 근거로 생성
- 연구 탭 `자료·계보 (RAG)`: 논문 붙여넣기 → 검색 → 자극 초안 (코퍼스 외 거절)
- 계보 그래프: 컬렉션·필터·원형 노드·논문 상세 (ResearchRabbit 스타일)

## Research

1. `/` 또는 `/studies/new` — 연구 아이디어 자연어 입력
2. AI가 OpenAlex 문헌 검색 + 2×2 실험 초안 + RAG 자극
3. `/studies/{id}?tab=design` — AI 도구 사용 기록 확인
4. `?tab=qa` — 설문/행동 측정 연결 · QA
5. `?tab=publish` — 연구자 승인 → Publish → 참여 링크

빠른 경로: `/demo` → **데모 연구 Publish 시드**

## Participant Web Runtime

`/p/{joinCode}`

참여 안내/동의 → (서버 랜덤 배정) → 자극 → 행동과제(클릭) → 사후 설문 → 완료

- condition / treatment / randomization 용어 비노출
- 배정된 stimulus만 전달
- refresh 시 동일 participant 유지 (sessionStorage)

## Research Dashboard

`/studies/{id}/data`

- 조건별 모집 현황
- Participant Timeline
- 클릭 + 설문 응답 동일 Participant ID 연결
- CSV / Codebook / XLSX Export

## Commands

```bash
npm install
npm run demo:reset
npm run dev
npm run e2e:smoke
```

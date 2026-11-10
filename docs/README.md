# 청약 레이더

서울·경기 APT 분양 및 무순위·잔여세대 공고를 모아, 브라우저에만 저장된 개인 조건으로 신청 가능성을 보수적으로 점검하는 모바일 우선 정적 웹앱이다.

## 로컬 실행

```bash
npm install
npm run dev
```

실제 데이터를 받으려면 공공데이터포털의 **Decoding 인증키**를 쉘 환경변수로 설정한 뒤 실행한다. 키를 파일, 코드, 채팅, URL 로그에 남기지 않는다. 청약 공고에는 [청약홈 분양정보 조회 서비스](https://www.data.go.kr/data/15098547/openapi.do), 시세차익에는 별도로 [아파트 매매 실거래가 상세 자료](https://www.data.go.kr/data/15126468/openapi.do) 활용신청이 필요하다. 후자의 권한이 없으면 공고 수집은 정상 동작하고 시세차익만 `산출 불가`로 표시된다.

```bash
export DATA_GO_KR_KEY='직접 입력한 키'
npm run update:data
npm test
npm run build
```

키가 없으면 수집 스크립트는 명확한 오류로 종료한다. API 오류·쿼터 초과·빈 결과가 발생하면 기존 `data/announcements.json`의 정상 공고 목록을 유지한다.

## GitHub Pages 설정

1. 새 **Public** 저장소를 만들고 이 폴더를 push한다. `profile.local.json`, `.env`, API 키, 실제 소득·자산 값은 절대 커밋하지 않는다.
2. 저장소의 **Settings → Secrets and variables → Actions → New repository secret**에서 `DATA_GO_KR_KEY`를 만든다.
3. **Settings → Pages → Build and deployment → Source**를 `GitHub Actions`로 선택한다.
4. **Actions → 청약 공고 갱신 및 Pages 배포 → Run workflow**로 첫 실행을 확인한다.
5. 이후 매일 07:00 KST에 공개 데이터가 갱신되고, 테스트·빌드가 성공한 경우 Pages가 배포된다.

## 개인정보 보호

- 프로필은 최초 입력 후 브라우저 `localStorage`에만 저장된다.
- 저장소에는 가짜 값만 있는 `profile.example.json`만 둔다.
- 분석도구·광고·서드파티 트래커를 사용하지 않는다.
- URL, 콘솔 로그, Actions 로그, 공공 API 요청에 프로필을 포함하지 않는다.
- 화면 하단의 “이 기기의 내 조건 삭제”로 로컬 값을 지울 수 있다.

## 가정

- 1단계 범위는 청약홈 APT 분양정보와 APT 잔여세대다. 오피스텔·도시형·민간임대 및 LH/SH 별도 수집은 2단계다.
- API가 공고문 전체 자격요건을 제공하지 않으므로, 확인되지 않은 조건이 하나라도 있으면 `⚠️ 확인 필요`다.
- 생애최초 단독세대주는 2026-06-15 시행 규칙에 따라 전용 60㎡ 이하 여부를 먼저 검사하고, 소득·자산·소득세 납부 이력이 모두 검증되기 전에는 가능으로 확정하지 않는다.
- 시세차익은 동일 시·군·구의 최근 6개월 유사면적 거래가 3건 이상이고 분양가가 있을 때만 계산한다. 지역·연식·역세권·층·동 차이를 완전히 보정하지 못하므로 항상 “추정”이다.
- 공고별 규제지역·지역우선·예치금·재당첨·전매·거주의무 정보는 공고문 구조화가 추가되기 전까지 확인 필요로 남긴다.
- 샘플 데이터는 UI 검증용 합성 데이터이며 실제 단지나 가격이 아니다.

## 폴더

- `app/`: React UI와 순수 자격 판정 함수
- `rules/`: 출처가 붙은 규칙 데이터
- `scripts/`: 청약홈·실거래가 수집기
- `data/`: 공개 공고와 공개 가격 데이터
- `docs/`: 규칙 출처와 운영 안내
- `.github/workflows/update.yml`: 07:00 KST 자동 갱신 및 Pages 배포

## 검증

```bash
npm test
npm run build
```

면책: **참고용, 최종 자격은 청약홈 공고문과 순위확인서로 확인**

# FreeTempo

브라우저에서 MIDI 파일을 피아노 롤로 보고, 직접 한 음씩 연주할 수 있는 웹 앱입니다.

- 배포: https://devtoxa.github.io/project-freetempo/
- 저장소: https://github.com/devtoxa/project-freetempo
- 앱 위치: `react-freetempo/`

---

## 개요

**FreeTempo**는 별도 프로그램 설치 없이 브라우저에서 바로 실행되는 MIDI 피아노 롤 플레이어입니다.

MIDI 파일을 불러오면 노트가 캔버스 위에 피아노 롤 형태로 표시되고, 현재 재생 중인 음이 강조됩니다. 자동 재생으로 곡을 들을 수도 있고, 화면 클릭이나 키보드 입력으로 한 음씩 직접 연주할 수도 있습니다.

### 주요 기능

- **MIDI 재생**: `.mid` / `.midi` 파일을 읽어 피아노 롤로 시각화
- **직접 연주**: 화면 클릭 또는 키보드 입력으로 다음 음 그룹 재생
- **자동 재생**: 곡을 처음부터 끝까지 이어서 재생
- **위치 이동**: 슬라이더와 마우스 휠로 재생 위치 이동
- **악기 선택**: Salamander Piano, Synth, Electric Piano, Soft Synth
- **볼륨 조절**: -40 dB ~ 0 dB
- **로컬 파일 추가**: 내 컴퓨터의 MIDI 파일을 즉시 목록에 추가
- **반응형 캔버스**: 화면 크기에 맞춰 피아노 롤 크기 자동 조정
- **QR 접속**: 우측 하단 QR 코드로 모바일 접속

### 기본 MIDI

| 제목 | 아티스트 |
| --- | --- |
| reminiscence | nam-gu-min |
| second run | nam-gu-min |
| shining light | djmax respect v |

---

## 개발 동기

MIDI 파일은 음악을 구성하는 음높이와 길이, 타이밍 정보를 담고 있습니다. 하지만 일반적인 플레이어에서는 이런 정보가 소리로만 재생되어, 음이 어떻게 움직이는지 눈으로 확인하기 어렵습니다.

FreeTempo는 다음 경험에 집중했습니다.

- MIDI의 노트 흐름을 **피아노 롤**로 직관적으로 보여주기
- 재생을 멈추고 **원하는 음부터 직접 짚어가며** 연주해보기
- DAW 같은 무거운 도구 없이 **브라우저에서 가볍게** 시작하기
- 웹 오디오(Tone.js)와 캔버스 렌더링을 실제 서비스 형태로 구현해보기

즉, "듣는 MIDI"를 "보고 만지는 MIDI"로 바꾸는 작은 실험입니다.

---

## 개발 환경

| 구분 | 내용 |
| --- | --- |
| 운영체제 | Windows |
| 런타임 | Node.js (Vite 8 기준 20.19+ / 22.12+ 권장) |
| 패키지 매니저 | npm |
| 프레임워크 | React 19.3 |
| 빌드 도구 | Vite 8.3 |
| 오디오 | Tone.js 15.1 |
| MIDI 파싱 | @tonejs/midi 2.0 |
| 상태 관리 | Zustand 5.1 |
| 렌더링 | HTML Canvas 2D |
| 린트 | ESLint 10 |
| 배포 | gh-pages (GitHub Pages) |
| 부가 도구 | Python + segno (QR 코드 생성) |

### 실행 방법

```bash
cd react-freetempo
npm install
npm run dev
```

### 사용 가능한 스크립트

```bash
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run preview  # 빌드 결과 미리보기
npm run lint     # ESLint 검사
npm run deploy   # 빌드 후 GitHub Pages 배포
```

---

## 구현

### 프로젝트 구조

```text
project-freetempo/
├─ react-freetempo/          # 메인 웹 앱
│  ├─ src/
│  │  ├─ components/
│  │  │  ├─ Freetempo.jsx        # 전체 화면 구성
│  │  │  ├─ TopMenu.jsx          # 상단 토글 메뉴
│  │  │  ├─ Info.jsx             # 현재 곡 정보
│  │  │  ├─ MidiSelector.jsx     # MIDI 선택 / 로컬 파일 추가
│  │  │  ├─ SoundFontSelector.jsx# 악기 선택
│  │  │  ├─ TrackController.jsx  # 재생 / 위치 / 볼륨 컨트롤
│  │  │  └─ Track.jsx            # MIDI 로딩, 재생, 캔버스 렌더링
│  │  ├─ stores/
│  │  │  └─ useData.jsx          # Zustand 전역 상태
│  │  ├─ audio/
│  │  │  └─ synthMap.js          # Synth / FMSynth / AMSynth 매핑
│  │  ├─ midi/                   # 기본 MIDI 파일 3곡
│  │  ├─ qr.png                  # 배포 URL QR 코드
│  │  └─ App.css                 # 화면 스타일
│  └─ vite.config.js
├─ qr-generator/
│  └─ main.py                 # segno로 QR 코드 생성
└─ README.md
```

### 핵심 구현

#### 1. MIDI 로딩과 노트 그룹화

`Track.jsx`에서 `@tonejs/midi`의 `Midi.fromUrl()`로 MIDI를 읽습니다.

- 모든 트랙의 노트를 하나의 배열로 합침
- 시간 기준으로 정렬
- 거의 같은 시점(20ms 이내)의 노트를 하나의 그룹으로 묶음
- 그룹 단위로 재생하고 캔버스에서 강조

노트 그룹 덕분에 코드(화음)처럼 동시에 울리는 음을 한 번에 처리할 수 있습니다.

#### 2. 피아노 롤 렌더링

`Track.jsx`의 캔버스 렌더링 루프에서 다음 규칙으로 노트를 그립니다.

- 가로축: 시간(`note.time`) × 초당 픽셀(`bpm / 60 × pixelsPerBeat`)
- 세로축: MIDI 음높이를 곡의 최저~최고 음 범위로 정규화
- 현재 재생 중인 그룹: `goldenrod` 색으로 강조
- 지나간 노트: 왼쪽 경계에서 서서히 투명해짐
- 재생 중인 음이 화면 왼쪽 앵커에 머물도록 카메라를 부드럽게 이동

`devicePixelRatio`를 반영해 고해상도 화면에서도 선명하게 표시하고, `ResizeObserver`로 화면 크기 변경에 대응합니다.

#### 3. 소리와 악기

- 브라우저 정책상 오디오는 사용자 입력 이후 `Tone.start()`로 시작
- Salamander Piano는 `Tone.Sampler`로 실제 피아노 샘플 재생
- Synth, Electric Piano, Soft Synth는 각각 `Tone.Synth`, `Tone.FMSynth`, `Tone.AMSynth`를 `PolySynth`로 감싸 사용
- 볼륨은 악기 재생성 없이 `volume.value`에 실시간 반영
- 음이 겹칠 수 있으므로 `PolySynth` 사용

#### 4. 조작 방식

- **클릭 / 터치**: 다음 노트 그룹을 즉시 재생
- **키보드**: 입력할 때마다 다음 노트 그룹 재생
- **마우스 휠**: 재생 위치를 앞뒤로 이동(스크롤 중에는 소리 없음)
- **자동 재생**: `Tone.now()` 기준으로 다음 그룹을 스케줄링
- **슬라이더**: `seekVersion`을 증가시켜 커서와 재생 위치를 즉시 동기화

#### 5. 상태 관리

`Zustand` 스토어(`useData.jsx`)에서 다음 상태를 관리합니다.

- 현재 MIDI / 악기
- 자동 재생 여부와 세션 ID
- 현재 스텝 / 전체 스텝
- 볼륨
- seek 버전
- 로컬에서 추가한 MIDI 목록

#### 6. 로컬 MIDI 추가

`MidiSelector.jsx`에서 `.mid`, `.midi` 확장자를 검사한 뒤 `URL.createObjectURL()`로 blob URL을 만들어 목록에 추가합니다. 서버 업로드 없이 브라우저 세션 안에서만 동작합니다.

#### 7. QR 코드

`qr-generator/main.py`에서 `segno`로 배포 URL의 QR 코드를 생성합니다.

```python
import segno

qr = segno.make("https://devtoxa.github.io/project-freetempo/")
qr.save("qr.png", scale=5)
```

생성된 QR 이미지는 앱 우측 하단에 표시되며, 600px 이하 화면에서는 숨겨집니다.

---

## 배포

GitHub Pages와 `gh-pages` 패키지를 사용합니다.

### 배포 설정

`vite.config.js`에서 저장소 이름에 맞게 base 경로를 지정했습니다.

```js
export default defineConfig({
  plugins: [react()],
  base: '/project-freetempo/',
})
```

### 배포 명령

```bash
cd react-freetempo
npm run deploy
```

`predeploy`에서 `npm run build`가 먼저 실행되고, `dist` 폴더가 `gh-pages` 브랜치로 배포됩니다.

- 배포 URL: https://devtoxa.github.io/project-freetempo/
- QR 코드도 같은 URL을 가리킵니다.

---

## 테스트

현재 별도의 자동화 테스트 도구(Jest, Vitest 등)는 설정되어 있지 않습니다. 대신 정적 검사와 수동 테스트 체크리스트로 검증합니다.

### 정적 검사

```bash
cd react-freetempo
npm run lint
npm run build
```

- ESLint 규칙 위반 여부 확인
- 프로덕션 빌드 성공 여부 확인

### 수동 테스트 체크리스트

#### 기본 재생

- [ ] 기본 MIDI 3곡이 목록에 표시된다
- [ ] 곡을 선택하면 노트가 피아노 롤로 표시된다
- [ ] 첫 클릭/키 입력 시 오디오가 정상적으로 시작된다
- [ ] 자동 재생이 처음부터 끝까지 이어진다
- [ ] 정지 후 다시 재생하면 현재 위치에서 이어진다

#### 조작

- [ ] 클릭/터치로 한 음 그룹씩 진행된다
- [ ] 키보드 입력으로 한 음 그룹씩 진행된다
- [ ] 마우스 휠로 앞뒤 위치 이동이 된다
- [ ] 위치 슬라이더 이동 시 커서가 즉시 반영된다
- [ ] "처음으로" 버튼이 동작한다
- [ ] 볼륨 슬라이더가 실시간으로 반영된다

#### 악기

- [ ] Salamander Piano 선택 시 샘플 피아노 소리가 난다
- [ ] Synth / Electric Piano / Soft Synth 선택 시 소리가 바뀐다
- [ ] 악기를 바꿔도 재생 위치가 유지된다

#### MIDI 파일

- [ ] 로컬 `.mid` 파일을 추가할 수 있다
- [ ] `.mid` / `.midi`가 아닌 파일은 오류 메시지가 표시된다
- [ ] 같은 파일을 다시 선택해도 정상 동작한다
- [ ] 노트가 없는 MIDI는 오류로 안내된다

#### 화면 / 반응형

- [ ] 창 크기를 변경해도 캔버스가 깨지지 않는다
- [ ] 고해상도(HiDPI) 화면에서 노트가 선명하다
- [ ] 모바일 화면에서 QR 코드가 숨겨진다
- [ ] 상단 메뉴 열기/닫기가 정상 동작한다

### 향후 테스트

- `groupNotesByTime()`의 동시 타이밍 그룹화 단위 테스트
- `resolveMidiURL()`의 경로 해석 테스트
- 자동 재생 스케줄링과 seek 동기화 테스트
- Canvas 렌더링 결과 스냅샷 테스트

---

## 알려진 제약

- Web Audio API 특성상 사용자 입력 전에는 소리가 나지 않습니다.
- Salamander Piano 샘플은 외부 URL에서 로드하므로 네트워크가 필요합니다.
- 로컬에서 추가한 MIDI는 blob URL 기반이라 새로고침하면 사라집니다.
- 매우 큰 MIDI 파일은 노트 수가 많아 렌더링/재생 성능이 떨어질 수 있습니다.
- QR 코드는 작은 화면에서 표시되지 않습니다.

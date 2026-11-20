import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';

import { useData } from '../stores/useData';
import { synthMap } from '../audio/synthMap';

// ==========================================
// 기본 설정
// ==========================================

const DEFAULT_BPM = 120;

const MIN_MIDI = 21;
const MAX_MIDI = 108;

const NOTE_HEIGHT = 12;
const NOTE_WIDTH = 20;

// Canvas 내부 여백 설정
const PADDING_X = 24;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 18;

const DEFAULT_MOVE_MS = 220;
const MANUAL_MOVE_MS = 110;


// ==========================================
// MIDI 파일 경로
// ==========================================

const midiUrls = import.meta.glob('../midi/*.mid', {
    eager: true,
    query: '?url',
    import: 'default',
});

function resolveMidiURL(midiUrl) {
    if (!midiUrl) return null;

    const filename = midiUrl.split('/').pop();

    return (
        midiUrls[`../midi/${filename}`] ||
        midiUrl
    );
}


// ==========================================
// 악기 생성
// ==========================================

function createInstrument(font) {
    if (font?.type === 'sampler') {
        return new Tone.Sampler({
            urls: font.urls,
            baseUrl: font.baseUrl,
            release: 1,
        }).toDestination();
    }

    const Voice = synthMap[font?.type] ?? Tone.Synth;

    return new Tone.PolySynth(Voice).toDestination();
}


// ==========================================
// MIDI 노트 그룹화
// ==========================================

function groupNotesByTime(notes, threshold = 0.02) {
    const groups = [];

    for (const note of notes) {
        const lastGroup = groups[groups.length - 1];

        if (!lastGroup) {
            groups.push([note]);
            continue;
        }

        const groupTime = lastGroup[0].time;

        if (Math.abs(note.time - groupTime) <= threshold) {
            lastGroup.push(note);
        } else {
            groups.push([note]);
        }
    }

    return groups;
}


// ==========================================
// Track Component
// ==========================================

const Track = () => {
    // --------------------------------------
    // Zustand 상태
    // --------------------------------------

    const soundFontList = useData((state) => state.soundFontList ?? []);
    const currentSoundFontId = useData((state) => state.currentSoundFontId);
    const currentMidiId = useData((state) => state.currentMidiId);
    const midiList = useData((state) => state.midiList ?? []);
    const isAutoPlay = useData((state) => state.isAutoPlay);
    const autoPlaySessionId = useData((state) => state.autoPlaySessionId);
    const storeCurrentStep = useData((state) => state.currentStep);
    const stopAutoPlay = useData((state) => state.stopAutoPlay);
    const setTotalSteps = useData((state) => state.setTotalSteps);
    const setStoreCurrentStep = useData((state) => state.setCurrentStep);
    const seekVersion = useData((state) => state.seekVersion);
    const pixelsPerBeat = useData((state) => state.pixelsPerBeat ?? 80);
    const volume = useData((state) => state.volume ?? -6);


    // --------------------------------------
    // 현재 MIDI / 사운드폰트
    // --------------------------------------

    const currentFont =
        soundFontList.find(
            (font) => Number(font.id) === Number(currentSoundFontId)
        ) ?? soundFontList[0];

    const currentMidi =
        midiList.find(
            (midi) => Number(midi.id) === Number(currentMidiId)
        ) ?? midiList[0];


    // --------------------------------------
    // Ref
    // --------------------------------------

    const synthRef = useRef(null);
    const stepRef = useRef(0);
    const canvasRef = useRef(null);
    const viewportRef = useRef(null);
    const rafIdRef = useRef(null);

    const sizeRef = useRef({
        width: 1280,
        height: 720,
    });

    const autoPlayRef = useRef({
        active: false,
        startAudioSec: 0,
        startSongTime: 0,
    });

    const callbacksRef = useRef({
        playGroup: null,
        stopAutoPlay: null,
        setStoreCurrentStep: null,
    });


    // --------------------------------------
    // React 상태
    // --------------------------------------

    const [notes, setNotes] = useState([]);
    const [bpm, setBpm] = useState(DEFAULT_BPM);
    const [currentStep, setCurrentStep] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);


    // ======================================
    // MIDI 노트 그룹 계산
    // ======================================

    const noteGroups = useMemo(() => groupNotesByTime(notes), [notes]);


    // ======================================
    // MIDI 음역대 계산
    // ======================================

    const midiRange = useMemo(() => {
        if (!notes.length) {
            return {
                minMidi: MIN_MIDI,
                maxMidi: MAX_MIDI,
                midiSpan: MAX_MIDI - MIN_MIDI,
            };
        }

        let min = Infinity;
        let max = -Infinity;

        for (const note of notes) {
            if (note.midi < min) min = note.midi;
            if (note.midi > max) max = note.midi;
        }

        return {
            minMidi: min,
            maxMidi: max,
            midiSpan: Math.max(max - min, 1),
        };
    }, [notes]);


    // ======================================
    // 노트 그룹 간격 계산
    // ======================================

    const maxGroupGapMs = useMemo(() => {
        if (noteGroups.length < 2) {
            return DEFAULT_MOVE_MS;
        }

        let maxGapSec = 0;

        for (let i = 0; i < noteGroups.length - 1; i++) {
            const currentTime = noteGroups[i][0]?.time ?? 0;
            const nextTime = noteGroups[i + 1][0]?.time ?? currentTime;
            const gap = nextTime - currentTime;

            if (gap > maxGapSec) {
                maxGapSec = gap;
            }
        }

        return Math.min(Math.max(maxGapSec * 1000, 140), 420);
    }, [noteGroups]);


    // ======================================
    // 현재 활성 노트
    // ======================================

    const activeGroup = useMemo(() => {
        if (!noteGroups.length) return [];

        const safeIdx = Math.min(
            Math.max(currentStep, 0),
            noteGroups.length - 1
        );

        return noteGroups[safeIdx] ?? [];
    }, [noteGroups, currentStep]);

    const targetCursorTime = activeGroup?.[0]?.time ?? 0;


    // ======================================
    // Canvas 렌더링 상태
    // ======================================

    const renderStateRef = useRef({
        notes: [],
        noteGroups: [],
        bpm: DEFAULT_BPM,
        pixelsPerBeat: 80,
        maxGroupGapMs: DEFAULT_MOVE_MS,
        targetCursorTime: 0,
        midiRange: {
            minMidi: MIN_MIDI,
            maxMidi: MAX_MIDI,
            midiSpan: MAX_MIDI - MIN_MIDI,
        },
        activeUids: new Set(),
        displayCursorTime: 0,
        lastFrameTime: null,
    });


    // --------------------------------------
    // 노트 재생 함수
    // --------------------------------------

    const playGroup = useCallback((group, when) => {
        if (!group || !synthRef.current) {
            return;
        }

        const scheduleTime =
            typeof when === 'number' && Number.isFinite(when)
                ? when
                : undefined;

        for (const note of group) {
            if (!note?.name) {
                continue;
            }

            const duration =
                Number.isFinite(note.duration) && note.duration > 0
                    ? Math.max(note.duration, 0.1)
                    : 0.2;

            synthRef.current.triggerAttackRelease(
                note.name,
                duration,
                scheduleTime,
                note.velocity ?? 0.8
            );
        }
    }, []);


    // --------------------------------------
    // 콜백 및 렌더 상태 동기화
    // --------------------------------------

    useEffect(() => {
        callbacksRef.current = {
            playGroup,
            stopAutoPlay,
            setStoreCurrentStep,
        };
    }, [playGroup, stopAutoPlay, setStoreCurrentStep]);

    useEffect(() => {
        renderStateRef.current.notes = notes;
        renderStateRef.current.noteGroups = noteGroups;
        renderStateRef.current.bpm = bpm;
        renderStateRef.current.pixelsPerBeat = pixelsPerBeat;
        renderStateRef.current.maxGroupGapMs = maxGroupGapMs;
        renderStateRef.current.targetCursorTime = targetCursorTime;
        renderStateRef.current.midiRange = midiRange;
        renderStateRef.current.activeUids = new Set(
            activeGroup.map((note) => note._uid)
        );
    }, [
        notes,
        noteGroups,
        bpm,
        pixelsPerBeat,
        maxGroupGapMs,
        targetCursorTime,
        midiRange,
        activeGroup,
    ]);


    // ======================================
    // MIDI 로딩
    // ======================================

    useEffect(() => {
        if (!currentMidi?.url) {
            setNotes([]);
            setTotalSteps(0);
            setCurrentStep(0);
            setStoreCurrentStep(0);
            return;
        }

        let active = true;

        stopAutoPlay();
        autoPlayRef.current.active = false;

        setLoading(true);
        setError(null);
        setNotes([]);
        setBpm(DEFAULT_BPM);
        setCurrentStep(0);
        setTotalSteps(0);
        setStoreCurrentStep(0);
        stepRef.current = 0;
        renderStateRef.current.displayCursorTime = 0;
        renderStateRef.current.lastFrameTime = null;

        const loadMidi = async () => {
            try {
                const url = resolveMidiURL(currentMidi.url);
                const midi = await Midi.fromUrl(url);

                if (!active) return;

                const extractedNotes = midi.tracks
                    .flatMap((track, trackIdx) =>
                        track.notes
                            .filter((note) => Boolean(note.name))
                            .map((note, noteIdx) => ({
                                name: note.name,
                                midi: note.midi,
                                time: note.time,
                                duration: note.duration,
                                velocity: note.velocity,
                                _uid: `${trackIdx}-${noteIdx}-${note.midi}-${note.time.toFixed(4)}`,
                            }))
                    )
                    .sort((a, b) => a.time - b.time);

                if (extractedNotes.length === 0) {
                    throw new Error(
                        'MIDI 파일에 재생 가능한 노트가 없습니다.'
                    );
                }

                const midiBpm =
                    midi.header.tempos[0]?.bpm ?? DEFAULT_BPM;
                const groups = groupNotesByTime(extractedNotes);

                if (!active) return;

                setNotes(extractedNotes);
                setBpm(midiBpm);
                setCurrentStep(0);
                setTotalSteps(groups.length);
                setStoreCurrentStep(0);

                stepRef.current = 0;
                renderStateRef.current.displayCursorTime = 0;
                renderStateRef.current.lastFrameTime = null;
            } catch (err) {
                if (!active) return;
                setNotes([]);
                setTotalSteps(0);
                setCurrentStep(0);
                setStoreCurrentStep(0);
                setError(err.message);
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        loadMidi();

        return () => {
            active = false;
        };
    }, [
        currentMidi?.url,
        stopAutoPlay,
        setTotalSteps,
        setStoreCurrentStep,
    ]);


    // ======================================
    // 처음으로 / 슬라이더 동기화
    // ======================================

    useEffect(() => {
        const safeStep = Math.min(
            storeCurrentStep,
            Math.max(noteGroups.length - 1, 0)
        );

        stepRef.current = safeStep;
        setCurrentStep(safeStep);

        if (noteGroups.length > 0) {
            const group = noteGroups[safeStep];
            renderStateRef.current.displayCursorTime =
                group?.[0]?.time ?? 0;
        } else {
            renderStateRef.current.displayCursorTime = 0;
        }
    }, [seekVersion, storeCurrentStep, noteGroups]);


    // ======================================
    // 악기 생성 및 정리
    // ======================================

    useEffect(() => {
        const synth = createInstrument(currentFont);
        synth.volume.value = volume;
        synthRef.current = synth;

        return () => {
            synth.releaseAll?.();
            synth.dispose();

            if (synthRef.current === synth) {
                synthRef.current = null;
            }
        };
    }, [currentFont, volume]);


    // ======================================
    // 볼륨 변경
    // ======================================

    useEffect(() => {
        if (synthRef.current) {
            synthRef.current.volume.value = volume;
        }
    }, [volume]);


    // ======================================
    // 자동 재생
    // ======================================

    useEffect(() => {
        if (!isAutoPlay) {
            autoPlayRef.current.active = false;
            return;
        }

        if (!noteGroups.length || !synthRef.current) {
            stopAutoPlay();
            return;
        }

        let cancelled = false;

        const startPlayback = async () => {
            try {
                if (Tone.getContext().state !== 'running') {
                    await Tone.start();
                }

                if (currentFont?.type === 'sampler') {
                    await Tone.loaded();
                }

                if (cancelled) return;

                const idx = Math.min(
                    stepRef.current,
                    noteGroups.length - 1
                );
                const currentGroup = noteGroups[idx];
                const startSongTime = currentGroup?.[0]?.time ?? 0;
                const startAudioSec = Tone.now();

                playGroup(currentGroup, startAudioSec);

                const nextStep = idx + 1;
                stepRef.current = nextStep;
                setCurrentStep(nextStep);
                setStoreCurrentStep(nextStep);
                renderStateRef.current.displayCursorTime = startSongTime;

                autoPlayRef.current = {
                    active: true,
                    startAudioSec,
                    startSongTime,
                };
            } catch (err) {
                console.error('[Audio] Playback error:', err);
                stopAutoPlay();
            }
        };

        startPlayback();

        return () => {
            cancelled = true;
        };
    }, [
        isAutoPlay,
        autoPlaySessionId,
        noteGroups,
        currentFont?.type,
        playGroup,
        stopAutoPlay,
        setStoreCurrentStep,
    ]);


    // ======================================
    // Canvas 크기 감지
    // ======================================

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) return;

        const updateSize = () => {
            const rect = element.getBoundingClientRect();
            const width = Math.max(Math.floor(rect.width), 200);
            const height = Math.max(Math.floor(rect.height), 200);

            sizeRef.current = { width, height };

            const canvas = canvasRef.current;
            if (canvas) {
                const dpr = window.devicePixelRatio || 1;
                canvas.width = Math.floor(width * dpr);
                canvas.height = Math.floor(height * dpr);
            }
        };

        updateSize();

        const observer = new ResizeObserver(updateSize);
        observer.observe(element);
        window.addEventListener('resize', updateSize);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updateSize);
        };
    }, []);


    // ======================================
    // 키보드 수동 재생
    // ======================================

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.repeat) return;

            const tag = e.target?.tagName;
            if (
                tag === 'INPUT' ||
                tag === 'SELECT' ||
                tag === 'TEXTAREA'
            ) {
                return;
            }

            if (!noteGroups.length || !synthRef.current) {
                return;
            }

            if (autoPlayRef.current.active) {
                autoPlayRef.current.active = false;
                stopAutoPlay();
            }

            const idx = stepRef.current % noteGroups.length;
            const group = noteGroups[idx];
            const nextStep = (idx + 1) % noteGroups.length;

            stepRef.current = nextStep;
            setCurrentStep(nextStep);
            setStoreCurrentStep(nextStep);

            const triggerNotes = () => {
                playGroup(group, Tone.now());
            };

            if (Tone.getContext().state !== 'running') {
                Tone.start()
                    .then(() => {
                        if (currentFont?.type === 'sampler') {
                            return Tone.loaded();
                        }
                    })
                    .then(triggerNotes)
                    .catch((err) => {
                        console.error('[Audio] Keyboard playback error:', err);
                    });
            } else {
                triggerNotes();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        noteGroups,
        currentFont?.type,
        playGroup,
        stopAutoPlay,
        setStoreCurrentStep,
    ]);


    // ======================================
    // Canvas 렌더링 루프
    // ======================================

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const draw = (now) => {
            const state = renderStateRef.current;
            const { width, height } = sizeRef.current;
            const {
                playGroup: runPlayGroup,
                stopAutoPlay: runStopAutoPlay,
                setStoreCurrentStep: runSetStoreStep,
            } = callbacksRef.current;

            const dpr = window.devicePixelRatio || 1;
            const targetW = Math.floor(width * dpr);
            const targetH = Math.floor(height * dpr);

            if (
                canvas.width !== targetW ||
                canvas.height !== targetH
            ) {
                canvas.width = targetW;
                canvas.height = targetH;
            }

            const dtMs =
                state.lastFrameTime == null
                    ? 16.67
                    : Math.min(Math.max(now - state.lastFrameTime, 1), 32);
            state.lastFrameTime = now;

            if (
                autoPlayRef.current.active &&
                state.noteGroups.length > 0
            ) {
                const nowAudioSec = Tone.now();
                const elapsedSec = Math.max(
                    nowAudioSec - autoPlayRef.current.startAudioSec,
                    0
                );
                const songTime =
                    autoPlayRef.current.startSongTime + elapsedSec;

                state.displayCursorTime = songTime;

                let idx = stepRef.current % state.noteGroups.length;
                let triggered = false;

                while (idx < state.noteGroups.length) {
                    const nextGroup = state.noteGroups[idx];
                    const groupTime = nextGroup?.[0]?.time ?? Infinity;

                    if (songTime >= groupTime) {
                        const lagSec = Math.max(songTime - groupTime, 0);
                        const scheduledWhen = Math.max(
                            nowAudioSec - lagSec,
                            Tone.now()
                        );

                        runPlayGroup?.(nextGroup, scheduledWhen);
                        idx += 1;
                        triggered = true;
                    } else {
                        break;
                    }
                }

                if (triggered) {
                    if (idx >= state.noteGroups.length) {
                        stepRef.current = 0;
                        setCurrentStep(0);
                        runSetStoreStep?.(0);
                        state.displayCursorTime = 0;
                        autoPlayRef.current.active = false;
                        runStopAutoPlay?.();
                    } else {
                        stepRef.current = idx;
                        setCurrentStep(idx);
                        runSetStoreStep?.(idx);
                    }
                }
            } else {
                const diff =
                    state.targetCursorTime - state.displayCursorTime;

                if (Math.abs(diff) < 0.0005) {
                    state.displayCursorTime = state.targetCursorTime;
                } else {
                    const alpha = 1 - Math.exp(-dtMs / MANUAL_MOVE_MS);
                    state.displayCursorTime += diff * alpha;
                }
            }

            // 배경 클리어
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, width, height);

            // 패딩이 적용된 내부 그리기 영역
            const innerX = PADDING_X;
            const innerY = PADDING_TOP;
            const innerWidth = Math.max(width - PADDING_X * 2, 1);
            const innerHeight = Math.max(
                height - PADDING_TOP - PADDING_BOTTOM,
                1
            );

            ctx.save();
            ctx.beginPath();
            ctx.rect(innerX - 2, innerY - 2, innerWidth + 4, innerHeight + 4);
            ctx.clip();

            const pxPerSec = (state.bpm / 60) * state.pixelsPerBeat;
            const currentNotes = state.notes;
            const { minMidi, midiSpan } = state.midiRange;
            const usableWidth = Math.max(innerWidth - NOTE_WIDTH, 1);
            const usableHeight = Math.max(
                innerHeight - NOTE_HEIGHT,
                1
            );

            // 일반 노트 먼저 그린 뒤 강조(active) 노트를 위에 그려 테두리 가림 방지
            const activeNotesToDraw = [];

            for (let i = 0; i < currentNotes.length; i++) {
                const note = currentNotes[i];
                const deltaSec = note.time - state.displayCursorTime;

                const rawY =
                    innerY +
                    usableHeight -
                    deltaSec * pxPerSec;

                if (
                    rawY + NOTE_HEIGHT < innerY - NOTE_HEIGHT ||
                    rawY > innerY + innerHeight + 40
                ) {
                    continue;
                }

                const midiRatio = Math.min(
                    Math.max((note.midi - minMidi) / midiSpan, 0),
                    1
                );
                const x = innerX + midiRatio * usableWidth;
                const y = Math.min(
                    Math.max(rawY, innerY),
                    innerY + usableHeight
                );

                const isActive = state.activeUids.has(note._uid);

                if (isActive) {
                    activeNotesToDraw.push({ note, x, y });
                    continue;
                }

                const isSharp = note.name?.includes('#');

                ctx.fillStyle = isSharp ? '#b58900' : '#3b82f6';
                ctx.beginPath();
                ctx.rect(x, y, NOTE_WIDTH, NOTE_HEIGHT);
                ctx.fill();

                ctx.lineWidth = 2;
                ctx.strokeStyle = '#0f172a';
                ctx.stroke();
            }

            // 현재 강조 노트 렌더링 (최상단 + 선명한 테두리)
            for (let i = 0; i < activeNotesToDraw.length; i++) {
                const { x, y } = activeNotesToDraw[i];

                ctx.fillStyle = 'goldenrod';
                ctx.beginPath();
                ctx.rect(x, y, NOTE_WIDTH, NOTE_HEIGHT);
                ctx.fill();

                ctx.lineWidth = 3;
                ctx.lineJoin = 'round';
                ctx.strokeStyle = '#fff8cc';
                ctx.stroke();
            }

            ctx.restore();

            rafIdRef.current = requestAnimationFrame(draw);
        };

        rafIdRef.current = requestAnimationFrame(draw);

        return () => {
            if (rafIdRef.current != null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
    }, []);


    // ======================================
    // 화면 출력
    // ======================================

    return (
        <div className="Track">
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                }}
            >
                <span>{currentFont?.fontName}</span>
                <span>{currentMidi?.title}</span>
                <span>BPM: {bpm.toFixed(1)}</span>
                <span>
                    진행: {currentStep} / {noteGroups.length}
                </span>
            </div>

            {loading && (
                <div className="track-loading">MIDI 파일 로딩 중...</div>
            )}

            {error && (
                <div
                    className="track-error"
                    style={{
                        color: 'red',
                        padding: '10px',
                    }}
                >
                    MIDI 오류: {error}
                </div>
            )}

            {!loading && !error && (
                <div className="track-info">
                    전체 노트: {notes.length}
                    {' / '}
                    노트 그룹: {noteGroups.length}
                </div>
            )}

            <div
                ref={viewportRef}
                className="track-viewport"
            >
                <canvas
                    ref={canvasRef}
                    style={{
                        display: 'block',
                        width: '100%',
                        height: '100%',
                    }}
                />
            </div>
        </div>
    );
};

export default Track;
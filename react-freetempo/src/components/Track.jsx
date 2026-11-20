import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { useData } from '../stores/useData';
import { synthMap } from '../audio/synthMap';

const DEFAULT_BPM = 120;
const MIN_MIDI = 21;
const MAX_MIDI = 108;

const NOTE_HEIGHT = 12;
const NOTE_WIDTH = 20;
const PADDING = 12;
const DEFAULT_MOVE_MS = 220;

const LOOKAHEAD_SEC = 3.5;
const TOP_WIDTH_RATIO = 0.42;
const BOTTOM_WIDTH_RATIO = 0.94;

const midiUrls = import.meta.glob('../midi/*.mid', {
    eager: true,
    query: '?url',
    import: 'default',
});

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function resolveMidiURL(midiUrl) {
    const filename = midiUrl?.split('/').pop();
    return (filename && midiUrls[`../midi/${filename}`]) || midiUrl;
}

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

const Track = () => {
    const soundFontList = useData((state) => state.soundFontList ?? []);
    const currentSoundFontId = useData((state) => state.currentSoundFontId);
    const currentFont =
        soundFontList.find((soundFont) => Number(soundFont.id) === Number(currentSoundFontId)) ??
        soundFontList[0];

    const currentMidiId = useData((state) => state.currentMidiId);
    const midiList = useData((state) => state.midiList ?? []);
    const currentMidi =
        midiList.find((midi) => Number(midi.id) === Number(currentMidiId)) ??
        midiList[0];

    const pixelsPerBeat = useData((state) => state.pixelsPerBeat ?? 80);
    const volume = useData((state) => state.volume ?? -6);
    const isAutoPlay = useData((state) => state.isAutoPlay);
    const autoPlaySessionId = useData((state) => state.autoPlaySessionId);
    const stopAutoPlay = useData((state) => state.stopAutoPlay);

    const synthRef = useRef(null);
    const stepRef = useRef(0);
    const canvasRef = useRef(null);
    const viewportRef = useRef(null);
    const rafIdRef = useRef(null);
    const sizeRef = useRef({ width: 900, height: 540 });

    const autoPlayRef = useRef({
        active: false,
        startPerfMs: 0,
        startSongTime: 0,
    });

    const [notes, setNotes] = useState([]);
    const [bpm, setBpm] = useState(DEFAULT_BPM);
    const [currentStep, setCurrentStep] = useState(0);

    const noteGroups = useMemo(() => groupNotesByTime(notes), [notes]);

    const midiRange = useMemo(() => {
        if (!notes.length) {
            return { minMidi: MIN_MIDI, maxMidi: MAX_MIDI, midiSpan: Math.max(MAX_MIDI - MIN_MIDI, 1) };
        }
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < notes.length; i++) {
            const m = notes[i].midi;
            if (m < min) min = m;
            if (m > max) max = m;
        }
        return {
            minMidi: min,
            maxMidi: max,
            midiSpan: Math.max(max - min, 1),
        };
    }, [notes]);

    const maxGroupGapMs = useMemo(() => {
        if (noteGroups.length < 2) return DEFAULT_MOVE_MS;

        let maxGapSec = 0;
        for (let i = 0; i < noteGroups.length - 1; i++) {
            const currTime = noteGroups[i][0]?.time ?? 0;
            const nextTime = noteGroups[i + 1][0]?.time ?? currTime;
            const gap = nextTime - currTime;
            if (gap > maxGapSec) maxGapSec = gap;
        }

        return Math.min(Math.max(maxGapSec * 1000, 140), 420);
    }, [noteGroups]);

    const activeGroup = noteGroups.length ? noteGroups[currentStep % noteGroups.length] : [];
    const targetCursorTime = activeGroup?.[0]?.time ?? 0;

    const renderStateRef = useRef({
        notes,
        noteGroups,
        bpm,
        pixelsPerBeat,
        maxGroupGapMs,
        targetCursorTime,
        midiRange,
        activeUids: new Set((activeGroup ?? []).map((n) => n._uid)),
        displayCursorTime: 0,
        lastFrameTime: null,
    });

    useEffect(() => {
        renderStateRef.current.notes = notes;
        renderStateRef.current.noteGroups = noteGroups;
        renderStateRef.current.bpm = bpm;
        renderStateRef.current.pixelsPerBeat = pixelsPerBeat;
        renderStateRef.current.maxGroupGapMs = maxGroupGapMs;
        renderStateRef.current.targetCursorTime = targetCursorTime;
        renderStateRef.current.midiRange = midiRange;
        renderStateRef.current.activeUids = new Set((activeGroup ?? []).map((n) => n._uid));
    }, [notes, noteGroups, bpm, pixelsPerBeat, maxGroupGapMs, targetCursorTime, midiRange, activeGroup]);

    const playGroup = useCallback((group) => {
        if (!group || !synthRef.current) return;
        for (let i = 0; i < group.length; i++) {
            const note = group[i];
            if (!note?.name) continue;
            const dur =
                Number.isFinite(note.duration) && note.duration > 0
                    ? Math.max(note.duration, 0.1)
                    : 0.2;
            synthRef.current.triggerAttackRelease(note.name, dur, undefined, note.velocity ?? 0.8);
        }
    }, []);

    // 스토어의 isAutoPlay 상태 변화에 맞춰 자동 재생 시작/중지 동기화
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

        (async () => {
            if (Tone.getContext().state !== 'running') {
                await Tone.start();
            }
            if (currentFont?.type === 'sampler') {
                await Tone.loaded();
            }
            if (cancelled) return;

            const idx = stepRef.current % noteGroups.length;
            const currentGroup = noteGroups[idx];
            const startSongTime = currentGroup?.[0]?.time ?? 0;

            playGroup(currentGroup);
            const nextStep = (idx + 1) % noteGroups.length;
            stepRef.current = nextStep;
            setCurrentStep(nextStep);

            renderStateRef.current.displayCursorTime = startSongTime;
            autoPlayRef.current = {
                active: true,
                startPerfMs: performance.now(),
                startSongTime,
            };
        })();

        return () => {
            cancelled = true;
        };
    }, [isAutoPlay, autoPlaySessionId, noteGroups, currentFont?.type, playGroup, stopAutoPlay]);

    // 컨테이너 크기 변화 감지
    useEffect(() => {
        const el = viewportRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
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
        observer.observe(el);
        window.addEventListener('resize', updateSize);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updateSize);
        };
    }, []);

    // 사운드폰트 인스턴스 생성 및 정리
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
    }, [currentFont?.type]);

    useEffect(() => {
        if (synthRef.current) {
            synthRef.current.volume.value = volume;
        }
    }, [volume]);

    // MIDI 파일 로드 및 초기화
    useEffect(() => {
        if (!currentMidi?.url) return;
        let active = true;
        stopAutoPlay();

        (async () => {
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

            const midiBpm = midi.header.tempos[0]?.bpm || DEFAULT_BPM;

            setNotes(extractedNotes);
            setBpm(midiBpm);
            stepRef.current = 0;
            setCurrentStep(0);
            renderStateRef.current.displayCursorTime = 0;
            renderStateRef.current.lastFrameTime = null;
        })();

        return () => {
            active = false;
        };
    }, [currentMidi?.url, stopAutoPlay]);

    // 키 입력 시 자동 재생 해제 후 수동 모드 연주
    useEffect(() => {
        const handleKeyDown = async (e) => {
            if (e.repeat) return;

            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

            if (!noteGroups.length || !synthRef.current) return;

            if (autoPlayRef.current.active) {
                autoPlayRef.current.active = false;
                stopAutoPlay();
            }

            if (Tone.getContext().state !== 'running') {
                await Tone.start();
            }
            if (currentFont?.type === 'sampler') {
                await Tone.loaded();
            }

            const idx = stepRef.current % noteGroups.length;
            const group = noteGroups[idx];
            playGroup(group);

            const nextStep = (idx + 1) % noteGroups.length;
            stepRef.current = nextStep;
            setCurrentStep(nextStep);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [noteGroups, currentFont?.type, playGroup, stopAutoPlay]);

    // requestAnimationFrame 렌더링 루프
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const draw = (now) => {
            const state = renderStateRef.current;
            const { width, height } = sizeRef.current;

            const dpr = window.devicePixelRatio || 1;
            const targetW = Math.floor(width * dpr);
            const targetH = Math.floor(height * dpr);
            if (canvas.width !== targetW || canvas.height !== targetH) {
                canvas.width = targetW;
                canvas.height = targetH;
            }

            const dtMs = state.lastFrameTime == null ? 16.67 : Math.min(now - state.lastFrameTime, 50);
            state.lastFrameTime = now;

            if (autoPlayRef.current.active && state.noteGroups.length > 0) {
                const elapsedSec = (now - autoPlayRef.current.startPerfMs) / 1000;
                const songTime = autoPlayRef.current.startSongTime + elapsedSec;
                state.displayCursorTime = songTime;

                let idx = stepRef.current % state.noteGroups.length;
                let triggered = false;

                while (idx < state.noteGroups.length) {
                    const nextGroup = state.noteGroups[idx];
                    const groupTime = nextGroup?.[0]?.time ?? Infinity;

                    if (songTime >= groupTime) {
                        playGroup(nextGroup);
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
                        state.displayCursorTime = 0;
                        autoPlayRef.current.active = false;
                        stopAutoPlay();
                    } else {
                        stepRef.current = idx;
                        setCurrentStep(idx);
                    }
                }
            } else {
                const diff = state.targetCursorTime - state.displayCursorTime;
                if (Math.abs(diff) < 0.0005) {
                    state.displayCursorTime = state.targetCursorTime;
                } else {
                    const alpha = 1 - Math.exp(-dtMs / Math.max(state.maxGroupGapMs * 0.45, 40));
                    state.displayCursorTime += diff * alpha;
                }
            }

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, width, height);
            ctx.lineJoin = 'round';

            const topPerspectiveY = Math.max(Math.round(height * 0.08), 24);
            const hitLineY = height - Math.max(Math.round(height * 0.08), 36);
            const centerX = width / 2;
            const topHalfW = (width * TOP_WIDTH_RATIO) / 2;
            const bottomHalfW = (width * BOTTOM_WIDTH_RATIO) / 2;
            const gearSpanY = Math.max(hitLineY - topPerspectiveY, 1);
            const uiScale = Math.min(Math.max(width / 960, 0.65), 1.35);

            const getGearBoundsAtT = (t) => {
                const halfW = lerp(topHalfW, bottomHalfW, t);
                return {
                    left: centerX - halfW,
                    right: centerX + halfW,
                    width: halfW * 2,
                };
            };

            const topBounds = getGearBoundsAtT(0);
            const bottomBounds = getGearBoundsAtT(1.08);

            ctx.beginPath();
            ctx.moveTo(topBounds.left, topPerspectiveY);
            ctx.lineTo(topBounds.right, topPerspectiveY);
            ctx.lineTo(bottomBounds.right, topPerspectiveY + gearSpanY * 1.08);
            ctx.lineTo(bottomBounds.left, topPerspectiveY + gearSpanY * 1.08);
            ctx.closePath();
            ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
            ctx.fill();

            const laneCount = 8;
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
            ctx.lineWidth = 1;
            for (let l = 0; l <= laneCount; l++) {
                const ratio = l / laneCount;
                ctx.beginPath();
                ctx.moveTo(lerp(topBounds.left, topBounds.right, ratio), topPerspectiveY);
                ctx.lineTo(lerp(bottomBounds.left, bottomBounds.right, ratio), hitLineY);
                ctx.stroke();
            }

            const currentNotes = state.notes;
            const { minMidi, midiSpan } = state.midiRange;
            const speedScale = Math.max(state.pixelsPerBeat / 80, 0.4);
            const effectiveLookahead = LOOKAHEAD_SEC / speedScale;

            for (let i = 0; i < currentNotes.length; i++) {
                const note = currentNotes[i];
                const deltaSec = note.time - state.displayCursorTime;

                const t = 1 - deltaSec / effectiveLookahead;
                if (t < -0.05 || t > 1.15) continue;

                const clampedT = Math.min(Math.max(t, 0), 1);
                const y = lerp(topPerspectiveY, hitLineY, clampedT);
                const bounds = getGearBoundsAtT(clampedT);

                const perspectiveScale = lerp(0.45, 1.15, clampedT) * uiScale;
                const noteW = NOTE_WIDTH * perspectiveScale;
                const noteH = NOTE_HEIGHT * perspectiveScale;

                const midiRatio = Math.min(Math.max((note.midi - minMidi) / midiSpan, 0), 1);
                const innerPadding = PADDING * perspectiveScale;
                const usableW = Math.max(bounds.width - noteW - innerPadding * 2, 1);
                const x = bounds.left + innerPadding + midiRatio * usableW;

                const isActive = state.activeUids.has(note._uid);
                const isSharp = note.name?.includes('#');

                ctx.fillStyle = isActive ? 'goldenrod' : isSharp ? '#b58900' : '#3b82f6';
                ctx.fillRect(x, y - noteH, noteW, noteH);

                ctx.lineWidth = isActive ? 3 : 2;
                ctx.strokeStyle = isActive ? '#fff8cc' : '#0f172a';
                ctx.strokeRect(x, y - noteH, noteW, noteH);
            }

            const hitBounds = getGearBoundsAtT(1);
            ctx.fillStyle = 'rgba(0, 255, 0, 0.25)';
            ctx.fillRect(hitBounds.left, hitLineY - 6, hitBounds.width, 12);

            ctx.strokeStyle = 'chartreuse';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(hitBounds.left, hitLineY);
            ctx.lineTo(hitBounds.right, hitLineY);
            ctx.stroke();

            rafIdRef.current = requestAnimationFrame(draw);
        };

        rafIdRef.current = requestAnimationFrame(draw);
        return () => {
            if (rafIdRef.current != null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
    }, [playGroup, stopAutoPlay]);

    return (
        <div className="Track">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span>{currentFont?.fontName}</span>
                <span>{currentMidi?.title}</span>
                <span>
                    진행: {currentStep} / {noteGroups.length}
                </span>
            </div>

            <div ref={viewportRef} className="track-viewport">
                <canvas ref={canvasRef} />
            </div>
        </div>
    );
};

export default Track;
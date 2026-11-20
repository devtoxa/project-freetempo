import { useEffect, useMemo, useRef, useState } from 'react';
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
const TRACK_WIDTH = 1000;
const TRACK_HEIGHT = 650;
const HIT_LINE_Y = TRACK_HEIGHT - 50;
const DEFAULT_MOVE_MS = 220;

const LOOKAHEAD_SEC = 3.5;
const TOP_PERSPECTIVE_Y = 48;
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
    const soundFontList = useData((state) => state.soundFontList);
    const currentSoundFontId = useData((state) => state.currentSoundFontId);
    const currentFont =
        soundFontList.find((soundFont) => Number(soundFont.id) === Number(currentSoundFontId)) ??
        soundFontList[0];

    const currentMidiId = useData((state) => state.currentMidiId);
    const midiList = useData((state) => state.midiList);
    const currentMidi =
        midiList.find((midi) => Number(midi.id) === Number(currentMidiId)) ??
        midiList[0];

    const pixelsPerBeat = useData((state) => state.pixelsPerBeat ?? 80);
    const volume = useData((state) => state.volume ?? -6);

    const synthRef = useRef(null);
    const stepRef = useRef(0);
    const canvasRef = useRef(null);
    const rafIdRef = useRef(null);

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
        renderStateRef.current.bpm = bpm;
        renderStateRef.current.pixelsPerBeat = pixelsPerBeat;
        renderStateRef.current.maxGroupGapMs = maxGroupGapMs;
        renderStateRef.current.targetCursorTime = targetCursorTime;
        renderStateRef.current.midiRange = midiRange;
        renderStateRef.current.activeUids = new Set((activeGroup ?? []).map((n) => n._uid));
    }, [notes, bpm, pixelsPerBeat, maxGroupGapMs, targetCursorTime, midiRange, activeGroup]);

    // 사운드폰트 변경 시 악기 인스턴스 생성 및 해제
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

    // 볼륨 동기화
    useEffect(() => {
        if (synthRef.current) {
            synthRef.current.volume.value = volume;
        }
    }, [volume]);

    // 선택된 MIDI 파일 로드 및 노트 추출
    useEffect(() => {
        if (!currentMidi?.url) return;
        let active = true;

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
    }, [currentMidi?.url]);

    // 키 입력으로 현재 노트 그룹 연주 및 스텝 이동
    useEffect(() => {
        const handleKeyDown = async (e) => {
            if (e.repeat) return;

            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

            if (!noteGroups.length || !synthRef.current) return;

            if (Tone.getContext().state !== 'running') {
                await Tone.start();
            }
            if (currentFont?.type === 'sampler') {
                await Tone.loaded();
            }

            const idx = stepRef.current % noteGroups.length;
            const group = noteGroups[idx];

            group.forEach((note) => {
                if (!note?.name) return;
                const dur =
                    Number.isFinite(note.duration) && note.duration > 0
                        ? Math.max(note.duration, 0.1)
                        : 0.2;
                synthRef.current?.triggerAttackRelease(note.name, dur);
            });

            const nextStep = (idx + 1) % noteGroups.length;
            stepRef.current = nextStep;
            setCurrentStep(nextStep);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [noteGroups, currentFont?.type]);

    // requestAnimationFrame으로 사다리꼴 기어 및 노트 렌더링
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = TRACK_WIDTH * dpr;
        canvas.height = TRACK_HEIGHT * dpr;

        const draw = (now) => {
            const state = renderStateRef.current;
            const dtMs = state.lastFrameTime == null ? 16.67 : Math.min(now - state.lastFrameTime, 50);
            state.lastFrameTime = now;

            const diff = state.targetCursorTime - state.displayCursorTime;
            if (Math.abs(diff) < 0.0005) {
                state.displayCursorTime = state.targetCursorTime;
            } else {
                const alpha = 1 - Math.exp(-dtMs / Math.max(state.maxGroupGapMs * 0.45, 40));
                state.displayCursorTime += diff * alpha;
            }

            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, TRACK_WIDTH, TRACK_HEIGHT);
            ctx.lineJoin = 'round';

            const centerX = TRACK_WIDTH / 2;
            const topHalfW = (TRACK_WIDTH * TOP_WIDTH_RATIO) / 2;
            const bottomHalfW = (TRACK_WIDTH * BOTTOM_WIDTH_RATIO) / 2;
            const gearSpanY = Math.max(HIT_LINE_Y - TOP_PERSPECTIVE_Y, 1);

            const getGearBoundsAtT = (t) => {
                const halfW = lerp(topHalfW, bottomHalfW, t);
                return {
                    left: centerX - halfW,
                    right: centerX + halfW,
                    width: halfW * 2,
                };
            };

            // 기어 배경
            const topBounds = getGearBoundsAtT(0);
            const bottomBounds = getGearBoundsAtT(1.08);

            ctx.beginPath();
            ctx.moveTo(topBounds.left, TOP_PERSPECTIVE_Y);
            ctx.lineTo(topBounds.right, TOP_PERSPECTIVE_Y);
            ctx.lineTo(bottomBounds.right, TOP_PERSPECTIVE_Y + gearSpanY * 1.08);
            ctx.lineTo(bottomBounds.left, TOP_PERSPECTIVE_Y + gearSpanY * 1.08);
            ctx.closePath();
            ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
            ctx.fill();

            // 원근 레인 가이드 라인
            const laneCount = 8;
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
            ctx.lineWidth = 1;
            for (let l = 0; l <= laneCount; l++) {
                const ratio = l / laneCount;
                ctx.beginPath();
                ctx.moveTo(lerp(topBounds.left, topBounds.right, ratio), TOP_PERSPECTIVE_Y);
                ctx.lineTo(lerp(bottomBounds.left, bottomBounds.right, ratio), HIT_LINE_Y);
                ctx.stroke();
            }

            // 노트 투영 렌더링
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
                const y = lerp(TOP_PERSPECTIVE_Y, HIT_LINE_Y, clampedT);
                const bounds = getGearBoundsAtT(clampedT);

                const perspectiveScale = lerp(0.45, 1.15, clampedT);
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

            // 판정선
            const hitBounds = getGearBoundsAtT(1);
            ctx.fillStyle = 'rgba(0, 255, 0, 0.25)';
            ctx.fillRect(hitBounds.left, HIT_LINE_Y - 6, hitBounds.width, 12);

            ctx.strokeStyle = 'chartreuse';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(hitBounds.left, HIT_LINE_Y);
            ctx.lineTo(hitBounds.right, HIT_LINE_Y);
            ctx.stroke();

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

    const handleTestSound = async () => {
        if (Tone.getContext().state !== 'running') {
            await Tone.start();
        }
        if (currentFont?.type === 'sampler') {
            await Tone.loaded();
        }
        synthRef.current?.triggerAttackRelease(['C4', 'E4', 'G4'], '8n');
    };

    return (
        <div className="Track">
            <p>{currentFont?.fontName}</p>
            <p>{currentMidi?.title}</p>
            <p>
                진행: {currentStep} / {noteGroups.length}
            </p>
            <button type="button" onClick={handleTestSound}>
                테스트 재생
            </button>

            <div className="track-viewport" style={{ width: `${TRACK_WIDTH}px`, height: `${TRACK_HEIGHT}px` }}>
                <canvas
                    ref={canvasRef}
                    style={{ width: `${TRACK_WIDTH}px`, height: `${TRACK_HEIGHT}px`, display: 'block' }}
                />
            </div>
        </div>
    );
};

export default Track;
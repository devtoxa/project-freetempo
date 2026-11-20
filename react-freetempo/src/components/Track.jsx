import { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { useData } from '../stores/useData';
import { synthMap } from '../audio/synthMap';

const DEFAULT_PIXELS_PER_BEAT = 80;
const DEFAULT_BPM = 120;
const DEFAULT_VOLUME = -6; // dB (-40 ~ 0)
const MIN_MIDI = 21;
const MAX_MIDI = 108;

const NOTE_HEIGHT = 12;
const NOTE_WIDTH = 20;
const PADDING = 12;
const TRACK_WIDTH = 1200;
const TRACK_HEIGHT = 600;
const HIT_LINE_Y = TRACK_HEIGHT - 50;
const DEFAULT_MOVE_MS = 220;

const midiUrls = import.meta.glob('../midi/*.mid', {
    eager: true,
    query: '?url',
    import: 'default',
});

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

    const synthRef = useRef(null);
    const stepRef = useRef(0);
    const canvasRef = useRef(null);
    const rafIdRef = useRef(null);

    const [notes, setNotes] = useState([]);
    const [bpm, setBpm] = useState(DEFAULT_BPM);
    const [currentStep, setCurrentStep] = useState(0);
    const [pixelsPerBeat, setPixelsPerBeat] = useState(DEFAULT_PIXELS_PER_BEAT);
    const [volume, setVolume] = useState(DEFAULT_VOLUME);

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

    // 캔버스 루프에서 최신 값에 접근하기 위한 Ref 동기화
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

    // 사운드폰트 변경 시 악기 생성 및 해제
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

    // MIDI 로드 및 노트 추출
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

    // 키 입력으로 한 스텝 전진 및 연주
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

    // requestAnimationFrame으로 캔버스에 노트와 판정선 페인팅
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

            // 목표 커서 시간으로 부드럽게 보간
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

            const currentNotes = state.notes;
            const beatsPerSecond = state.bpm / 60;
            const pxPerBeat = state.pixelsPerBeat;
            const { minMidi, midiSpan } = state.midiRange;
            const usableWidth = Math.max(TRACK_WIDTH - NOTE_WIDTH - PADDING * 2, 1);

            for (let i = 0; i < currentNotes.length; i++) {
                const note = currentNotes[i];
                const isActive = state.activeUids.has(note._uid);
                const isSharp = note.name?.includes('#');

                const midiRatio = Math.min(Math.max((note.midi - minMidi) / midiSpan, 0), 1);
                const x = PADDING + midiRatio * usableWidth;

                const deltaSec = note.time - state.displayCursorTime;
                const y = HIT_LINE_Y - deltaSec * beatsPerSecond * pxPerBeat - NOTE_HEIGHT;

                // 화면 밖 노트는 스킵
                if (y + NOTE_HEIGHT < -40 || y > TRACK_HEIGHT + 40) continue;

                // 기존 노트 색상 유지
                ctx.fillStyle = isActive ? 'goldenrod' : isSharp ? '#b58900' : '#3b82f6';
                ctx.fillRect(x, y, NOTE_WIDTH, NOTE_HEIGHT);

                // 굵은 테두리 강조
                ctx.lineWidth = isActive ? 3 : 2;
                ctx.strokeStyle = isActive ? '#fff8cc' : '#0f172a';
                ctx.strokeRect(x, y, NOTE_WIDTH, NOTE_HEIGHT);
            }

            // 판정선 오버레이
            ctx.fillStyle = 'rgba(0, 255, 0, 0.25)';
            ctx.fillRect(0, HIT_LINE_Y - 6, TRACK_WIDTH, 12);

            ctx.strokeStyle = 'chartreuse';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, HIT_LINE_Y - 6);
            ctx.lineTo(TRACK_WIDTH, HIT_LINE_Y - 6);
            ctx.moveTo(0, HIT_LINE_Y + 6);
            ctx.lineTo(TRACK_WIDTH, HIT_LINE_Y + 6);
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
        <div>
            <p>{currentFont?.fontName}</p>
            <p>{currentMidi?.title}</p>
            <p>
                진행: {currentStep} / {noteGroups.length}
            </p>
            <button type="button" onClick={handleTestSound}>
                테스트 재생
            </button>

            <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                <label>
                    노트 간격 ({pixelsPerBeat}px/beat):{' '}
                    <input
                        type="range"
                        min={40}
                        max={200}
                        step={10}
                        value={pixelsPerBeat}
                        onChange={(e) => setPixelsPerBeat(Number(e.target.value))}
                    />
                </label>

                <label style={{ marginLeft: '16px' }}>
                    볼륨 ({volume}dB):{' '}
                    <input
                        type="range"
                        min={-40}
                        max={0}
                        step={1}
                        value={volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                    />
                </label>
            </div>

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
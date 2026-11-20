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
const NOTE_HEIGHT = 12; // 원하는 고정 노트 높이(px)
const NOTE_WIDTH = 36;
const PADDING = 12;
const TRACK_WIDTH = 640;
const TRACK_HEIGHT = 480;
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

    const synthRef = useRef(null);
    const stepRef = useRef(0);

    const currentMidiId = useData((state) => state.currentMidiId);
    const midiList = useData((state) => state.midiList);
    const currentMidi =
        midiList.find((midi) => Number(midi.id) === Number(currentMidiId)) ??
        midiList[0];

    const [notes, setNotes] = useState([]);
    const [bpm, setBpm] = useState(DEFAULT_BPM);
    const [currentStep, setCurrentStep] = useState(0);
    const [pixelsPerBeat, setPixelsPerBeat] = useState(DEFAULT_PIXELS_PER_BEAT);
    const [volume, setVolume] = useState(DEFAULT_VOLUME);

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
        })();

        return () => {
            active = false;
        };
    }, [currentMidi?.url]);

    const noteGroups = useMemo(() => groupNotesByTime(notes), [notes]);

    const maxGroupGapMs = useMemo(() => {
        if (noteGroups.length < 2) return DEFAULT_MOVE_MS;

        let maxGapSec = 0;
        for (let i = 0; i < noteGroups.length - 1; i++) {
            const currTime = noteGroups[i][0]?.time ?? 0;
            const nextTime = noteGroups[i + 1][0]?.time ?? currTime;
            const gap = nextTime - currTime;
            if (gap > maxGapSec) maxGapSec = gap;
        }

        return Math.min(Math.max(maxGapSec * 1000, 120), 500);
    }, [noteGroups]);

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

    const handleTestSound = async () => {
        if (Tone.getContext().state !== 'running') {
            await Tone.start();
        }
        if (currentFont?.type === 'sampler') {
            await Tone.loaded();
        }
        synthRef.current?.triggerAttackRelease(['C4', 'E4', 'G4'], '8n');
    };

    const activeGroup = noteGroups.length ? noteGroups[currentStep % noteGroups.length] : [];
    const activeUids = useMemo(
        () => new Set((activeGroup ?? []).map((n) => n._uid)),
        [activeGroup]
    );
    const cursorTime = activeGroup?.[0]?.time ?? 0;

    const beatsPerSecond = bpm / 60;
    const midiValues = notes.map((n) => n.midi);
    const minMidi = midiValues.length ? Math.min(...midiValues) : MIN_MIDI;
    const maxMidi = midiValues.length ? Math.max(...midiValues) : MAX_MIDI;
    const midiSpan = Math.max(maxMidi - minMidi, 1);
    const usableWidth = Math.max(TRACK_WIDTH - NOTE_WIDTH - PADDING * 2, 1);

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

            <div
                className="track-viewport"
                style={{
                    width: `${TRACK_WIDTH}px`,
                    height: `${TRACK_HEIGHT}px`,
                }}
            >
                <div className="track-canvas">
                    <div
                        className="track-hit-line"
                        style={{ top: `${HIT_LINE_Y - 6}px` }}
                    />

                    {notes.map((note) => {
                        const isActive = activeUids.has(note._uid);

                        // X: 음높이(midi)에 따른 좌우 위치
                        const midiRatio = Math.min(Math.max((note.midi - minMidi) / midiSpan, 0), 1);
                        const left = PADDING + midiRatio * usableWidth;

                        // Y: 고정 높이(NOTE_HEIGHT) 기준으로 판정선(HIT_LINE_Y)에 맞춰 배치
                        const deltaSec = note.time - cursorTime;
                        const top = HIT_LINE_Y - deltaSec * beatsPerSecond * pixelsPerBeat - NOTE_HEIGHT;

                        return (
                            <div
                                key={note._uid}
                                className={`track-note${isActive ? ' is-active' : ''}`}
                                style={{
                                    left: `${left}px`,
                                    top: `${top}px`,
                                    width: `${NOTE_WIDTH}px`,
                                    height: `${NOTE_HEIGHT}px`,
                                    lineHeight: `${NOTE_HEIGHT}px`,
                                    transition: `top ${maxGroupGapMs}ms ease-out, background-color ${maxGroupGapMs}ms ease-out`,
                                }}
                            >
                                {note.name}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default Track;
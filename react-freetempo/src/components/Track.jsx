import { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Midi } from '@tonejs/midi';
import { useData } from '../stores/useData';
import { synthMap } from '../audio/synthMap';

const PIXELS_PER_BEAT = 80;
const DEFAULT_BPM = 120;
const MIN_MIDI = 21;
const MAX_MIDI = 108;
const NOTE_WIDTH = 36;
const NOTE_HEIGHT = 12;
const PADDING = 12;
const TRACK_WIDTH = 640;
const TRACK_HEIGHT = 480;
const HIT_LINE_Y = TRACK_HEIGHT - 50; // 아래쪽 기준선 위치
const MIN_NOTE_HEIGHT = 12;
const midiUrls = import.meta.glob('../midi/*.mid', {
    eager: true,
    query: '?url',
    import: 'default',
});

function resolveMidiURL(midiUrl) {
    const filename = midiUrl.split('/').pop();
    return midiUrls[`../midi/${filename}`] || midiUrl;
}

function createInstrument(font) {
    if (font.type === 'sampler') {
        return new Tone.Sampler({
            urls: font.urls,
            baseUrl: font.baseUrl,
            release: 1,
        }).toDestination();
    } else {
        return new Tone.PolySynth(synthMap[font.type]).toDestination();
    }
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
    const currentFont = soundFontList.find((soundFont) => soundFont.id === currentSoundFontId);

    const synthRef = useRef(null);
    const stepRef = useRef(0);

    const currentMidiId = useData((state) => state.currentMidiId);
    const midiList = useData((state) => state.midiList);
    const currentMidi = midiList.find((midi) => midi.id === currentMidiId);

    const [notes, setNotes] = useState([]);
    const [bpm, setBpm] = useState(DEFAULT_BPM);
    const [currentStep, setCurrentStep] = useState(0);

    useEffect(() => {
        const synth = createInstrument(currentFont);
        synthRef.current = synth;
        return () => {
            synth.releaseAll();
            synth.dispose();
        };
    }, [currentFont.type]);

    useEffect(() => {
        (async () => {
            const url = resolveMidiURL(currentMidi.url);
            const midi = await Midi.fromUrl(url);
            const extractedNotes = midi.tracks
                .flatMap((track) => track.notes)
                .sort((a, b) => a.time - b.time);
            const midiBpm = midi.header.tempos[0]?.bpm || DEFAULT_BPM;

            setNotes(extractedNotes);
            setBpm(midiBpm);
            stepRef.current = 0;
            setCurrentStep(0);
        })();
    }, [currentMidi.url]);

    const noteGroups = useMemo(() => groupNotesByTime(notes), [notes]);

    useEffect(() => {
        const handleKeyDown = async (e) => {
            if (e.repeat) return;
            if (!noteGroups.length || !synthRef.current) return;

            await Tone.start();

            const idx = stepRef.current % noteGroups.length;
            const group = noteGroups[idx];

            group.forEach((note) => {
                synthRef.current.triggerAttackRelease(
                    note.name,
                    Math.max(note.duration, 0.1)
                );
            });

            const nextStep = (idx + 1) % noteGroups.length;
            stepRef.current = nextStep;
            setCurrentStep(nextStep);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [noteGroups]);

    const handleTestSound = async () => {
        await Tone.start();
        synthRef.current.triggerAttackRelease(['C4', 'E4', 'G4'], '8n');
    };

    const playedNoteSet = useMemo(() => {
        const set = new Set();
        for (let i = 0; i < currentStep; i++) {
            noteGroups[i]?.forEach((n) => set.add(n));
        }
        return set;
    }, [noteGroups, currentStep]);

    const remainingNotes = useMemo(
        () => notes.filter((n) => !playedNoteSet.has(n)),
        [notes, playedNoteSet]
    );

    const offsetTime =
        currentStep > 0 && noteGroups[currentStep]
            ? noteGroups[currentStep][0].time
            : 0;

    const beatsPerSecond = bpm / 60;
    const totalBeats = remainingNotes.length
        ? Math.max(
            ...remainingNotes.map(
                (n) => (n.time - offsetTime + n.duration) * beatsPerSecond
            )
        )
        : 16;
    const trackWidth = Math.max(totalBeats * PIXELS_PER_BEAT + 120, 800);

    const midiValues = notes.map((n) => n.midi);
    const minMidi = midiValues.length ? Math.min(...midiValues) : MIN_MIDI;
    const maxMidi = midiValues.length ? Math.max(...midiValues) : MAX_MIDI;
    const midiSpan = Math.max(maxMidi - minMidi, 1);
    const usableHeight = TRACK_HEIGHT - NOTE_HEIGHT - PADDING * 2;

    return (
        <div>
            <p>{currentFont.fontName}</p>
            <p>{currentMidi.title}</p>
            <p>
                진행: {currentStep} / {noteGroups.length}
            </p>
            <button type="button" onClick={handleTestSound}>
                테스트 재생
            </button>

            <div className="track-viewport" style={{ position: 'relative', width: `${TRACK_WIDTH}px`, height: `${TRACK_HEIGHT}px`, overflow: 'hidden' }}>
                <div className="track-canvas" style={{ position: 'relative', width: '100%', height: '100%' }}>
                    {remainingNotes.map((note, idx) => {
                        // 1. 가로(X): 음높이(midi)에 따른 좌우 위치
                        const midiRatio = Math.min(Math.max((note.midi - minMidi) / midiSpan, 0), 1);
                        const left = PADDING + midiRatio * (TRACK_WIDTH - NOTE_WIDTH - PADDING * 2);

                        // 2. 세로(Y): 현재 offsetTime 기준으로 위에서 아래로 떨어지는 위치
                        const deltaSec = Math.max(note.time - offsetTime, 0);
                        const height = Math.max(note.duration * beatsPerSecond * PIXELS_PER_BEAT, MIN_NOTE_HEIGHT);
                        const top = HIT_LINE_Y - deltaSec * beatsPerSecond * PIXELS_PER_BEAT - height;

                        return (
                            <div
                                key={note._uid ?? `${note.midi}-${note.time}-${idx}`}
                                style={{
                                    position: 'absolute',
                                    left: `${left}px`,
                                    top: `${top}px`,
                                    width: `${NOTE_WIDTH}px`,
                                    height: `${height}px`,
                                    transition: 'top 0.2s ease-out, opacity 0.2s ease-out',
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
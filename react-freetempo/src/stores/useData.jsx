import { create } from 'zustand';

const midiList = [
    { id: 1, title: 'reminiscence', artist: 'nam-gu-min', filename: 'reminiscence-nam-gu-min.mid' },
    { id: 2, title: 'second run', artist: 'nam-gu-min', filename: 'sekeondeu-leon-namgumin.mid' },
    { id: 3, title: 'shining light', artist: 'djmax respect v', filename: 'syaining-laiteu.mid' },
];

const soundFontList = [
    { id: 1, label: 'Grand Piano' },
    { id: 2, label: 'Electric Piano' },
    { id: 3, label: 'Soft Synth' },
];

export const useData = create((set) => ({
    midiList,
    soundFontList,
    currentSoundFontId: 1,
    currentMidiId: 1,
    setSoundFontId: (id) => set({ currentSoundFont: id }),
    setMidiId: (id) => set({ currentMidi: id })
}));
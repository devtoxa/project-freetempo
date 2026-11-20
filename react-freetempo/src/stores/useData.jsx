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
    currentSoundFont: 1,
    currentMidi: 1,
    setSoundFont: (id) => set({ currentSoundFont: id }),
    setMidi: (id) => set({ currentMidi: id })
}));
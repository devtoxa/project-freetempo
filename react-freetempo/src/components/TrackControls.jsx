import { useData } from '../stores/useData';

export default function TrackControls() {
    const pixelsPerBeat = useData((state) => state.pixelsPerBeat);
    const setPixelsPerBeat = useData((state) => state.setPixelsPerBeat);
    const volume = useData((state) => state.volume);
    const setVolume = useData((state) => state.setVolume);

    return (
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
    );
}
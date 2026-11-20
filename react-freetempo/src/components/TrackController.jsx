import { useData } from '../stores/useData';

export default function TrackController() {
    const isAutoPlay = useData((state) => state.isAutoPlay);
    const toggleAutoPlay = useData((state) => state.toggleAutoPlay);
    const pixelsPerBeat = useData((state) => state.pixelsPerBeat);
    const setPixelsPerBeat = useData((state) => state.setPixelsPerBeat);
    const volume = useData((state) => state.volume);
    const setVolume = useData((state) => state.setVolume);

    const handleToggle = (e) => {
        e.currentTarget.blur(); // 키보드 입력 시 버튼이 스페이스/엔터로 다시 눌리지 않도록 포커스 해제
        toggleAutoPlay();
    };

    return (
        <div className="TrackController">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <button type="button" onClick={handleToggle}>
                    {isAutoPlay ? '자동 재생 정지' : '자동 재생'}
                </button>
                <span>
                    {isAutoPlay ? '자동 재생 중 (아무 키나 누르면 수동 전환)' : '수동 연주'}
                </span>
            </div>

            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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

                <label>
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
        </div>
    );
}
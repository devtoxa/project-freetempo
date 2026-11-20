import Info from './Info';
import Track from './Track';
import MidiSelector from './MidiSelector';
import SoundFontSelector from './SoundFontSelector';
import TrackController from './TrackController';

export default function Freetempo() {
    return (
        <div className="Layout">
            <Info className="Info" />
            <Track className="Track" />
            <div className="Selector">
                <SoundFontSelector className="SoundFontSelector" />
                <MidiSelector className="MidiSelector" />
                <TrackController className="TrackController" />
            </div>
        </div>
    );
}
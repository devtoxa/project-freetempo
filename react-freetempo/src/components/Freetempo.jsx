import '../App.css';
import Info from './Info';
import Track from './Track';
import MidiSelector from './MidiSelector';
import SoundFontSelector from './SoundFontSelector';
import TrackController from './TrackController';

export default function Freetempo() {
    return (
        <div className="Layout">
            <Track className="Track" />

            <Info className="Info" />

            <div className="Selector">
                <SoundFontSelector className="SoundFontSelector" />
                <MidiSelector className="MidiSelector" />
                <TrackController className="TrackController" />
            </div>
        </div>
    );
}
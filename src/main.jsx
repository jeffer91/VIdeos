import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './compact.css';
import './studio.css';
import './format-rules.css';
import './production.css';
import './audit.css';
import './light-theme.css';
import './ux-enhancements.css';
import './ux-bridge.css';
import './project-manager.css';
import './prompter-focus.css';

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

// Runs only when CI launches the packaged executable with --audio-smoke-test.
if (new URLSearchParams(window.location.search).has('audio_smoke_test')) {
  import('./audioSmokeTest')
    .then(({ runAudioSmokeTest }) => runAudioSmokeTest())
    .then((details) => window.videosStudio?.ffmpeg?.reportSmokeTest?.({ success: true, details }))
    .catch((error) => window.videosStudio?.ffmpeg?.reportSmokeTest?.({ success: false, error: String(error?.stack || error) }));
}

import './recording-layout.css';
import './recording-focus.css';
import './vibrant-theme.css';
import './studio-identity.css';

import { useState } from 'react';
import { engineLabel } from './processingPreferences';

export default function ProcessingOptionsPanel({ options, onChange, busy, state, elapsed, progress, onCancel }) {
  const [showDetails, setShowDetails] = useState(false);
  const diagnostics = state?.diagnostics || [];
  const method = state?.method ? engineLabel(state.method) : 'Preparando motor';
  return <section className="processing-options" aria-label="Motor de procesamiento y respaldo">
    <div className="processing-options-heading"><strong>Procesamiento y respaldo</strong><small>Dos motores independientes</small></div>
    <label className="processing-engine-select">Método
      <select value={options.method} disabled={busy} onChange={(event) => onChange({ ...options, method: event.target.value })}>
        <option value="auto">Automático: Windows primero</option>
        <option value="native">FFmpeg nativo</option>
        <option value="wasm">FFmpeg WebAssembly</option>
      </select>
    </label>
    <label className="processing-fallback">
      <input type="checkbox" checked={options.fallback} disabled={busy} onChange={(event) => onChange({ ...options, fallback: event.target.checked })}/>
      <span>Usar el otro motor si falla el primero</span>
    </label>
    {busy && <div className="processing-running" aria-live="polite">
      <div className="processing-running-header">
        <strong>{state?.phase === 'cancelling' ? 'Cancelando…' : state?.phase === 'loading' ? 'Iniciando motor…' : 'Procesando grabación'}</strong>
        <span>{elapsed} s</span>
      </div>
      <small>{method}{Number.isFinite(progress) && progress > 0 ? ' · ' + Math.round(progress * 100) + '%' : ' · esperando avances del motor'}</small>
      <button type="button" className="processing-cancel" onClick={onCancel} disabled={state?.phase === 'cancelling'}>Cancelar de forma segura</button>
    </div>}
    <button type="button" className="processing-diagnostics-button" onClick={() => setShowDetails(!showDetails)}>
      {showDetails ? 'Ocultar diagnóstico' : 'Ver diagnóstico'} {diagnostics.length ? '(' + diagnostics.length + ')' : ''}
    </button>
    {showDetails && <div className="processing-diagnostics">
      <strong>Estado: {state?.phase || 'Sin procesamiento'}</strong>
      <small>{method}</small>
      {diagnostics.length ? diagnostics.map((message, index) => <p key={index}>{message}</p>) : <p>Sin errores. FFmpeg nativo se utiliza primero cuando está disponible.</p>}
    </div>}
  </section>;
}
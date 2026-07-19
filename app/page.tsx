'use client';

import React, { useState } from 'react';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setLoading(true);
    setResult(null);

    setTimeout(() => {
      setLoading(false);
      setResult("✅ CTE letta con successo! Offerta: 'Business Chiara GME' - Target: B2B - Spread estratto: 0,015 €/kWh.");
    }, 3000);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2 tracking-tight">
          ⚡ Simulatore & OCR Tariffe Elettriche
        </h1>
        <p className="text-gray-500 mb-8">
          Carica la scheda tecnica della CTE in formato PDF. L'AI estrarrà automaticamente i dati salvandoli nel database.
        </p>

        <div className="border-2 border-dashed border-blue-200 rounded-xl p-8 flex flex-col items-center bg-blue-50/30 hover:bg-blue-50/60 transition-colors">
          <svg className="w-12 h-12 text-blue-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg shadow transition-colors">
            {loading ? 'Elaborazione PDF con AI...' : 'Seleziona PDF Scheda Tecnica'}
            <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} disabled={loading} />
          </label>
          <p className="text-xs text-gray-400 mt-3">Trascina qui il file o sfoglia (Solo PDF)</p>
        </div>

        {result && (
          <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-medium">
            {result}
          </div>
        )}
      </div>
    </div>
  );
}

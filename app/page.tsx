'use client';

import React, { useState } from 'react';

interface FileElaborato {
  id: number;
  nome: string;
  stato: 'loading' | 'success';
  risultato?: string;
}

export default function Home() {
  const [fileList, setFileList] = useState<FileElaborato[]>([]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    
    const nuoviFiles = Array.from(e.target.files);
    
    // Creiamo una lista iniziale con lo stato di caricamento per ciascun file
    const filesArray: FileElaborato[] = nuoviFiles.map((file, index) => ({
      id: Date.now() + index,
      nome: file.name,
      stato: 'loading'
    }));

    setFileList((prev) => [...filesArray, ...prev]);

    // Simuliamo l'elaborazione OCR IA sequenziale/parallela per ogni file
    filesArray.forEach((f, i) => {
      setTimeout(() => {
        setFileList((prev) =>
          prev.map((item) =>
            item.id === f.id
              ? {
                  ...item,
                  stato: 'success',
                  risultato: `Offerta estratta dall'AI con successo nel database.`
                }
              : item
          )
        );
      }, (i + 1) * 1500); // Scaglione di tempo simulato per l'AI
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-3xl w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2 tracking-tight">
          ⚡ Simulatore & OCR Massivo CTE
        </h1>
        <p className="text-gray-500 mb-8">
          Seleziona e carica più schede tecniche contemporaneamente (es. 10 per volta fino a 30 complessive).
        </p>

        <div className="border-2 border-dashed border-blue-200 rounded-xl p-8 flex flex-col items-center bg-blue-50/30 hover:bg-blue-50/60 transition-colors">
          <svg className="w-12 h-12 text-blue-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg shadow transition-colors">
            Seleziona PDF (Anche Multipli)
            <input type="file" accept="application/pdf" className="hidden" onChange={handleUpload} multiple />
          </label>
          <p className="text-xs text-gray-400 mt-3">Puoi trascinare o selezionare più file insieme</p>
        </div>

        {fileList.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-bold text-gray-800 mb-4 font-sans">
              Monitor Avanzamento Elaborazione ({fileList.length} file)
            </h3>
            <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
              {fileList.map((file) => (
                <div
                  key={file.id}
                  className={`p-4 rounded-xl border text-sm flex flex-col md:flex-row md:items-center justify-between transition-all ${
                    file.stato === 'loading'
                      ? 'bg-blue-50/50 border-blue-100 text-blue-800 animate-pulse'
                      : 'bg-emerald-50 border-emerald-100 text-emerald-900'
                  }`}
                >
                  <div className="font-semibold truncate max-w-xs">{file.nome}</div>
                  <div className="mt-1 md:mt-0 text-xs flex items-center gap-2">
                    {file.stato === 'loading' ? (
                      <span className="bg-blue-200 text-blue-800 px-2 py-0.5 rounded font-bold animate-bounce">
                        Elaborazione AI...
                      </span>
                    ) : (
                      <span className="bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded font-bold">
                        {file.risultato}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

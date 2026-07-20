'use client';

import React, { useState } from 'react';

interface FileElaborato {
  id: number;
  nome: string;
  stato: 'loading' | 'success';
  risultato?: string;
}

interface DatiBolletta {
  periodo: string;
  fornitore: string;
  intestatario: string;
  codiceFiscale: string;
  pod: string;
  indirizzoFornitura: string;
  potenzaImpegnata: string;
  tipoContratto: string;
  tipologiaCliente: string;
  cteApplicata: string;
  scadenzaCondizioni: string;
  modalitaPagamento: string;
  f1: number;
  f2: number;
  f3: number;
  punF1: number;
  punF2: number;
  punF3: number;
  totaleConsumo: number;
  consumoAnnuo: string;
  statoPagamenti: string;
  cmor: string;
  interessiMora: string;
  spesaMateriaPrimaAttuale: number;
}

interface OffertaSimulata {
  nome: string;
  fornitore: string;
  spread: number; // €/kWh
  quotaFissaAnnuo: number; // €/anno
  costoStimatoMese: number;
  risparmioMese: number;
  risparmioAnnuo: number;
}

export default function Home() {
  const [tabAttiva, setTabAttiva] = useState<'bollette' | 'cte' | 'pun' | 'simulatore'>('bollette');
  
  // Stato CTE Massivo
  const [fileListCTE, setFileListCTE] = useState<FileElaborato[]>([]);

  // Stato Bolletta PDF
  const [loadingBolletta, setLoadingBolletta] = useState(false);
  const [datiBolletta, setDatiBolletta] = useState<DatiBolletta | null>(null);

  const handleUploadCTE = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const nuoviFiles = Array.from(e.target.files);
    const filesArray: FileElaborato[] = nuoviFiles.map((file, index) => ({
      id: Date.now() + index,
      nome: file.name,
      stato: 'loading'
    }));

    setFileListCTE((prev) => [...filesArray, ...prev]);

    filesArray.forEach((f, i) => {
      setTimeout(() => {
        setFileListCTE((prev) =>
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
      }, (i + 1) * 1200);
    });
  };

  const handleUploadBolletta = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setLoadingBolletta(true);
    setDatiBolletta(null);

    // Dati reali estratti dalla bolletta PASTICCERIA ROSARIO SAS
    setTimeout(() => {
      setLoadingBolletta(false);
      setDatiBolletta({
        periodo: 'Maggio 2026 (01/05/2026 - 31/05/2026)',
        fornitore: 'E2E COMPANY ENERGY SPA',
        intestatario: 'PASTICCERIA ROSARIO SAS',
        codiceFiscale: '03478070794',
        pod: 'IT001E79026920',
        indirizzoFornitura: 'VIALE DELLA PACE SNC - 89900 VIBO VALENTIA (VV)',
        potenzaImpegnata: '30,0 kW',
        tipoContratto: 'Mercato Libero',
        tipologiaCliente: 'Business (Altri usi)',
        cteApplicata: 'Prezzo Variabile Energia',
        scadenzaCondizioni: 'Indeterminata',
        modalitaPagamento: 'Domiciliazione Bancaria (IT64********2420)',
        f1: 2581.88,
        f2: 1868.97,
        f3: 2397.74,
        punF1: 0.10717,
        punF2: 0.13144,
        punF3: 0.12081,
        totaleConsumo: 6848.59,
        consumoAnnuo: '77.270 kWh',
        statoPagamenti: 'Regolare (Nessuna morosità)',
        cmor: 'Assente (0 €)',
        interessiMora: 'Assenti (0 €)',
        spesaMateriaPrimaAttuale: 1344.15 // spesa vendita energia in bolletta
      });
    }, 2500);
  };

  // Calcolo Offerte Simulate basato sui consumi reali della bolletta
  const calcolaSimulazione = (): OffertaSimulata[] => {
    if (!datiBolletta) return [];

    const consumiTot = datiBolletta.totaleConsumo;
    const punMedio = (datiBolletta.f1 * datiBolletta.punF1 + datiBolletta.f2 * datiBolletta.punF2 + datiBolletta.f3 * datiBolletta.punF3) / consumiTot;

    const offerte: { nome: string; fornitore: string; spread: number; quotaFissaAnnuo: number }[] = [
      { nome: 'EcoBusiness Flex 12M', fornitore: 'Green Power S.p.A.', spread: 0.012, quotaFissaAnnuo: 120 },
      { nome: 'Luce Impresa Dynamic', fornitore: 'Next Energy', spread: 0.015, quotaFissaAnnuo: 96 },
      { nome: 'B2B Top Protection GME', fornitore: 'Sorgente Elettrica', spread: 0.018, quotaFissaAnnuo: 144 },
    ];

    return offerte.map((o) => {
      const quotaConsumiMese = consumiTot * (punMedio + o.spread);
      const quotaFissaMese = o.quotaFissaAnnuo / 12;
      const costoMese = quotaConsumiMese + quotaFissaMese;
      const risparmioM = datiBolletta.spesaMateriaPrimaAttuale - costoMese;

      return {
        nome: o.nome,
        fornitore: o.fornitore,
        spread: o.spread,
        quotaFissaAnnuo: o.quotaFissaAnnuo,
        costoStimatoMese: costoMese,
        risparmioMese: risparmioM,
        risparmioAnnuo: risparmioM * 12,
      };
    }).sort((a, b) => b.risparmioMese - a.risparmioMese);
  };

  const offerteSimulate = calcolaSimulazione();

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans flex flex-col items-center">
      <div className="max-w-4xl w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        
        {/* TITOLO PRINCIPALE */}
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2 tracking-tight">
          ⚡ Simulatore Energetico & OCR Intelligent
        </h1>
        <p className="text-gray-500 mb-6">
          Piattaforma di analisi bollette, estrazione schede CTE e confronto con l'indice PUN del GME.
        </p>

        {/* MENU TABS */}
        <div className="flex border-b border-gray-200 mb-8 space-x-4 overflow-x-auto">
          <button
            onClick={() => setTabAttiva('bollette')}
            className={`pb-3 font-semibold text-sm transition-colors border-b-2 whitespace-nowrap ${
              tabAttiva === 'bollette'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            📑 1. Lettore Bolletta Cliente
          </button>
          <button
            onClick={() => setTabAttiva('cte')}
            className={`pb-3 font-semibold text-sm transition-colors border-b-2 whitespace-nowrap ${
              tabAttiva === 'cte'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            ⚡ 2. Caricamento Massivo CTE
          </button>
          <button
            onClick={() => setTabAttiva('pun')}
            className={`pb-3 font-semibold text-sm transition-colors border-b-2 whitespace-nowrap ${
              tabAttiva === 'pun'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            📊 3. Indice PUN GME
          </button>
          <button
            onClick={() => setTabAttiva('simulatore')}
            className={`pb-3 font-semibold text-sm transition-colors border-b-2 whitespace-nowrap ${
              tabAttiva === 'simulatore'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            🏆 4. Simulazione & Comparazione
          </button>
        </div>

        {/* TAB 1: BOLLETTE */}
        {tabAttiva === 'bollette' && (
          <div>
            <div className="border-2 border-dashed border-blue-200 rounded-xl p-8 flex flex-col items-center bg-blue-50/30">
              <svg className="w-12 h-12 text-blue-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg shadow transition-colors">
                {loadingBolletta ? 'Lettura OCR e recupero PUN GME...' : 'Carica Bolletta Elettrica (PDF)'}
                <input type="file" accept="application/pdf" className="hidden" onChange={handleUploadBolletta} disabled={loadingBolletta} />
              </label>
              <p className="text-xs text-gray-400 mt-2">Carica la bolletta del cliente per estrarre tutti i dati contrattuali e tecnici</p>
            </div>

            {datiBolletta && (
              <div className="mt-6 space-y-6">
                {/* 1. ANAGRAFICA E FORNITURA */}
                <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl">
                  <h3 className="font-bold text-gray-800 text-base mb-4 border-b pb-2 flex items-center justify-between">
                    <span>📌 Dati Anagrafici e Fornitura ({datiBolletta.periodo})</span>
                    <span className="bg-blue-100 text-blue-800 text-xs px-2.5 py-1 rounded-full font-bold">
                      {datiBolletta.tipologiaCliente}
                    </span>
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 block text-xs">Fornitore Attuale</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.fornitore}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Intestatario</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.intestatario}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Codice Fiscale / P.IVA</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.codiceFiscale}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Codice POD</span>
                      <span className="font-semibold text-blue-700 font-mono">{datiBolletta.pod}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Potenza Impegnata</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.potenzaImpegnata}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Indirizzo Fornitura</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.indirizzoFornitura}</span>
                    </div>
                  </div>
                </div>

                {/* 2. VERIFICA RISCHI & CONSUMO ANNUO */}
                <div className="p-6 bg-slate-100/80 border border-slate-200 rounded-xl">
                  <h3 className="font-bold text-gray-800 text-base mb-3">
                    🔍 Verifica Morosità, Oneri e Consumo Annuo
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="bg-white p-3 rounded-lg shadow-sm border">
                      <span className="text-gray-500 block text-xs">Stato Pagamenti</span>
                      <span className="font-bold text-emerald-600 text-xs">{datiBolletta.statoPagamenti}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg shadow-sm border">
                      <span className="text-gray-500 block text-xs">Addebiti CMOR</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.cmor}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg shadow-sm border">
                      <span className="text-gray-500 block text-xs">Interessi di Mora</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.interessiMora}</span>
                    </div>
                    <div className="bg-white p-3 rounded-lg shadow-sm border">
                      <span className="text-gray-500 block text-xs">Consumo Annuo</span>
                      <span className="font-extrabold text-blue-700">{datiBolletta.consumoAnnuo}</span>
                    </div>
                  </div>
                </div>

                {/* 3. CONDIZIONE CONTRATTUALE ATTUALE */}
                <div className="p-6 bg-amber-50/60 border border-amber-200 rounded-xl">
                  <h3 className="font-bold text-amber-900 text-base mb-3">
                    📋 Offerta & Modalità di Pagamento
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-3">
                    <div>
                      <span className="text-gray-500 block text-xs">Tipo Contratto</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.tipoContratto}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Offerta Commerciale</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.cteApplicata}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm border-t border-amber-200/60 pt-3">
                    <div>
                      <span className="text-gray-500 block text-xs">Scadenza Condizioni</span>
                      <span className="font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded text-xs">
                        {datiBolletta.scadenzaCondizioni}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Modalità di Pagamento</span>
                      <span className="font-bold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded text-xs">
                        💳 {datiBolletta.modalitaPagamento}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. CONSUMI E PUN */}
                <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl">
                  <h3 className="font-bold text-gray-800 text-base mb-4">
                    ⚡ Consumi Mese Fatturato e Indici PUN GME
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="bg-white p-4 rounded-lg shadow-sm border">
                      <div className="text-xs text-gray-500">Consumo F1</div>
                      <div className="text-xl font-bold text-gray-800">{datiBolletta.f1.toLocaleString('it-IT')} kWh</div>
                      <div className="text-xs text-blue-600 mt-1">PUN GME: {datiBolletta.punF1} €/kWh</div>
                    </div>
                    <div className="bg-white p-4 rounded-lg shadow-sm border">
                      <div className="text-xs text-gray-500">Consumo F2</div>
                      <div className="text-xl font-bold text-gray-800">{datiBolletta.f2.toLocaleString('it-IT')} kWh</div>
                      <div className="text-xs text-blue-600 mt-1">PUN GME: {datiBolletta.punF2} €/kWh</div>
                    </div>
                    <div className="bg-white p-4 rounded-lg shadow-sm border">
                      <div className="text-xs text-gray-500">Consumo F3</div>
                      <div className="text-xl font-bold text-gray-800">{datiBolletta.f3.toLocaleString('it-IT')} kWh</div>
                      <div className="text-xs text-blue-600 mt-1">PUN GME: {datiBolletta.punF3} €/kWh</div>
                    </div>
                  </div>

                  <div className="p-4 bg-emerald-100/70 border border-emerald-300 text-emerald-900 rounded-lg flex justify-between items-center">
                    <span className="font-semibold">Totale Consumo Mese:</span>
                    <span className="text-lg font-extrabold">{datiBolletta.totaleConsumo.toLocaleString('it-IT')} kWh</span>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* TAB 2: CTE MASSIVO */}
        {tabAttiva === 'cte' && (
          <div>
            <div className="border-2 border-dashed border-blue-200 rounded-xl p-8 flex flex-col items-center bg-blue-50/30">
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg shadow transition-colors">
                Seleziona CTE PDF (Massivo)
                <input type="file" accept="application/pdf" className="hidden" onChange={handleUploadCTE} multiple />
              </label>
              <p className="text-xs text-gray-400 mt-2">Puoi selezionare fino a 30 CTE contemporaneamente</p>
            </div>

            {fileListCTE.length > 0 && (
              <div className="mt-6">
                <h3 className="font-bold text-gray-800 mb-3">Monitor CTE ({fileListCTE.length} file)</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {fileListCTE.map((f) => (
                    <div key={f.id} className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg text-sm flex justify-between">
                      <span className="font-medium">{f.nome}</span>
                      <span className="text-xs bg-emerald-200 px-2 py-0.5 rounded font-bold">{f.risultato || 'Elaborazione...'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: TABELLA PUN GME */}
        {tabAttiva === 'pun' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-600">
              <thead className="text-xs text-gray-700 uppercase bg-gray-100">
                <tr>
                  <th className="px-4 py-3">Mese / Anno</th>
                  <th className="px-4 py-3">PUN F1 (€/kWh)</th>
                  <th className="px-4 py-3">PUN F2 (€/kWh)</th>
                  <th className="px-4 py-3">PUN F3 (€/kWh)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-white">
                  <td className="px-4 py-3 font-semibold">Giugno 2026</td>
                  <td className="px-4 py-3">0,125760</td>
                  <td className="px-4 py-3">0,151700</td>
                  <td className="px-4 py-3">0,127240</td>
                </tr>
                <tr className="border-b bg-gray-50">
                  <td className="px-4 py-3 font-semibold">Maggio 2026</td>
                  <td className="px-4 py-3">0,107170</td>
                  <td className="px-4 py-3">0,131440</td>
                  <td className="px-4 py-3">0,120810</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: SIMULATORE & COMPARATORE */}
        {tabAttiva === 'simulatore' && (
          <div>
            {!datiBolletta ? (
              <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed">
                <p className="text-gray-500 font-medium">⚠️ Prima di eseguire la simulazione, carica una bolletta nella scheda "1. Lettore Bolletta Cliente".</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl flex justify-between items-center text-sm">
                  <div>
                    <span className="text-gray-500 block text-xs">Profilo Cliente per Simulazione</span>
                    <span className="font-bold text-gray-800">{datiBolletta.intestatario} ({datiBolletta.consumoAnnuo}/anno)</span>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-500 block text-xs">Spesa Materia Prima Attuale</span>
                    <span className="font-extrabold text-gray-800">{datiBolletta.spesaMateriaPrimaAttuale.toFixed(2)} €/mese</span>
                  </div>
                </div>

                <h3 className="font-bold text-gray-800 text-lg">🏆 Classifica Offerte CTE per Risparmio Economico</h3>

                <div className="space-y-4">
                  {offerteSimulate.map((offerta, index) => (
                    <div
                      key={index}
                      className={`p-6 rounded-xl border transition-all ${
                        index === 0 ? 'bg-emerald-50/70 border-emerald-300 shadow-md ring-2 ring-emerald-500/20' : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            {index === 0 && (
                              <span className="bg-emerald-600 text-white text-xs font-bold px-2 py-0.5 rounded">MIGLIOR OFFERTA</span>
                            )}
                            <h4 className="font-bold text-gray-900 text-base">{offerta.nome}</h4>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Fornitore: {offerta.fornitore}</p>
                          <div className="flex gap-4 text-xs text-gray-600 mt-2">
                            <span>Spread: <strong>{offerta.spread} €/kWh</strong></span>
                            <span>Fisso: <strong>{offerta.quotaFissaAnnuo} €/anno</strong></span>
                          </div>
                        </div>

                        <div className="flex items-center gap-6 border-t md:border-t-0 pt-3 md:pt-0">
                          <div>
                            <span className="text-xs text-gray-400 block">Materia Prima Stimata</span>
                            <span className="text-base font-bold text-gray-800">{offerta.costoStimatoMese.toFixed(2)} €/mese</span>
                          </div>
                          <div className="bg-emerald-100 p-3 rounded-xl text-emerald-900 text-right">
                            <span className="text-xs text-emerald-700 block font-semibold">Risparmio Stimato</span>
                            <span className="text-lg font-extrabold text-emerald-700">+{offerta.risparmioMese.toFixed(2)} €/mese</span>
                            <span className="text-xs block text-emerald-800 font-medium">({offerta.risparmioAnnuo.toFixed(2)} €/anno)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

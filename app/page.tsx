'use client';

import React, { useState } from 'react';

interface CTEArchiviata {
  id: string;
  nomeOfferta: string;
  fornitore: string;
  target: 'Business' | 'Consumer';
  spread: number; // €/kWh
  pcfAnnuo: number; // €/anno
  scadenzaOfferta: string; // YYYY-MM-DD
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

interface DettaglioSimulazione {
  cte: CTEArchiviata;
  costoF1: number;
  costoF2: number;
  costoF3: number;
  costoConsumiTotale: number;
  costoFissoMese: number;
  costoMateriaPrimaMese: number;
  risparmioMese: number;
  risparmioAnnuo: number;
}

export default function Home() {
  const [tabAttiva, setTabAttiva] = useState<'bollette' | 'cte' | 'pun' | 'simulatore'>('bollette');
  
  // Archivio Dinamico CTE caricate (Simulate da OCR massivo + validità)
  const [archivioCTE, setArchivioCTE] = useState<CTEArchiviata[]>([
    {
      id: 'cte-1',
      nomeOfferta: 'BE STRONG GAS/LUCE B2B 2026',
      fornitore: 'E2E Energy Solution',
      target: 'Business',
      spread: 0.0115,
      pcfAnnuo: 108,
      scadenzaOfferta: '2026-12-31' // Valida
    },
    {
      id: 'cte-2',
      nomeOfferta: 'Be Top per MT/BT Impresa',
      fornitore: 'Power Grid Italia',
      target: 'Business',
      spread: 0.0140,
      pcfAnnuo: 96,
      scadenzaOfferta: '2026-09-30' // Valida
    },
    {
      id: 'cte-3',
      nomeOfferta: 'Be Smart 40.000 Promo GME',
      fornitore: 'Smart Light S.p.A.',
      target: 'Business',
      spread: 0.0165,
      pcfAnnuo: 120,
      scadenzaOfferta: '2026-08-15' // Valida
    },
    {
      id: 'cte-4',
      nomeOfferta: 'Offerta Scaduta Spring 2025',
      fornitore: 'Old Energy',
      target: 'Business',
      spread: 0.0080,
      pcfAnnuo: 60,
      scadenzaOfferta: '2025-12-31' // Scaduta (verrà filtrata via)
    }
  ]);

  // CTE selezionata per visualizzare il dettaglio
  const [cteSelezionataDettaglio, setCteSelezionataDettaglio] = useState<DettaglioSimulazione | null>(null);

  // Stato Bolletta PDF
  const [loadingBolletta, setLoadingBolletta] = useState(false);
  const [datiBolletta, setDatiBolletta] = useState<DatiBolletta | null>(null);

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
        spesaMateriaPrimaAttuale: 1344.15
      });
    }, 2000);
  };

  // Algoritmo: Filtra solo CTE valide (non scadute) e calcola il ranking
  const calcolaSimulazioneArchivio = (): DettaglioSimulazione[] => {
    if (!datiBolletta) return [];

    const oggi = new Date().toISOString().split('T')[0]; // Data attuale (2026)

    // 1. FILTRO: Solo CTE non scadute
    const cteValide = archivioCTE.filter((cte) => cte.scadenzaOfferta >= oggi);

    // 2. CALCOLO DETTAGLIATO PER CIASCUNA CTE
    const calcolate = cteValide.map((cte) => {
      const costoF1 = datiBolletta.f1 * (datiBolletta.punF1 + cte.spread);
      const costoF2 = datiBolletta.f2 * (datiBolletta.punF2 + cte.spread);
      const costoF3 = datiBolletta.f3 * (datiBolletta.punF3 + cte.spread);
      
      const costoConsumiTotale = costoF1 + costoF2 + costoF3;
      const costoFissoMese = cte.pcfAnnuo / 12;
      const costoMateriaPrimaMese = costoConsumiTotale + costoFissoMese;
      
      const risparmioMese = datiBolletta.spesaMateriaPrimaAttuale - costoMateriaPrimaMese;
      const risparmioAnnuo = risparmioMese * 12;

      return {
        cte,
        costoF1,
        costoF2,
        costoF3,
        costoConsumiTotale,
        costoFissoMese,
        costoMateriaPrimaMese,
        risparmioMese,
        risparmioAnnuo
      };
    });

    // 3. ORDINAMENTO PER RISPARMIO DECRESCENTE E PRENDO LE PRIME 3
    return calcolate.sort((a, b) => b.risparmioMese - a.risparmioMese).slice(0, 3);
  };

  const top3Simulate = calcolaSimulazioneArchivio();

  // Dati Storici PUN GME (Storico ultimi mesi)
  const storicoPUN = [
    { mese: 'Giugno 2026', f1: '0,125760', f2: '0,151700', f3: '0,127240' },
    { mese: 'Maggio 2026', f1: '0,107170', f2: '0,131440', f3: '0,120810' },
    { mese: 'Aprile 2026', f1: '0,111140', f2: '0,138260', f3: '0,116630' },
    { mese: 'Marzo 2026', f1: '0,108500', f2: '0,129900', f3: '0,114200' },
    { mese: 'Febbraio 2026', f1: '0,115400', f2: '0,141100', f3: '0,123800' },
    { mese: 'Gennaio 2026', f1: '0,121300', f2: '0,148200', f3: '0,130100' },
  ];

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
            ⚡ 2. Caricamento Massivo CTE ({archivioCTE.length})
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
            🏆 4. Simulazione CTE Archivio
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
                {/* ANAGRAFICA E FORNITURA */}
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

                {/* VERIFICA RISCHI */}
                <div className="p-6 bg-slate-100/80 border border-slate-200 rounded-xl">
                  <h3 className="font-bold text-gray-800 text-base mb-3">🔍 Verifica Morosità, Oneri e Consumo Annuo</h3>
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

                {/* CONDIZIONE ATTUALE */}
                <div className="p-6 bg-amber-50/60 border border-amber-200 rounded-xl">
                  <h3 className="font-bold text-amber-900 text-base mb-3">📋 Offerta & Modalità di Pagamento</h3>
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
                      <span className="font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded text-xs">{datiBolletta.scadenzaCondizioni}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Modalità di Pagamento</span>
                      <span className="font-bold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded text-xs">💳 {datiBolletta.modalitaPagamento}</span>
                    </div>
                  </div>
                </div>

                {/* CONSUMI MESE */}
                <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl">
                  <h3 className="font-bold text-gray-800 text-base mb-4">⚡ Consumi Mese Fatturato e Indici PUN GME</h3>
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
            <div className="border-2 border-dashed border-blue-200 rounded-xl p-8 flex flex-col items-center bg-blue-50/30 mb-6">
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg shadow transition-colors">
                Carica Nuove CTE PDF (Massivo)
                <input type="file" accept="application/pdf" className="hidden" multiple />
              </label>
              <p className="text-xs text-gray-400 mt-2">I dati estratti dalle CTE verranno salvati nell'archivio sottostante</p>
            </div>

            <h3 className="font-bold text-gray-800 mb-3">📋 Archivio CTE Attivo per la Simulazione</h3>
            <div className="space-y-3">
              {archivioCTE.map((cte) => {
                const isScaduta = cte.scadenzaOfferta < new Date().toISOString().split('T')[0];
                return (
                  <div key={cte.id} className={`p-4 rounded-xl border flex justify-between items-center text-sm ${isScaduta ? 'bg-red-50/50 border-red-200 opacity-60' : 'bg-white border-gray-200 shadow-sm'}`}>
                    <div>
                      <div className="font-bold text-gray-900">{cte.nomeOfferta} <span className="text-xs font-normal text-gray-500">({cte.fornitore})</span></div>
                      <div className="text-xs text-gray-500 mt-1">Spread: <strong>{cte.spread} €/kWh</strong> | Q.Fissa: <strong>{cte.pcfAnnuo} €/anno</strong></div>
                    </div>
                    <div>
                      {isScaduta ? (
                        <span className="bg-red-100 text-red-800 text-xs px-2.5 py-1 rounded-full font-bold">SCADUTA ({cte.scadenzaOfferta})</span>
                      ) : (
                        <span className="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 rounded-full font-bold">VALIDA fino al {cte.scadenzaOfferta}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
                {storicoPUN.map((riga, idx) => (
                  <tr key={idx} className={`border-b ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    <td className="px-4 py-3 font-semibold">{riga.mese}</td>
                    <td className="px-4 py-3">{riga.f1}</td>
                    <td className="px-4 py-3">{riga.f2}</td>
                    <td className="px-4 py-3">{riga.f3}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: SIMULATORE ARCHIVIO CTE */}
        {tabAttiva === 'simulatore' && (
          <div>
            {!datiBolletta ? (
              <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed">
                <p className="text-gray-500 font-medium">⚠️ Prima di eseguire la simulazione, carica una bolletta nella scheda "1. Lettore Bolletta Cliente".</p>
              </div>
            ) : (
              <div className="space-y-6">
                
                {/* PROFILO CLIENTE */}
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl flex justify-between items-center text-sm">
                  <div>
                    <span className="text-gray-500 block text-xs">Profilo Cliente per Simulazione</span>
                    <span className="font-bold text-gray-800">{datiBolletta.intestatario} ({datiBolletta.consumoAnnuo}/anno)</span>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-500 block text-xs">Materia Prima Attuale in Bolletta</span>
                    <span className="font-extrabold text-gray-800">{datiBolletta.spesaMateriaPrimaAttuale.toFixed(2)} €/mese</span>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-gray-800 text-lg">🏆 Top 3 CTE Valide in Archivio</h3>
                  <span className="text-xs text-gray-500">Filtrate solo offerte non scadute</span>
                </div>

                {/* CLASSIFICA TOP 3 */}
                <div className="space-y-4">
                  {top3Simulate.map((item, index) => (
                    <div
                      key={item.cte.id}
                      onClick={() => setCteSelezionataDettaglio(item)}
                      className={`p-6 rounded-xl border cursor-pointer transition-all hover:shadow-lg ${
                        cteSelezionataDettaglio?.cte.id === item.cte.id
                          ? 'ring-2 ring-blue-600 bg-blue-50/30'
                          : index === 0
                          ? 'bg-emerald-50/70 border-emerald-300 shadow-sm'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            {index === 0 && (
                              <span className="bg-emerald-600 text-white text-xs font-bold px-2 py-0.5 rounded">MIGLIOR OFFERTA</span>
                            )}
                            <h4 className="font-bold text-gray-900 text-base">{item.cte.nomeOfferta}</h4>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Fornitore: {item.cte.fornitore} | Scadenza: {item.cte.scadenzaOfferta}</p>
                          <div className="flex gap-4 text-xs text-gray-600 mt-2">
                            <span>Spread: <strong>{item.cte.spread} €/kWh</strong></span>
                            <span>Fisso $P_{`{CF}`}$: <strong>{item.cte.pcfAnnuo} €/anno</strong></span>
                          </div>
                        </div>

                        <div className="flex items-center gap-6 border-t md:border-t-0 pt-3 md:pt-0">
                          <div>
                            <span className="text-xs text-gray-400 block">Stima Materia Prima</span>
                            <span className="text-base font-bold text-gray-800">{item.costoMateriaPrimaMese.toFixed(2)} €/mese</span>
                          </div>
                          <div className="bg-emerald-100 p-3 rounded-xl text-emerald-900 text-right">
                            <span className="text-xs text-emerald-700 block font-semibold">Risparmio Stimato</span>
                            <span className="text-lg font-extrabold text-emerald-700">+{item.risparmioMese.toFixed(2)} €/mese</span>
                            <span className="text-xs block text-emerald-800 font-medium">({item.risparmioAnnuo.toFixed(2)} €/anno)</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 text-right">
                        <span className="text-xs font-bold text-blue-600 hover:underline">
                          {cteSelezionataDettaglio?.cte.id === item.cte.id ? '▲ Nascondi Dettaglio Calcolo' : '🔍 Clicca per vedere il Dettaglio Analitico'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* PANNELLO DETTAGLIO ANALITICO DELLA CTE SELEZIONATA */}
                {cteSelezionataDettaglio && (
                  <div className="p-6 bg-slate-900 text-white rounded-2xl shadow-2xl animate-fade-in mt-6">
                    <div className="flex justify-between items-start border-b border-slate-700 pb-4 mb-4">
                      <div>
                        <span className="bg-blue-500 text-white text-xs px-2.5 py-0.5 rounded font-bold uppercase">Prospetto Analitico Dettagliato</span>
                        <h4 className="text-xl font-bold mt-1 text-white">{cteSelezionataDettaglio.cte.nomeOfferta}</h4>
                        <p className="text-xs text-slate-400">Formula applicata: Consumo Fascia × (PUN Fascia + Spread) + Quota Fissa</p>
                      </div>
                      <button
                        onClick={() => setCteSelezionataDettaglio(null)}
                        className="text-slate-400 hover:text-white font-bold text-sm bg-slate-800 px-3 py-1 rounded"
                      >
                        ✕ Chiudi
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-sm">
                      <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
                        <span className="text-xs text-slate-400 block">Dettaglio Fascia F1 ({datiBolletta.f1} kWh)</span>
                        <div className="text-base font-bold text-blue-400 mt-1">{cteSelezionataDettaglio.costoF1.toFixed(2)} €</div>
                        <span className="text-xs text-slate-400 font-mono mt-1 block">PUN ({datiBolletta.punF1}) + Spread ({cteSelezionataDettaglio.cte.spread})</span>
                      </div>
                      <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
                        <span className="text-xs text-slate-400 block">Dettaglio Fascia F2 ({datiBolletta.f2} kWh)</span>
                        <div className="text-base font-bold text-blue-400 mt-1">{cteSelezionataDettaglio.costoF2.toFixed(2)} €</div>
                        <span className="text-xs text-slate-400 font-mono mt-1 block">PUN ({datiBolletta.punF2}) + Spread ({cteSelezionataDettaglio.cte.spread})</span>
                      </div>
                      <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
                        <span className="text-xs text-slate-400 block">Dettaglio Fascia F3 ({datiBolletta.f3} kWh)</span>
                        <div className="text-base font-bold text-blue-400 mt-1">{cteSelezionataDettaglio.costoF3.toFixed(2)} €</div>
                        <span className="text-xs text-slate-400 font-mono mt-1 block">PUN ({datiBolletta.punF3}) + Spread ({cteSelezionataDettaglio.cte.spread})</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-800/50 p-4 rounded-xl border border-slate-700 text-sm">
                      <div>
                        <span className="text-slate-400 text-xs block">Quota Fissa Commercializzazione ($P_{`{CF}`}$)</span>
                        <span className="font-semibold text-slate-200">{(cteSelezionataDettaglio.cte.pcfAnnuo / 12).toFixed(2)} €/mese ({cteSelezionataDettaglio.cte.pcfAnnuo} €/anno)</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-xs block">Totale Stima Materia Prima Mese</span>
                        <span className="font-extrabold text-emerald-400 text-lg">{cteSelezionataDettaglio.costoMateriaPrimaMese.toFixed(2)} €/mese</span>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

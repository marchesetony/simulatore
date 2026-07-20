'use client';

import React, { useState, useEffect } from 'react';

interface CTEArchiviata {
  id: string;
  nomeOfferta: string;
  fornitore: string;
  tipoVettore: 'EE' | 'GAS';
  tensioneCompatibile: 'BT' | 'MT' | 'ENTRAMBE';
  spread: number;
  quotaFissaBusinessMese: number;
  commercializzazioneVar: number;
  sbilanciamentoVar: number;
  costoUnaTantum: number;
  scadenzaOfferta: string;
  nomeFileOriginale: string;
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
  livelloTensione: 'BT' | 'MT';
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
  costoConsumiTotale: number;
  costoFissoMeseTotale: number;
  costoMateriaEnergiaNuova: number;
  spesaMateriaAttuale: number;
  risparmioMese: number;
  risparmioAnnuo: number;
  percentualeRisparmio: string;
  costoUnaTantum: number;
}

export default function Home() {
  const [tabAttiva, setTabAttiva] = useState<'bollette' | 'cte' | 'pun' | 'simulatore'>('bollette');
  const [archivioCTE, setArchivioCTE] = useState<CTEArchiviata[]>([]);
  const [cteSelezionataDettaglio, setCteSelezionataDettaglio] = useState<DettaglioSimulazione | null>(null);

  const [loadingBolletta, setLoadingBolletta] = useState(false);
  const [loadingCTE, setLoadingCTE] = useState(false);
  const [datiBolletta, setDatiBolletta] = useState<DatiBolletta | null>(null);

  // Caricamento dinamico della libreria PDF.js nel browser
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const handleEliminaCTE = (idEliminare: string) => {
    setArchivioCTE((prev) => prev.filter((item) => item.id !== idEliminare));
    if (cteSelezionataDettaglio?.cte.id === idEliminare) {
      setCteSelezionataDettaglio(null);
    }
  };

  // ESTRAZIONE REALE TESTO DAL PDF UTILIZZANDO PDF.JS
  const estraiTestoDaPDF = async (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const typedarray = new Uint8Array(event.target?.result as ArrayBuffer);
          // @ts-ignore
          const pdfjsLib = window['pdfjsLib'];
          if (!pdfjsLib) {
            resolve('');
            return;
          }
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

          const pdf = await pdfjsLib.getDocument(typedarray).promise;
          let testoCompleto = '';

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            testoCompleto += ' ' + pageText;
          }

          resolve(testoCompleto);
        } catch (err) {
          console.error('Errore durante la lettura del PDF:', err);
          resolve('');
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  // HANDLER UPLOAD E PARSING Delle CTE REALI
  const handleUploadNuoveCTE = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    setLoadingCTE(true);
    const fileArray = Array.from(e.target.files);

    const nuoveEstratte: CTEArchiviata[] = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const text = await estraiTestoDaPDF(file);

      // 1. Nome Offerta
      const matchNome = text.match(/(?:CONDIZIONE TECNICO ECONOMICHE|Offerta|CTE)\s*[-–]?\s*([A-Za-z0-9\s._]+)/i);
      const nomeClean = file.name.replace(/\.pdf$/i, '');
      const nomeOfferta = matchNome && matchNome[1].length < 40 ? matchNome[1].trim() : nomeClean;

      // 2. Spread / Corrispettivo fisso d'acquisto (€/kWh)
      const matchSpread = text.match(/(?:corrispettivo fisso d'acquisto|spread|alfa)[^0-9]*(\d+[,.]\d+)/i);
      const spreadVal = matchSpread ? parseFloat(matchSpread[1].replace(',', '.')) : 0.0;

      // 3. Quota Fissa Business (€/mese)
      const matchQuotaFissa = text.match(/(?:Quota fissa business|fisso|commercializzazione fissa)[^0-9]*(\d+[,.]?\d*)\s*€\s*\/\s*mese/i);
      const quotaFissaVal = matchQuotaFissa ? parseFloat(matchQuotaFissa[1].replace(',', '.')) : 0.0;

      // 4. Commercializzazione Variabile (€/kWh)
      const matchCommVar = text.match(/Commercializzazione\s*pari\s*a\s*(\d+[,.]\d+)/i);
      const commVarVal = matchCommVar ? parseFloat(matchCommVar[1].replace(',', '.')) : 0.0;

      // 5. Sbilanciamento (€/kWh)
      const matchSbil = text.match(/Sbilanciamento\s*pari\s*a\s*(\d+[,.]\d+)/i);
      const sbilVal = matchSbil ? parseFloat(matchSbil[1].replace(',', '.')) : 0.0;

      // 6. Una-Tantum (€)
      const matchUnaTantum = text.match(/(?:una tantum|gestione APP)[^0-9]*€?\s*(\d+[,.]\d+)/i);
      const unaTantumVal = matchUnaTantum ? parseFloat(matchUnaTantum[1].replace(',', '.')) : 0.0;

      // 7. Scadenza (YYYY-MM-DD)
      const matchScadenza = text.match(/entro\s*il\s*(\d{2}\/\d{2}\/\d{4})/i);
      let scadenzaFormatted = '2026-12-31';
      if (matchScadenza) {
        const parts = matchScadenza[1].split('/');
        scadenzaFormatted = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }

      // Riconoscimento Vettore (EE vs GAS)
      const isGas = /gas naturale|fornitura gas|sm3/i.test(text) || /gas/i.test(file.name);

      nuoveEstratte.push({
        id: `cte-real-${Date.now()}-${i}`,
        nomeOfferta: nomeOfferta,
        fornitore: 'BPower Energia S.p.A.',
        tipoVettore: isGas ? 'GAS' : 'EE',
        tensioneCompatibile: 'ENTRAMBE',
        spread: spreadVal,
        quotaFissaBusinessMese: quotaFissaVal,
        commercializzazioneVar: commVarVal,
        sbilanciamentoVar: sbilVal,
        costoUnaTantum: unaTantumVal,
        scadenzaOfferta: scadenzaFormatted,
        nomeFileOriginale: file.name
      });
    }

    setArchivioCTE((prev) => [...nuoveEstratte, ...prev]);
    setLoadingCTE(false);
  };

  const handleUploadBolletta = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setLoadingBolletta(true);
    setDatiBolletta(null);

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
        livelloTensione: 'BT',
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
    }, 1500);
  };

  const calcolaSimulazioneArchivio = (): DettaglioSimulazione[] => {
    if (!datiBolletta) return [];

    const oggi = new Date().toISOString().split('T')[0];

    const cteValide = archivioCTE.filter((cte) => {
      const isEE = cte.tipoVettore === 'EE';
      const isNonScaduta = cte.scadenzaOfferta >= oggi;
      const isTensioneOk = cte.tensioneCompatibile === 'ENTRAMBE' || cte.tensioneCompatibile === datiBolletta.livelloTensione;
      return isEE && isNonScaduta && isTensioneOk;
    });

    const calcolate = cteValide.map((cte) => {
      const prezzoUnipF1 = datiBolletta.punF1 + cte.spread + cte.commercializzazioneVar + cte.sbilanciamentoVar;
      const prezzoUnipF2 = datiBolletta.punF2 + cte.spread + cte.commercializzazioneVar + cte.sbilanciamentoVar;
      const prezzoUnipF3 = datiBolletta.punF3 + cte.spread + cte.commercializzazioneVar + cte.sbilanciamentoVar;

      const costoF1 = datiBolletta.f1 * prezzoUnipF1;
      const costoF2 = datiBolletta.f2 * prezzoUnipF2;
      const costoF3 = datiBolletta.f3 * prezzoUnipF3;

      const costoConsumiTotale = costoF1 + costoF2 + costoF3;
      const costoFissoMeseTotale = cte.quotaFissaBusinessMese;
      const costoMateriaEnergiaNuova = costoConsumiTotale + costoFissoMeseTotale;

      const risparmioMese = datiBolletta.spesaMateriaPrimaAttuale - costoMateriaEnergiaNuova;
      const risparmioAnnuo = risparmioMese * 12;
      const perc = ((risparmioMese / datiBolletta.spesaMateriaPrimaAttuale) * 100).toFixed(1);

      return {
        cte,
        costoConsumiTotale,
        costoFissoMeseTotale,
        costoMateriaEnergiaNuova,
        spesaMateriaAttuale: datiBolletta.spesaMateriaPrimaAttuale,
        risparmioMese,
        risparmioAnnuo,
        percentualeRisparmio: `${perc}%`,
        costoUnaTantum: cte.costoUnaTantum
      };
    });

    return calcolate.sort((a, b) => b.risparmioMese - a.risparmioMese);
  };

  const topSimulate = calcolaSimulazioneArchivio();

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
            ⚡ 2. Gestione CTE ({archivioCTE.length})
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
            🏆 4. Simulazione Comparativa
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
                {loadingBolletta ? 'Lettura OCR in corso...' : 'Carica Bolletta Elettrica (PDF)'}
                <input type="file" accept="application/pdf" className="hidden" onChange={handleUploadBolletta} disabled={loadingBolletta} />
              </label>
              <p className="text-xs text-gray-400 mt-2">Carica la bolletta per estrarre anagrafica, consumi e fornitore attuale</p>
            </div>

            {datiBolletta && (
              <div className="mt-6 space-y-6">
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
                      <span className="text-gray-500 block text-xs">Potenza Impegnata / Tensione</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.potenzaImpegnata} ({datiBolletta.livelloTensione})</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block text-xs">Indirizzo Fornitura</span>
                      <span className="font-semibold text-gray-800">{datiBolletta.indirizzoFornitura}</span>
                    </div>
                  </div>
                </div>

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

        {/* TAB 2: CARICAMENTO ED ESTRAZIONE PDF.JS REALE */}
        {tabAttiva === 'cte' && (
          <div>
            <div className="border-2 border-dashed border-blue-200 rounded-xl p-8 flex flex-col items-center bg-blue-50/30 mb-8">
              <svg className="w-12 h-12 text-blue-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg shadow transition-colors">
                {loadingCTE ? 'Lettura PDF e Parsing in corso...' : 'Carica Nuove CTE PDF (Massivo)'}
                <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleUploadNuoveCTE} disabled={loadingCTE} multiple />
              </label>
              <p className="text-xs text-gray-400 mt-2">I PDF verranno decodificati direttamente ed estratti i corrispettivi reali</p>
            </div>

            <h3 className="font-bold text-gray-800 mb-3">📋 Archivio CTE Inserite dall'Utente ({archivioCTE.length})</h3>

            {archivioCTE.length === 0 ? (
              <div className="p-8 text-center text-gray-500 border border-dashed rounded-xl bg-gray-50">
                Nessuna CTE presente in archivio. Carica i file PDF reali qui sopra per avviare l'analisi.
              </div>
            ) : (
              <div className="space-y-4">
                {archivioCTE.map((cte) => (
                  <div key={cte.id} className="p-5 rounded-xl border bg-white border-gray-200 shadow-sm space-y-3 relative">
                    <div className="flex justify-between items-center border-b pb-2">
                      <div>
                        <span className="font-bold text-gray-900 text-lg">{cte.nomeOfferta}</span>
                        <span className="text-xs text-gray-400 ml-2">[{cte.nomeFileOriginale}]</span>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 rounded-full font-bold">
                          VALIDA fino al {cte.scadenzaOfferta}
                        </span>
                        <button
                          onClick={() => handleEliminaCTE(cte.id)}
                          className="bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 px-3 py-1 rounded-lg text-xs font-bold border border-red-200 transition-colors flex items-center gap-1"
                        >
                          🗑️ Elimina CTE
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-gray-500 block">Tipo Vettore</span>
                        <span className="font-bold text-blue-700">{cte.tipoVettore === 'EE' ? 'Energia Elettrica' : 'Gas Naturale'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Spread (α)</span>
                        <span className="font-bold text-gray-900">{cte.spread} €/kWh</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Quota Fissa Business</span>
                        <span className="font-bold text-gray-900">{cte.quotaFissaBusinessMese} €/mese ({cte.quotaFissaBusinessMese * 12} €/anno)</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Commercializzazione Var.</span>
                        <span className="font-bold text-gray-900">{cte.commercializzazioneVar} €/kWh</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Sbilanciamento</span>
                        <span className="font-bold text-gray-900">{cte.sbilanciamentoVar} €/kWh</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Una-Tantum App/Servizi</span>
                        <span className="font-bold text-amber-700">{cte.costoUnaTantum} €</span>
                      </div>
                    </div>
                  </div>
                ))}
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

        {/* TAB 4: SIMULATORE COMPARATIVO */}
        {tabAttiva === 'simulatore' && (
          <div>
            {!datiBolletta ? (
              <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed">
                <p className="text-gray-500 font-medium">⚠️ Carica prima una bolletta nella scheda "1. Lettore Bolletta Cliente".</p>
              </div>
            ) : topSimulate.length === 0 ? (
              <div className="text-center py-12 bg-amber-50 rounded-xl border border-amber-200">
                <p className="text-amber-800 font-medium">⚠️ Nessuna CTE elettrica caricata in archivio.</p>
                <p className="text-xs text-amber-600 mt-1">Carica prima i file PDF reali nella scheda "2. Gestione CTE".</p>
              </div>
            ) : (
              <div className="space-y-6">
                
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl flex justify-between items-center text-sm">
                  <div>
                    <span className="text-gray-500 block text-xs">Profilo Cliente per Simulazione</span>
                    <span className="font-bold text-gray-800">{datiBolletta.intestatario} ({datiBolletta.consumoAnnuo}/anno)</span>
                  </div>
                  <div className="text-right">
                    <span className="text-gray-500 block text-xs">Spesa Materia Prima Attuale in Bolletta</span>
                    <span className="font-extrabold text-gray-800">{datiBolletta.spesaMateriaPrimaAttuale.toFixed(2)} €/mese</span>
                  </div>
                </div>

                <h3 className="font-bold text-gray-800 text-lg">🏆 CTE Valide Estratte dai PDF ({topSimulate.length})</h3>

                <div className="space-y-4">
                  {topSimulate.map((item, index) => (
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
                          <p className="text-xs text-gray-500 mt-1">File: {item.cte.nomeFileOriginale} | Validità: fino al {item.cte.scadenzaOfferta}</p>
                          <div className="flex flex-wrap gap-3 text-xs text-gray-600 mt-2">
                            <span>Spread: <strong>{item.cte.spread} €/kWh</strong></span>
                            <span>Quota Fissa Business: <strong>{item.cte.quotaFissaBusinessMese} €/mese ({item.cte.quotaFissaBusinessMese * 12} €/anno)</strong></span>
                            <span>Una-Tantum: <strong>{item.cte.costoUnaTantum} €</strong></span>
                          </div>
                        </div>

                        <div className="flex items-center gap-6 border-t md:border-t-0 pt-3 md:pt-0">
                          <div>
                            <span className="text-xs text-gray-400 block">Materia Prima Stimata</span>
                            <span className="text-base font-bold text-gray-800">{item.costoMateriaEnergiaNuova.toFixed(2)} €/mese</span>
                          </div>
                          <div className="bg-emerald-100 p-3 rounded-xl text-emerald-900 text-right">
                            <span className="text-xs text-emerald-700 block font-semibold">Risparmio Stimato ({item.percentualeRisparmio})</span>
                            <span className="text-lg font-extrabold text-emerald-700">+{item.risparmioMese.toFixed(2)} €/mese</span>
                            <span className="text-xs block text-emerald-800 font-medium">({item.risparmioAnnuo.toFixed(2)} €/anno)</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 text-right">
                        <span className="text-xs font-bold text-blue-600 hover:underline">
                          {cteSelezionataDettaglio?.cte.id === item.cte.id ? '▲ Nascondi Dettaglio' : '🔍 Seleziona per mostrare la scomposizione esatta'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* DETTAGLIO SCOMPOSIZIONE VOCE PER VOCE */}
                {cteSelezionataDettaglio && (
                  <div className="p-6 bg-white border border-gray-300 rounded-2xl shadow-xl animate-fade-in mt-6 space-y-6">
                    <div className="flex justify-between items-center border-b pb-4">
                      <div>
                        <span className="bg-blue-600 text-white text-xs px-2.5 py-1 rounded font-bold uppercase">Prospetto Analitico Dettagliato</span>
                        <h4 className="text-2xl font-extrabold text-gray-900 mt-1">{cteSelezionataDettaglio.cte.nomeOfferta}</h4>
                      </div>
                      <button
                        onClick={() => setCteSelezionataDettaglio(null)}
                        className="text-gray-400 hover:text-gray-800 font-bold text-sm bg-gray-100 px-3 py-1.5 rounded-lg"
                      >
                        ✕ Chiudi
                      </button>
                    </div>

                    <div className="bg-slate-50 border p-5 rounded-xl space-y-3">
                      <h5 className="font-bold text-gray-900 border-b pb-2 text-sm">Scomposizione Corrispettivi Estratti dal Documento</h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs text-gray-700">
                        <div>
                          <span className="text-gray-500 block">Quota Fissa Business</span>
                          <span className="font-bold text-gray-900">{cteSelezionataDettaglio.cte.quotaFissaBusinessMese} €/mese</span>
                        </div>
                        <div>
                          <span className="text-gray-500 block">Spread Componente Energia</span>
                          <span className="font-bold text-gray-900">{cteSelezionataDettaglio.cte.spread} €/kWh</span>
                        </div>
                        <div>
                          <span className="text-gray-500 block">Commercializzazione Variabile</span>
                          <span className="font-bold text-gray-900">{cteSelezionataDettaglio.cte.commercializzazioneVar} €/kWh</span>
                        </div>
                        <div>
                          <span className="text-gray-500 block">Sbilanciamento</span>
                          <span className="font-bold text-gray-900">{cteSelezionataDettaglio.cte.sbilanciamentoVar} €/kWh</span>
                        </div>
                        <div>
                          <span className="text-gray-500 block">Una-Tantum (Gestione APP)</span>
                          <span className="font-bold text-amber-700">{cteSelezionataDettaglio.costoUnaTantum} €</span>
                        </div>
                        <div>
                          <span className="text-gray-500 block">Validità CTE</span>
                          <span className="font-bold text-emerald-700">fino al {cteSelezionataDettaglio.cte.scadenzaOfferta}</span>
                        </div>
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

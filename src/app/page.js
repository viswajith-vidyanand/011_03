"use client";

import { useRef, useState } from "react";
import { sampleShipment } from "@/lib/sample-shipment";

const uploadedDocuments = [
  ["Commercial Invoice", "INV-2026-041.pdf"],
  ["Packing List", "PL-2026-041.pdf"],
  ["Shipping Bill", "SB-2026-041.pdf"],
  ["Purchase Order", "PO-7841.pdf"],
  ["Quality Certificate", "QC-MF-1298.pdf"],
];

function StatusDot({ severity }) {
  const colors = { blocker: "bg-red-500", warning: "bg-amber-500", info: "bg-slate-400" };
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${colors[severity] || "bg-emerald-500"}`} />;
}

function Readiness({ result }) {
  const score = result?.score ?? 84;
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">Export readiness</p>
    <div className="mt-5 flex items-center gap-5">
      <div className="grid h-20 w-20 place-items-center rounded-full border-[7px] border-emerald-500 text-center"><strong className="text-2xl tracking-tight text-slate-900">{score}</strong></div>
      <div><p className="font-semibold text-slate-900">{result?.ready ? "Ready to proceed" : "Verification required"}</p><p className="mt-1 text-sm leading-5 text-slate-500">{result ? `${result.summary.blockers} blockers and ${result.summary.warnings} warnings found.` : "Run verification after documents are added."}</p></div>
    </div>
  </section>;
}

export default function Home() {
  const input = useRef(null);
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  function addFiles(fileList) {
    const accepted = Array.from(fileList || []).filter((file) => file.size <= 25 * 1024 * 1024);
    setFiles((existing) => [...existing, ...accepted]);
    setMessage(accepted.length ? `${accepted.length} file${accepted.length === 1 ? "" : "s"} added. Extract fields before running verification.` : "No files under 25 MB were added.");
  }

  async function runVerification() {
    setRunning(true);
    setMessage("");
    try {
      // This sample payload will be replaced by extracted fields when OCR is connected.
      const response = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sampleShipment) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Verification could not be completed.");
      setResult(body);
      setMessage(`Verification complete. ${body.summary.blockers} blocker${body.summary.blockers === 1 ? "" : "s"} require attention.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRunning(false);
    }
  }

  const findings = result?.findings || [];
  const checklist = result?.checklist || [];

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5"><div className="flex items-center gap-3"><div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-700 text-sm font-bold text-white">CP</div><div><p className="font-semibold tracking-tight">ClearPort</p><p className="text-[10px] font-medium uppercase tracking-[.14em] text-slate-500">Export document verification</p></div></div><span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">Shipment in review</span></div></header>
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex flex-col justify-between gap-5 border-b border-slate-200 pb-8 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-emerald-700">Shipment CP-2026-041</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Document verification</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Frozen seafood shipment from Kochi to Jebel Ali. Review document data before submitting the export declaration.</p></div><button onClick={runVerification} disabled={running} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60">{running ? "Verifying documents…" : "Run verification"}</button></div>
      {message && <p className="mt-5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</p>}
      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">Shipment details</h2></div><dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-4"><div><dt>Buyer</dt><dd>Al Noor Trading LLC</dd></div><div><dt>Departure</dt><dd>24 October 2026</dd></div><div><dt>Commodity</dt><dd>Frozen seafood</dd></div><div><dt>Declared value</dt><dd>USD 48,600</dd></div></dl></section>
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold">Source documents</h2><p className="mt-1 text-xs text-slate-500">Files are retained for extraction and audit review.</p></div><button onClick={() => input.current?.click()} className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">Add documents</button></div><input ref={input} className="hidden" type="file" multiple onChange={(event) => addFiles(event.target.files)} /><div className="divide-y divide-slate-100">{uploadedDocuments.map(([type, name]) => <div key={type} className="flex items-center justify-between px-5 py-3.5"><div><p className="text-sm font-medium">{type}</p><p className="mt-0.5 text-xs text-slate-500">{name}</p></div><span className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Parsed</span></div>)}{files.map((file) => <div key={`${file.name}-${file.lastModified}`} className="flex items-center justify-between px-5 py-3.5"><div><p className="text-sm font-medium">Unclassified document</p><p className="mt-0.5 text-xs text-slate-500">{file.name}</p></div><span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">Awaiting extraction</span></div>)}</div></section>
          {result && <section className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">Verification findings</h2><p className="mt-1 text-xs text-slate-500">Each finding includes source values and an outlier assessment where a majority exists.</p></div><div className="divide-y divide-slate-100">{findings.map((finding) => <article key={finding.id} className="flex gap-3 px-5 py-4"><StatusDot severity={finding.severity}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{finding.title}</h3><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">{finding.severity}</span></div><p className="mt-1 text-sm leading-5 text-slate-600">{finding.message}</p>{finding.likelyWrongDocument && <p className="mt-2 text-xs font-semibold text-amber-800">Likely wrong: {finding.likelyWrongDocument}</p>}{finding.evidence?.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{finding.evidence.map((item) => <span key={`${item.document}-${item.value}`} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">{item.document}: <strong>{item.value}</strong></span>)}</div>}</div></article>)}</div></section>}
        </div>
        <aside className="space-y-6"><Readiness result={result}/><section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold">Commodity checklist</h2><p className="mt-1 text-xs leading-5 text-slate-500">Required documents for seafood exports.</p><div className="mt-4 space-y-3">{(checklist.length ? checklist : [{ name: "Run verification to load checklist", complete: false }]).map((item) => <div key={item.name} className="flex items-center gap-2.5 text-sm"><span className={`grid h-5 w-5 place-items-center rounded-full text-xs font-bold ${item.complete ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.complete ? "✓" : "–"}</span><span className={item.complete ? "text-slate-700" : "text-slate-500"}>{item.name}</span></div>)}</div></section><section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold">Validation coverage</h2><ul className="mt-3 space-y-2 text-sm leading-5 text-slate-600"><li>Cross-document fields</li><li>Line-item and invoice maths</li><li>Purchase-order references</li><li>Majority-based outlier detection</li></ul></section></aside>
      </div>
    </div>
  </main>;
}

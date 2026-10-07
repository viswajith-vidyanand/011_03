"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { sampleShipment } from "@/lib/sample-shipment";

const acceptedExtensions = new Set(["pdf", "jpg", "jpeg", "png", "webp", "heic", "docx", "xlsx", "csv"]);
const documentTypes = ["Commercial Invoice", "Packing List", "Shipping Bill", "Purchase Order", "Quality Certificate", "Other"];
const requiredTypes = documentTypes.slice(0, 5);
const initialState = { stage: 1, documents: [], result: null, sample: false, busy: false, crossChecking: false, error: "", filter: "all", notice: "" };

function reducer(state, action) {
  switch (action.type) {
    case "ADD": return { ...state, documents: [...state.documents, ...action.documents], error: "", result: null };
    case "REMOVE": return { ...state, documents: state.documents.filter((doc) => doc.id !== action.id), result: null };
    case "TYPE": return { ...state, documents: state.documents.map((doc) => doc.id === action.id ? { ...doc, type: action.value } : doc), result: null };
    case "STAGE": return { ...state, stage: action.value, error: "" };
    case "BUSY": return { ...state, busy: action.value, error: action.error || "" };
    case "STATUS": return { ...state, documents: state.documents.map((doc) => doc.id === action.id ? { ...doc, status: action.status, error: action.error || "" } : doc) };
    case "DOCUMENTS": return { ...state, documents: action.documents };
    case "RESULT": return { ...state, result: action.result, stage: 3, busy: false, crossChecking: false, error: "" };
    case "CROSS_CHECK": return { ...state, crossChecking: action.value };
    case "SAMPLE": return { ...state, stage: 1, sample: true, documents: action.documents, result: null, busy: false, error: "", notice: "Sample data loaded. The five demo documents contain three planted discrepancies." };
    case "EDIT_FIELD": return { ...state, documents: state.documents.map((doc) => doc.id === action.id ? { ...doc, fields: { ...doc.fields, [action.field]: action.value } } : doc), result: action.result || state.result };
    case "NOTICE": return { ...state, notice: action.value };
    case "FILTER": return { ...state, filter: action.value };
    case "RESET": return initialState;
    default: return state;
  }
}

function guessType(name) {
  const value = name.toLowerCase();
  if (/invoice|inv\b/.test(value)) return "Commercial Invoice";
  if (/packing|packlist|\bpl\b/.test(value)) return "Packing List";
  if (/shipping.?bill|\bsb\b|customs/.test(value)) return "Shipping Bill";
  if (/purchase.?order|\bpo\b/.test(value)) return "Purchase Order";
  if (/quality|health|phytosanitary|certificate|cert\b/.test(value)) return "Quality Certificate";
  return "Other";
}
function formatSize(size) { return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`; }
function inferCommodity(documents) {
  const text = documents.map((doc) => doc.fields?.description || "").join(" ").toLowerCase();
  if (/fish|shrimp|prawn|seafood|marine/.test(text)) return "seafood";
  if (/pepper|turmeric|cardamom|cumin|clove|spice/.test(text)) return "spices";
  if (/rubber|latex/.test(text)) return "rubber";
  if (/rice|grain|agri|produce|crop|fruit|vegetable/.test(text)) return "agri";
  return "general";
}
function statusText(document) { return document.status === "reading" ? "Reading" : document.status === "extracting" ? "Extracting fields" : document.status === "done" ? "Done" : document.status === "failed" ? "Failed" : document.status === "skipped" ? "Skipped" : "Queued"; }
function Badge({ children, tone = "slate" }) { const tones = { slate: "bg-slate-100 text-slate-600", green: "bg-emerald-50 text-emerald-700", red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-800", blue: "bg-blue-50 text-blue-700", purple: "bg-purple-50 text-purple-700" }; return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>; }

export default function Home() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [llmStatus, setLlmStatus] = useState({ configured: false, provider: "gemini", model: "gemini-2.5-flash" });
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const inputRef = useRef(null); const abortRef = useRef(null);

  useEffect(() => {
    fetch("/api/llm-status")
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.configured === "boolean") {
          setLlmStatus(data);
        }
      })
      .catch(() => {});
  }, []);

  function addFiles(fileList) {
    const documents = []; const errors = [];
    Array.from(fileList || []).forEach((file) => {
      const extension = file.name.split(".").pop().toLowerCase();
      if (!acceptedExtensions.has(extension)) errors.push(`${file.name}: unsupported type. Use PDF, JPG, PNG, WebP, HEIC, DOCX, XLSX, or CSV.`);
      else if (file.size > 4 * 1024 * 1024) errors.push(`${file.name}: larger than the 4 MB per-file limit.`);
      else documents.push({ id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`, file, name: file.name, size: file.size, type: guessType(file.name), status: "queued", error: "", fields: {}, lineItems: [], sample: false, method: "", warning: "" });
    });
    if (documents.length) dispatch({ type: "ADD", documents });
    dispatch({ type: "NOTICE", value: errors.join(" ") || (documents.length ? `${documents.length} file${documents.length === 1 ? "" : "s"} added.` : "No valid files were selected.") });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function postComparison(documents) {
    dispatch({ type: "CROSS_CHECK", value: true });
    const shipmentDocs = documents.filter((doc) => doc.status === "done").map((doc) => ({ id: doc.id, type: doc.type, name: doc.name, fields: doc.fields || {}, lineItems: doc.lineItems || [] }));
    if (!shipmentDocs.length) { dispatch({ type: "CROSS_CHECK", value: false }); dispatch({ type: "BUSY", value: false, error: "No files were extracted. Retry a file or return to upload." }); return; }
    try {
      const response = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documents: shipmentDocs, commodity: inferCommodity(documents) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Comparison failed.");
      dispatch({ type: "DOCUMENTS", documents }); dispatch({ type: "RESULT", result });
    } catch (error) { dispatch({ type: "CROSS_CHECK", value: false }); dispatch({ type: "BUSY", value: false, error: error.message || "Could not compare extracted fields." }); }
  }

  async function extractOne(document, controller = abortRef.current) {
    dispatch({ type: "STATUS", id: document.id, status: "reading" });
    const form = new FormData(); form.append("file", document.file); form.append("documentType", document.type);
    try {
      dispatch({ type: "STATUS", id: document.id, status: "extracting" });
      const response = await fetch("/api/extract", { method: "POST", body: form, signal: controller?.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Extraction failed (${response.status}).`);
      const extractedDoc = payload.document || {};
      return {
        ...document,
        ...extractedDoc,
        status: "done",
        error: "",
        method: extractedDoc.method || "Built-in",
        geminiError: extractedDoc.geminiError || null,
        warning: extractedDoc.warning || (extractedDoc.warnings && extractedDoc.warnings[0]) || "",
        rawOutput: extractedDoc.rawOutput || extractedDoc.text || "",
      };
    } catch (error) {
      return {
        ...document,
        status: error.name === "AbortError" ? "queued" : "failed",
        error: error.name === "AbortError" ? "" : error.message || "Extraction failed.",
      };
    }
  }

  async function processDocuments(retryIds = null) {
    const current = stateRef.current;
    const jobs = (retryIds ? current.documents.filter((doc) => retryIds.includes(doc.id)) : current.documents.filter((doc) => doc.status === "queued" || doc.status === "failed"))
      .filter((doc) => doc.file);
    if (!jobs.length && !retryIds) {
      const completed = current.documents.map((doc) => doc.sample ? { ...doc, status: "done" } : doc);
      dispatch({ type: "DOCUMENTS", documents: completed }); await postComparison(completed); return;
    }
    dispatch({ type: "BUSY", value: true });
    const controller = new AbortController(); abortRef.current = controller;
    const updated = new Map();
    // Process files one at a time sequentially
    for (let i = 0; i < jobs.length && !controller.signal.aborted; i += 1) {
      const doc = jobs[i];
      const result = await extractOne(doc, controller);
      updated.set(doc.id, result);
      dispatch({ type: "DOCUMENTS", documents: stateRef.current.documents.map((item) => item.id === doc.id ? result : item) });
    }
    if (controller.signal.aborted) { dispatch({ type: "BUSY", value: false }); return; }
    const merged = stateRef.current.documents.map((doc) => updated.get(doc.id) || doc);
    dispatch({ type: "DOCUMENTS", documents: merged });
    if (merged.some((doc) => doc.status === "failed")) { dispatch({ type: "BUSY", value: false, error: "One or more files failed. Retry, remove, or continue without each failed file." }); return; }
    await postComparison(merged);
  }

  async function beginVerification() {
    dispatch({ type: "NOTICE", value: "" }); dispatch({ type: "STAGE", value: 2 }); dispatch({ type: "BUSY", value: true });
    await processDocuments();
  }
  async function retryFailed(onlyIds = null) {
    const failed = stateRef.current.documents.filter((doc) => doc.status === "failed" && (!onlyIds || onlyIds.includes(doc.id))).map((doc) => doc.id);
    if (!failed.length) return;
    dispatch({ type: "BUSY", value: true, error: "" });
    const controller = new AbortController(); abortRef.current = controller;
    const retried = new Map();
    // Retry files one at a time sequentially
    for (let i = 0; i < failed.length && !controller.signal.aborted; i += 1) {
      const id = failed[i];
      const doc = stateRef.current.documents.find((item) => item.id === id);
      if (doc) {
        const result = await extractOne(doc, controller);
        retried.set(id, result);
        dispatch({ type: "DOCUMENTS", documents: stateRef.current.documents.map((item) => item.id === id ? result : item) });
      }
    }
    const merged = stateRef.current.documents.map((doc) => retried.get(doc.id) || doc);
    dispatch({ type: "DOCUMENTS", documents: merged });
    if (merged.some((doc) => doc.status === "failed")) dispatch({ type: "BUSY", value: false, error: "Some files still failed. Retry, remove, or continue without them." });
    else await postComparison(merged);
  }
  async function skipFailed(id) {
    const merged = stateRef.current.documents.map((doc) => doc.id === id ? { ...doc, status: "skipped", error: "" } : doc);
    dispatch({ type: "DOCUMENTS", documents: merged });
    if (!merged.some((doc) => doc.status === "failed")) { dispatch({ type: "BUSY", value: true, error: "" }); await postComparison(merged); }
  }
  async function removeFailed(id) {
    const merged = stateRef.current.documents.filter((doc) => doc.id !== id);
    dispatch({ type: "DOCUMENTS", documents: merged });
    if (!merged.some((doc) => doc.status === "failed")) { dispatch({ type: "BUSY", value: true, error: "" }); await postComparison(merged); }
  }
  async function continueWithoutFailed() {
    const merged = stateRef.current.documents.map((doc) => doc.status === "failed" ? { ...doc, status: "skipped", error: "" } : doc);
    dispatch({ type: "DOCUMENTS", documents: merged }); dispatch({ type: "BUSY", value: true, error: "" }); await postComparison(merged);
  }
  async function loadSample() {
    const documents = sampleShipment.documents.map((document) => ({ ...document, file: null, size: 0, status: "done", error: "", sample: true, method: "Rules", warning: "" }));
    dispatch({ type: "SAMPLE", documents });
  }
  function cancelProcessing() { abortRef.current?.abort(); dispatch({ type: "STAGE", value: 1 }); dispatch({ type: "BUSY", value: false }); }

  async function editField(documentId, field, value) {
    const documents = stateRef.current.documents.map((doc) => doc.id === documentId ? { ...doc, fields: { ...doc.fields, [field]: value } } : doc);
    dispatch({ type: "DOCUMENTS", documents });
    const extracted = documents.filter((doc) => doc.status === "done").map((doc) => ({ id: doc.id, type: doc.type, name: doc.name, fields: doc.fields, lineItems: doc.lineItems || [] }));
    try {
      const response = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documents: extracted, commodity: inferCommodity(documents) }) });
      const result = await response.json(); if (response.ok) dispatch({ type: "EDIT_FIELD", id: documentId, field, value, result });
    } catch { dispatch({ type: "NOTICE", value: "The value was edited, but the comparison could not be refreshed. Try again." }); }
  }

  const documents = state.documents;
  const coverage = requiredTypes.map((type) => ({ type, complete: documents.some((doc) => doc.type === type) }));
  const result = state.result;
  const detailFields = [["Buyer / consignee", "consignee"], ["Destination", "dischargePort"], ["Commodity", "description"], ["Declared value", "value"]];
  const visibleFindings = (result?.findings || []).filter((finding) => state.filter === "all" || finding.severity === state.filter);
  const progress = state.crossChecking ? 96 : documents.length ? Math.round((documents.filter((doc) => ["done", "failed", "skipped"].includes(doc.status)).length / documents.length) * 90) : 0;

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-800 text-xs font-bold text-white">IN</div>
          <div>
            <p className="font-semibold tracking-tight">Inovix</p>
            <p className="text-[10px] font-medium uppercase tracking-[.12em] text-slate-500">Document verification</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {llmStatus.configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
              AI extraction: on
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 border border-slate-200">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              AI extraction: off (using built-in parser)
            </span>
          )}
          {state.sample && <Badge tone="blue">Sample data</Badge>}
        </div>
      </div>
    </header>
    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-9">
      <nav aria-label="Shipment verification stages" className="mb-8"><ol className="flex items-center">{[[1, "Upload"], [2, "Processing"], [3, "Findings"]].map(([number, label], index) => <li key={number} className="flex flex-1 items-center last:flex-none"><button type="button" onClick={() => number === 1 && state.stage > 1 ? dispatch({ type: "STAGE", value: 1 }) : null} aria-current={state.stage === number ? "step" : undefined} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${state.stage === number ? "text-emerald-800" : state.stage > number ? "text-emerald-700" : "text-slate-400"}`}><span className={`grid h-7 w-7 place-items-center rounded-full border text-xs ${state.stage === number ? "border-emerald-800 bg-emerald-800 text-white" : state.stage > number ? "border-emerald-700 bg-emerald-50" : "border-slate-300"}`}>{state.stage > number ? "✓" : number}</span>{label}</button>{index < 2 && <div className="mx-2 h-px flex-1 bg-slate-200"/>}</li>)}</ol></nav>
      {state.notice && <div role="status" className="mb-5 flex items-start justify-between gap-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"><span>{state.notice}</span><button onClick={() => dispatch({ type: "NOTICE", value: "" })} aria-label="Dismiss message" className="font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">×</button></div>}
      {state.error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{state.error}</span>{state.stage === 2 && !state.busy && !documents.some((doc) => doc.status === "failed") && <button onClick={() => postComparison(stateRef.current.documents)} className="font-semibold underline">Retry cross-check</button>}</div>}

      {state.stage === 1 && <section aria-labelledby="upload-heading"><div className="max-w-3xl"><p className="text-xs font-semibold uppercase tracking-[.13em] text-emerald-800">Stage 1 · Upload</p><h1 id="upload-heading" className="mt-2 text-3xl font-bold tracking-tight">Start with your shipment documents</h1><p className="mt-2 text-sm leading-6 text-slate-600">Add the documents you have. Missing required documents are flagged but will not stop verification.</p></div>
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]"><div className="space-y-5"><input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.xlsx,.csv" className="sr-only" onChange={(event) => addFiles(event.target.files)}/><div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }} className="rounded-xl border-2 border-dashed border-slate-300 bg-white px-5 py-10 text-center focus-within:border-emerald-700 sm:px-8"><div aria-hidden="true" className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-800">↑</div><h2 className="mt-4 text-lg font-semibold">Drop your files here</h2><p className="mt-1 text-sm text-slate-500">PDF, JPG, PNG, WebP, HEIC, DOCX, XLSX, or CSV · Up to 4 MB each</p><button type="button" onClick={() => inputRef.current?.click()} className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Browse files</button></div>
          {documents.length > 0 && <section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h2 className="font-semibold">Documents <span className="ml-1 text-sm font-normal text-slate-500">({documents.length})</span></h2></div><ul className="divide-y divide-slate-100">{documents.map((doc) => <li key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{doc.name}</p><p className="mt-0.5 text-xs text-slate-500">{doc.sample ? "Demo document" : formatSize(doc.size)}</p></div><label className="sr-only" htmlFor={`type-${doc.id}`}>Document type for {doc.name}</label><select id={`type-${doc.id}`} value={doc.type} onChange={(event) => dispatch({ type: "TYPE", id: doc.id, value: event.target.value })} className="max-w-[190px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{documentTypes.map((type) => <option key={type}>{type}</option>)}</select><button type="button" onClick={() => dispatch({ type: "REMOVE", id: doc.id })} aria-label={`Remove ${doc.name}`} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700">×</button></li>)}</ul></section>}
          <div className="flex flex-col gap-3 sm:flex-row"><button type="button" disabled={documents.length < 2} onClick={beginVerification} className="rounded-lg bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-slate-300">Verify documents</button><button type="button" onClick={loadSample} className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Load sample shipment</button></div>
        </div><aside className="h-fit rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Required documents</h2><p className="mt-1 text-xs leading-5 text-slate-500">Needed for a complete review. You can continue without them.</p><ul className="mt-4 space-y-3">{coverage.map((item) => <li key={item.type} className="flex items-center gap-2 text-sm"><span aria-label={item.complete ? "Present" : "Missing"} className={item.complete ? "text-emerald-700" : "text-amber-700"}>{item.complete ? "✓" : "!"}</span><span className={item.complete ? "text-slate-700" : "text-slate-600"}>{item.type}</span>{!item.complete && <span className="ml-auto text-[10px] font-semibold uppercase text-amber-800">Missing</span>}</li>)}</ul></aside></div>
      </section>}

      {state.stage === 2 && <section aria-labelledby="processing-heading"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.13em] text-emerald-800">Stage 2 · Processing</p><h1 id="processing-heading" className="mt-2 text-3xl font-bold tracking-tight">Reading your documents</h1><p className="mt-2 text-sm text-slate-600">Each file is extracted independently. A failed file will not stop the others.</p></div><button onClick={cancelProcessing} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Cancel</button></div>
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex justify-between text-sm">
            <span>{state.crossChecking ? "Cross-checking documents" : documents.some((doc) => doc.status === "reading" || doc.status === "extracting") ? "Extracting document fields" : "Preparing document extraction"}</span>
            <span className="font-semibold tabular-nums">{progress}%</span>
          </div>
          <div role="progressbar" aria-label="Document processing progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress} className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-700 transition-all" style={{ width: `${progress}%` }}/>
          </div>
          <ul className="mt-5 divide-y divide-slate-100">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className={`h-2.5 w-2.5 rounded-full ${doc.status === "done" ? "bg-emerald-600" : doc.status === "failed" ? "bg-red-600" : "bg-slate-300"}`}/>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{doc.name}</p>
                    {doc.status === "done" && doc.method && (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        doc.method === "Gemini"
                          ? "bg-purple-100 text-purple-800 border border-purple-200"
                          : doc.method === "fallback"
                          ? "bg-amber-100 text-amber-800 border border-amber-200"
                          : doc.method === "OCR"
                          ? "bg-amber-100 text-amber-800 border border-amber-200"
                          : doc.method === "Text layer"
                          ? "bg-blue-100 text-blue-800 border border-blue-200"
                          : "bg-slate-100 text-slate-700 border border-slate-200"
                      }`}>
                        {doc.method === "Gemini" ? "Read by Gemini" : doc.method === "fallback" ? "Built-in fallback" : doc.method}
                      </span>
                    )}
                  </div>
                  {doc.geminiError && (
                    <p className="mt-1 text-xs text-amber-800 bg-amber-50 rounded px-2 py-1 border border-amber-200">
                      ℹ️ AI unavailable: {doc.geminiError}, used built-in parser
                    </p>
                  )}
                  {doc.warning && !doc.geminiError && (
                    <p className="mt-1 text-xs text-amber-800 bg-amber-50 rounded px-2 py-1 border border-amber-200">
                      ℹ️ {doc.warning}
                    </p>
                  )}
                  {doc.error && <p className="mt-1 text-xs text-red-700">{doc.error}</p>}
                </div>
                <Badge tone={doc.status === "done" ? "green" : doc.status === "failed" ? "red" : doc.status === "skipped" ? "slate" : "blue"}>
                  {statusText(doc)}
                </Badge>
                {doc.status === "failed" && (
                  <div className="flex w-full flex-wrap gap-2 pl-5">
                    <button onClick={() => retryFailed([doc.id])} className="text-xs font-semibold text-emerald-800 underline focus-visible:outline focus-visible:outline-2">Retry</button>
                    <button onClick={() => removeFailed(doc.id)} className="text-xs font-semibold text-slate-600 underline">Remove</button>
                    <button onClick={() => skipFailed(doc.id)} className="text-xs font-semibold text-slate-600 underline">Continue without this file</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {state.crossChecking && <p role="status" className="mt-4 border-t border-slate-100 pt-4 text-sm font-medium text-emerald-800">Cross-checking extracted values and calculating findings…</p>}
          {!state.busy && !state.crossChecking && documents.some((doc) => doc.status === "failed") && (
            <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
              <button onClick={() => retryFailed()} className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white">Retry failed files</button>
              <button onClick={continueWithoutFailed} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Continue without failed files</button>
            </div>
          )}
        </div>
      </section>}

      {state.stage === 3 && result && <section aria-labelledby="findings-heading"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.13em] text-emerald-800">Stage 3 · Findings {state.sample && <span className="ml-2">· Sample data</span>}</p><h1 id="findings-heading" className="mt-2 text-3xl font-bold tracking-tight">Shipment review</h1></div><div className="flex flex-wrap gap-2"><button onClick={() => dispatch({ type: "STAGE", value: 1 })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50">Back to documents</button><button onClick={() => dispatch({ type: "RESET" })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50">Start new shipment</button><button onClick={() => navigator.clipboard.writeText(`Inovix findings — ${result.status}, readiness ${result.score}/100\n${result.findings.map((finding) => `${finding.severity.toUpperCase()}: ${finding.title}; ${finding.message}`).join("\n")}`)} className="rounded-lg bg-emerald-800 px-3 py-2 text-sm font-semibold text-white">Copy summary</button></div></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">Readiness score</p><p className="mt-1 text-3xl font-bold">{result.score}<span className="ml-1 text-sm font-medium text-slate-400">/100</span></p></div><div className="rounded-xl border border-red-100 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">Critical</p><p className="mt-1 text-2xl font-bold text-red-700">{result.summary.critical}</p></div><div className="rounded-xl border border-amber-100 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">Warning</p><p className="mt-1 text-2xl font-bold text-amber-700">{result.summary.warnings}</p></div><div className="rounded-xl border border-emerald-100 bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-500">Passed</p><p className="mt-1 text-2xl font-bold text-emerald-700">{result.summary.passed}</p></div></div>
        <div className="mt-3"><Badge tone={result.status === "Ready" ? "green" : result.status === "Blocked" ? "red" : "amber"}>{result.status}</Badge></div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]"><div className="space-y-5"><section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Shipment details from extracted documents</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">{detailFields.map(([label, field]) => { const source = documents.find((doc) => doc.status === "done" && doc.fields?.[field]); return <div key={field}><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-medium">{source ? source.fields[field] : "Not found in documents"}</p>{source && <p className="mt-0.5 text-[11px] text-slate-500">From {source.name}</p>}</div>; })}</div></section>
          <section className="rounded-xl border border-slate-200 bg-white"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold">Discrepancies</h2><p className="mt-1 text-xs text-slate-500">Edit extracted fields below; findings update from the comparison API.</p></div><label className="text-xs font-semibold text-slate-600">Filter <select value={state.filter} onChange={(event) => dispatch({ type: "FILTER", value: event.target.value })} className="ml-1 rounded border border-slate-300 bg-white px-2 py-1.5"><option value="all">All severities</option><option value="blocker">Critical</option><option value="warning">Warning</option></select></label></div>{visibleFindings.length ? <ul className="divide-y divide-slate-100">{visibleFindings.map((finding) => <li key={finding.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{finding.title}</p><p className="mt-1 text-sm text-slate-600">{finding.message}</p></div><Badge tone={finding.severity === "blocker" ? "red" : "amber"}>{finding.severity === "blocker" ? "Critical" : "Warning"}</Badge></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{finding.evidence.map((item, index) => <div key={`${finding.id}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[11px] font-medium text-slate-500">{item.document}</p><p className="mt-0.5 text-sm font-semibold">{String(item.value)}</p></div>)}</div><div className="mt-3 rounded-lg border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm"><p><strong>Likely wrong:</strong> {finding.likelyWrongDocument || "Needs manual review"}</p><p className="mt-1 text-xs text-slate-700">{finding.likelyWrongReason}</p><p className="mt-2 text-xs"><strong>Suggested fix:</strong> {finding.suggestedFix}</p></div></li>)}</ul> : <div className="p-6 text-sm text-slate-600">No findings at this severity.</div>}</section>
          <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Extracted values · editable</h2><p className="mt-1 text-xs text-slate-500">Edit a field to refresh comparison findings and score.</p><div className="mt-4 space-y-4">{documents.filter((doc) => doc.status === "done").map((doc) => <div key={doc.id} className="rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{doc.name} {doc.method && <span className="ml-1.5 text-xs font-normal text-slate-500">({doc.method === "Gemini" ? "Read by Gemini" : doc.method})</span>}</h3></div><div className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(doc.fields || {}).filter(([, value]) => value !== "" && value !== null && value !== undefined).map(([field, value]) => <label key={field} className="text-xs font-medium text-slate-600">{field}<input defaultValue={String(value)} onBlur={(event) => { if (event.target.value !== String(value)) editField(doc.id, field, event.target.value); }} className="mt-1 block w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"/></label>)}</div><details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5"><summary className="cursor-pointer text-xs font-semibold text-slate-700 hover:text-slate-900 select-none">Raw extracted text / JSON</summary><pre className="mt-2 max-h-60 overflow-auto rounded bg-slate-900 p-3 text-[11px] font-mono text-slate-100 whitespace-pre-wrap">{doc.rawOutput || doc.text || JSON.stringify(doc.fields, null, 2)}</pre></details></div>)}</div></section>
        </div><aside className="space-y-5"><section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Readiness checklist</h2><ul className="mt-4 space-y-3">{result.checklist.map((item) => <li key={item.id} className="flex items-start gap-2 text-sm"><span className={item.passed ? "text-emerald-700" : "text-red-700"}>{item.passed ? "✓" : "×"}</span><span className="text-slate-700">{item.label}</span><Badge tone={item.passed ? "green" : "red"}>{item.passed ? "Pass" : "Fail"}</Badge></li>)}</ul></section>{result.missingDocuments?.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold text-amber-900">Required documents missing</h2><ul className="mt-2 list-inside list-disc text-sm text-amber-900">{result.missingDocuments.map((name) => <li key={name}>{name}</li>)}</ul></section>}</aside></div>
      </section>}
    </div>
  </main>;
}

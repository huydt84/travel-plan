"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../LocaleProvider";
import { localizeAssistantMessage } from "../../lib/i18n-assistant.mjs";
import { apiJson, observeRun } from "./transport.mjs";

// A refresh cannot make a locally expired immutable approval actionable again.
const currentTurn = (turn) => ({ ...turn, actions: turn.actions?.map((action) =>
  action.status === "pending" && action.expiresAt && Date.parse(action.expiresAt) <= Date.now()
    ? { ...action, status: "expired", confirmationToken: null } : action) });

export function useConversation({ initialWorkspace, viewer }) {
  const { t, locale } = useLocale();
  const [workspace, setWorkspace] = useState(initialWorkspace || null);
  const [turns, setTurns] = useState(initialWorkspace?.turns || []);
  const [message, setMessageState] = useState("");
  const [mentions, setMentionsState] = useState([]);
  const [allowedTools, setAllowedToolsState] = useState(initialWorkspace?.availableTools || []);
  const [pinBusy, setPinBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submissionFailure, setSubmissionFailure] = useState(null);
  const [disconnected, setDisconnected] = useState(null);
  const [retrying, setRetrying] = useState(null);
  const sending = useRef(false);
  const [progress, setProgress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const generation = useRef(0), loadController = useRef(null), streamController = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try { const access = await apiJson("/api/v1/assistant/access", { signal: controller.signal });
        if (!controller.signal.aborted) setWorkspace((current) => current ? { ...current,access } : current);
      } catch { /* Request acceptance remains authoritative during a lost connection. */ }
    };
    const timer=setInterval(refresh,15000);
    window.addEventListener("assistant-completed",refresh);window.addEventListener("focus",refresh);
    return () => { controller.abort();clearInterval(timer);window.removeEventListener("assistant-completed",refresh);window.removeEventListener("focus",refresh); };
  }, []);
  const historyGeneration = useRef(0);
  useEffect(() => {
    const refresh = (event) => {
      const latest = new Map();
      for (const run of event.detail) if (!latest.has(run.conversationId)) latest.set(run.conversationId, run.status);
      setWorkspace((current) => current ? { ...current, conversations: current.conversations.map((item) =>
        latest.has(item.id) ? { ...item, status: latest.get(item.id) } : item) } : current);
    };
    window.addEventListener("assistant-runs", refresh);
    return () => window.removeEventListener("assistant-runs", refresh);
  }, []);
  const prefix = `assistant:${viewer.email}:`;
  const persist = useCallback((key, value) => { try { sessionStorage.setItem(prefix + key, value); } catch { /* Draft storage is best-effort; pending submission below is required. */ } }, [prefix]);
  const read = useCallback((key) => { try { return sessionStorage.getItem(prefix + key) || ""; } catch { return ""; } }, [prefix]);
  const draftKey = workspace?.selectedConversation?.id || "new";
  const setMessage = (value) => { setMessageState(value); persist(`draft:${draftKey}`, value); };
  const setMentions = (items) => { setMentionsState(items); persist(`mentions:${draftKey}`, JSON.stringify(items)); };
  const setAllowedTools = (items) => {
    const catalog = workspace?.availableTools || [];
    const selected = Array.isArray(items) ? items : catalog;
    const next = catalog.filter((name) => selected.includes(name));
    setAllowedToolsState(next);
    persist(`tools:${draftKey}`, JSON.stringify(next));
  };
  const addMention = (item) => {
    if (mentions.some((entry) => entry.ref.kind === item.ref.kind && entry.ref.id === item.ref.id)) return;
    if (mentions.length >= 20) { setError("assistantExtra.error.mentions"); return; }
    setMentions([...mentions, item]);
  };
  const changePins = async (items) => {
    if (pinBusy || submitting || workspace?.access?.enabled === false) return;
    if (items.length > 20) { setError("assistantExtra.error.pins"); return; }
    const token = generation.current;
    setPinBusy(true);
    try {
      if (workspace?.selectedConversation) {
        const next = await apiJson(`/api/v1/assistant/conversations/${workspace.selectedConversation.id}/pins`, {
          method: "PUT", body: JSON.stringify({ pins: items.map((item) => item.ref), version: workspace.selectedConversation.pinsVersion || 0 }),
        });
        if (token === generation.current) setWorkspace((current) => ({ ...current, pins: next.pins, selectedConversation: next.conversation }));
      } else {
        persist("pins:new", JSON.stringify(items));
        setWorkspace((current) => ({ ...current, pins: items }));
      }
    } catch (failure) { if (token === generation.current) setError(failure.message); }
    finally { setPinBusy(false); }
  };
  const pin = (item) => {
    const pins = workspace?.pins || [];
    if (!pins.some((entry) => entry.ref.kind === item.ref.kind && entry.ref.id === item.ref.id)) void changePins([...pins, item]);
  };
  const unpin = (item) => changePins((workspace?.pins || []).filter((entry) => entry.ref.kind !== item.ref.kind || entry.ref.id !== item.ref.id));

  const syncUrl = useCallback((trip, conversation, replace = false) => {
    const url = new URL(window.location.href);
    // A load finishing during the closing animation must not reopen the companion.
    if (url.pathname !== "/assistant" && url.searchParams.get("chat") !== "1") return;
    void trip; // Tracker navigation is independent of conversation navigation.
    if (conversation) url.searchParams.set("conversation", conversation); else url.searchParams.delete("conversation");
    if (url.pathname !== "/assistant") url.searchParams.set("chat", "1");
    if (url.href !== window.location.href) window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    persist("conversation", conversation || "new");
  }, [persist]);

  const observe = useCallback((turn, token) => {
    streamController.current?.abort();
    setDisconnected(null);
    const controller = new AbortController(); streamController.current = controller;
    // Rebuild partial output from the persisted event log on each attachment.
    void observeRun(turn.id, (event) => {
      if (generation.current !== token) return;
      if (event.type === "progress") setProgress({ label: event.label, values: event.values });
      if (event.type === "answer-delta") setTurns((items) => items.map((item) => item.id === turn.id ? { ...item, output: event.reset ? event.text : (item.output || "") + event.text } : item));
      if (event.type === "evidence") setTurns((items) => items.map((item) => item.id === turn.id ? { ...item, citations: event.citations } : item));
      if (event.turn) {
        setTurns((items) => items.map((item) => item.id === turn.id ? event.turn : item));
        setProgress("");
        window.dispatchEvent(new Event("assistant-completed"));
      }
    }, controller.signal).catch((failure) => { if (generation.current === token && !controller.signal.aborted) { setDisconnected({ turnId: turn.id, status: failure.status }); setProgress(""); } });
  }, []);

  const refreshConversation = async (conversationId) => {
    const token = generation.current;
    const next = await apiJson(`/api/v1/assistant/workspace?conversation=${conversationId}`);
    if (token !== generation.current) return;
    const latest = new Map(next.turns.map((turn) => [turn.id, currentTurn(turn)]));
    setTurns((items) => items.map((turn) => latest.get(turn.id) || turn));
    setWorkspace((current) => current ? { ...current, activeHandoff: next.activeHandoff,
      handoffs: next.handoffs, handoffMessages: next.handoffMessages } : current);
    const resumed = next.turns.find((turn) => turn.status === "running");
    if (resumed) observe(resumed, token);
    return next;
  };

  const activeHandoffId = workspace?.activeHandoff?.id;
  const activeConversationId = workspace?.selectedConversation?.id;
  useEffect(() => {
    if (!activeHandoffId || !activeConversationId) return;
    let disposed=false,inFlight=false;
    const refresh=async()=>{if(inFlight)return;inFlight=true;try{
      const next=await apiJson(`/api/v1/assistant/workspace?conversation=${activeConversationId}`);
      if(!disposed){setWorkspace(current=>current ? {...current,activeHandoff:next.activeHandoff,handoffs:next.handoffs,handoffMessages:next.handoffMessages} : current);setTurns(next.turns.map(currentTurn));}
    }catch{/* Keep the local transcript visible and retry on the next interval. */}finally{inFlight=false;}};
    const timer=setInterval(refresh,3000);window.addEventListener("focus",refresh);
    return()=>{disposed=true;clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[activeHandoffId,activeConversationId]);

  const waitingTurnId = turns.find((turn) => ["awaiting_approval", "awaiting_input"].includes(turn.status))?.id;
  const waitingConversationId = workspace?.selectedConversation?.id;
  useEffect(() => {
    if (!waitingTurnId || !waitingConversationId) return;
    let disposed = false, inFlight = false;
    const token = generation.current;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await apiJson(`/api/v1/assistant/workspace?conversation=${waitingConversationId}`);
        if (disposed || token !== generation.current) return;
        setTurns(next.turns.map(currentTurn));
        const resumed = next.turns.find((t) => t.id === waitingTurnId && t.status === "running");
        if (resumed) observe(resumed, token);
      } catch { /* Approval endpoints remain authoritative; keep the review visible. */ }
      finally { inFlight = false; }
    };
    const timer = setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [waitingTurnId, waitingConversationId, observe]);

  const load = useCallback(async ({ trip, conversation = null, replace = false, navigation = true } = {}) => {
    const token = ++generation.current;
    loadController.current?.abort(); streamController.current?.abort();
    const controller = new AbortController(); loadController.current = controller;
    setLoading(true); setError(""); setProgress(""); setDisconnected(null); setSubmissionFailure(null);
    try {
      const params = new URLSearchParams({ allTrips: "1" });
      const draftKey = conversation && conversation !== "new" ? conversation : "new";
      if (conversation && conversation !== "new") params.set("conversation", conversation);
      let pending;
      try { pending = JSON.parse(read(`pending:${draftKey}`) || "null"); } catch { pending = null; }
      if (pending && (!conversation || conversation === "new" || conversation === pending.conversationId)) params.set("request", pending.clientTurnId);
      const next = await apiJson(`/api/v1/assistant/workspace?${params}`, { signal: controller.signal });
      if (generation.current !== token) return;
      if (next.request?.found) {
        persist(`pending:${draftKey}`, "");
        if (!pending?.retryOfTurnId) persist(`mentions:${draftKey}`, "[]");
        if (!pending?.retryOfTurnId && read(`draft:${draftKey}`) === pending?.message) persist(`draft:${draftKey}`, "");
      } else if (pending) setSubmissionFailure({ body: pending, trip, message: "assistantExtra.error.unconfirmed" });
      if (conversation === "new" && !next.request?.found) { next.selectedConversation = null; next.turns = []; next.nextCursor = null; }
      setWorkspace(next); setTurns(next.turns);
      const nextKey = next.selectedConversation?.id || "new";
      if (next.request?.found && nextKey !== draftKey) { persist(`draft:${nextKey}`, read(`draft:${draftKey}`)); persist(`draft:${draftKey}`, ""); persist("pins:new", "[]"); }
      if (!next.selectedConversation) { try { next.pins = JSON.parse(read("pins:new") || "[]"); } catch { next.pins = []; } }
      setMessageState(read(`draft:${nextKey}`));
      try { setMentionsState(JSON.parse(read(`mentions:${nextKey}`) || "[]")); } catch { setMentionsState([]); }
      try {
        const stored = read(`tools:${nextKey}`);
        const selected = stored ? JSON.parse(stored) : next.availableTools;
        setAllowedToolsState(next.availableTools.filter((name) => selected.includes(name)));
      } catch { setAllowedToolsState(next.availableTools); }
      if (navigation) syncUrl(next.selectedTripSlug, next.selectedConversation?.id, replace);
      const running = next.turns.find((turn) => turn.status === "running");
      if (running) { setTurns(next.turns.map((turn) => turn.id === running.id ? { ...turn, output: "" } : turn)); observe(running, token); }
    } catch (failure) { if (generation.current === token && !controller.signal.aborted) setError(failure.message); }
    finally { if (generation.current === token) setLoading(false); }
  }, [observe, persist, read, syncUrl]);

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const trip = params.get("trip");
    let active = true;
    queueMicrotask(() => { if (active) void load({ trip, conversation: params.get("conversation") || read("conversation") || null, replace: true }); });
    const pop = () => {
      const params = new URL(window.location.href).searchParams;
      void load({ trip: params.get("trip"), conversation: params.get("conversation") || "new", navigation: false });
    };
    window.addEventListener("popstate", pop);
    return () => { active = false; loadController.current?.abort(); streamController.current?.abort(); window.removeEventListener("popstate", pop); };
  }, [load, read]);

  const selectConversation = (conversation) => void load({ conversation: conversation.id });
  const newConversation = () => {
    const all = workspace?.availableTools || [];
    setAllowedToolsState(all);
    persist("tools:new", JSON.stringify(all));
    void load({ conversation: "new" });
  };
  const send = async (input = message.trim(), retryRequest = null) => {
    if (!input || sending.current || submitting || pinBusy || loading || turns.some((turn) => ["running", "awaiting_approval", "awaiting_input"].includes(turn.status))) return;
    const token = generation.current;
    const trip = null;
    const body = retryRequest || { clientTurnId: crypto.randomUUID(), conversationId: workspace.selectedConversation?.id || null, message: input, locale, mentions: mentions.map((item) => item.ref), allowedTools,
      ...(!workspace.selectedConversation ? { initialPins: (workspace.pins || []).map((item) => item.ref) } : {}) };
    try { sessionStorage.setItem(prefix + `pending:${draftKey}`, JSON.stringify(body)); }
    catch { setError("assistantExtra.error.storage"); return; }
    sending.current = true; setSubmitting(true); setError(""); setSubmissionFailure(null);
    setRetrying(body.retryOfTurnId || null);
    try {
      let accepted;
      try {
        accepted = await apiJson("/api/v1/assistant/turns", { method: "POST", body: JSON.stringify(body) });
        if (!accepted.conversationId || (accepted.mode !== "handoff" && !accepted.runId)) throw new Error("assistantExtra.error.acceptance");
      } catch (failure) {
        if (failure.status && failure.status < 500) { persist(`pending:${draftKey}`, ""); throw failure; }
        const recovered = await apiJson(`/api/v1/assistant/workspace?request=${body.clientTurnId}`);
        if (!recovered.request?.found) throw failure;
        accepted = recovered.request.mode === "handoff"
          ? { mode:"handoff",conversationId:recovered.selectedConversation.id,message:recovered.request.message,handoff:recovered.request.handoff }
          : { mode:"assistant",runId:recovered.request.turn.id,conversationId:recovered.selectedConversation.id,turn:recovered.request.turn };
      }
      persist(`pending:${draftKey}`, "");
      if (!body.retryOfTurnId && read(`draft:${draftKey}`) === body.message) persist(`draft:${draftKey}`, "");
      persist("conversation", accepted.conversationId);
      if (draftKey === "new") persist("pins:new", "[]");
      if (generation.current !== token) return;
      const saved = accepted.mode === "handoff" ? null : accepted.turn || { id: accepted.runId, clientTurnId: body.clientTurnId, input, output: "", citations: [], status: accepted.status || "running" };
      const turn = saved?.status === "running" ? { ...saved, output: "" } : saved;
      if (draftKey !== accepted.conversationId) {
        persist(`draft:${accepted.conversationId}`, read(`draft:${draftKey}`)); persist(`draft:${draftKey}`, "");
        persist(`tools:${accepted.conversationId}`, JSON.stringify(body.allowedTools));
      }
      setMessageState(read(`draft:${accepted.conversationId}`));
      if (!body.retryOfTurnId) { setMentionsState([]); persist(`mentions:${draftKey}`, "[]"); }
      setWorkspace((next) => ({ ...next,
        selectedConversation: { ...next.selectedConversation, id: accepted.conversationId, title: next.selectedConversation?.title || input, pinsVersion: next.selectedConversation?.pinsVersion || 0 },
        ...(accepted.mode === "handoff" ? { activeHandoff:accepted.handoff?.status === "active" ? accepted.handoff : null,
          handoffs:[...(next.handoffs || []).filter(item=>item.id!==accepted.handoff.id),accepted.handoff],
          handoffMessages:[...(next.handoffMessages || []).filter(item=>item.id!==accepted.message.id),accepted.message] } : {}) }));
      syncUrl(trip, accepted.conversationId, true);
      if (turn) setTurns((items) => {
        const index = items.findIndex((item) => item.id === body.retryOfTurnId || item.id === turn.id);
        if (index < 0) return [...items, turn];
        return items.map((item, i) => i === index ? turn : item);
      });
      if (turn?.status === "running") { setProgress("assistantExtra.progress.waiting"); observe(turn, token); }
      else setProgress("");
      window.dispatchEvent(new Event("assistant-completed"));
    } catch (failure) {
      if (generation.current === token) setSubmissionFailure({ body, trip, status: failure.status, code: failure.code,
        message: failure.status && failure.status < 500 ? failure.message : "assistantExtra.answerStartFailed" });
    } finally { sending.current = false; setSubmitting(false); setRetrying(null); }
  };
  const retry = (turn) => {
    let pending;
    try { pending = JSON.parse(read(`pending:${draftKey}`) || "null"); } catch { pending = null; }
    if (pending && pending.retryOfTurnId !== turn.id) { setError("assistantExtra.error.previousReconnect"); return; }
    return send(turn.input, pending || { clientTurnId: crypto.randomUUID(),
      conversationId: workspace.selectedConversation.id, message: turn.input, mentions: turn.mentions || [], allowedTools: turn.allowedTools || workspace.availableTools, retryOfTurnId: turn.id });
  };
  const replace = async (turn, input = turn.input) => {
    const nextInput = input.trim();
    if (!nextInput || sending.current || submitting || pinBusy || loading || turns.some((item) => ["running", "awaiting_approval", "awaiting_input"].includes(item.status))) return false;
    const token = generation.current;
    const body = { clientTurnId: crypto.randomUUID(), message: nextInput };
    const pendingKey = `replace:${turn.id}`;
    try { sessionStorage.setItem(prefix + pendingKey, JSON.stringify(body)); }
    catch { setError("assistantExtra.error.storage"); return false; }
    sending.current = true; setSubmitting(true); setRetrying(turn.id); setError(""); setSubmissionFailure(null);
    try {
      let accepted;
      try {
        accepted = await apiJson(`/api/v1/assistant/turns/${turn.id}/regenerate`, { method: "POST", body: JSON.stringify(body) });
        if (!accepted.runId || !accepted.turn) throw new Error("assistantExtra.error.acceptance");
      } catch (failure) {
        if (failure.status && failure.status < 500) throw failure;
        const recovered = await apiJson(`/api/v1/assistant/workspace?request=${body.clientTurnId}`);
        if (!recovered.request?.found || recovered.request.turn.id !== turn.id) throw failure;
        accepted = { runId: turn.id, turn: recovered.request.turn };
      }
      persist(pendingKey, "");
      if (generation.current !== token) return false;
      const replacement = accepted.turn.status === "running" ? { ...accepted.turn, output: "" } : accepted.turn;
      setTurns((items) => items.map((item) => item.id === turn.id ? replacement : item));
      if (replacement.status === "running") { setProgress("assistantExtra.progress.waiting"); observe(replacement, token); }
      else setProgress("");
      return true;
    } catch (failure) {
      if (generation.current === token) setError(failure.message);
      return false;
    } finally { sending.current = false; setSubmitting(false); setRetrying(null); }
  };
  const reconnect = () => {
    const turn = turns.find((item) => item.id === disconnected?.turnId);
    if (!turn) return;
    setTurns((items) => items.map((item) => item.id === turn.id ? { ...item, output: "" } : item));
    observe(turn, generation.current);
  };
  const retrySubmission = () => submissionFailure && send(submissionFailure.body.message, submissionFailure.body);
  const submit = () => {
    let pending;
    try { pending = JSON.parse(read(`pending:${draftKey}`) || "null"); } catch { pending = null; }
    if (pending && pending.message !== message.trim()) {
      setSubmissionFailure({ body: pending, trip: workspace.selectedTripSlug, message: "assistantExtra.error.previousRetry" });
      return;
    }
    return send(pending?.message || message.trim(), pending);
  };
  const stop = async () => {
    const turn = turns.find((item) => ["running", "awaiting_approval", "awaiting_input"].includes(item.status));
    if (!turn) return;
    const token = generation.current;
    try {
      const result = await apiJson(`/api/v1/assistant/runs/${turn.id}`, { method: "POST" });
      if (generation.current !== token) return;
      streamController.current?.abort(); setProgress(""); setTurns((items) => items.map((item) => item.id === turn.id ? result : item));
      window.dispatchEvent(new Event("assistant-completed"));
    } catch (failure) { if (generation.current === token) setError(failure.message); }
  };
  const history = async (more = false) => {
    const token = generation.current;
    const request = ++historyGeneration.current;
    const params = new URLSearchParams();
    setHistoryLoading(true); setHistoryError("");
    if (more && workspace.historyCursor) params.set("historyBefore", workspace.historyCursor);
    try {
      const next = await apiJson(`/api/v1/assistant/workspace?${params}`);
      if (token !== generation.current || request !== historyGeneration.current) return;
      setWorkspace((current) => ({ ...current, historyCursor: next.historyCursor,
        conversations: more ? [...current.conversations, ...next.conversations.filter((item) => !current.conversations.some((old) => old.id === item.id))] : next.conversations }));
    } catch (failure) { if (token === generation.current && request === historyGeneration.current) setHistoryError(failure.message); }
    finally { if (request === historyGeneration.current) setHistoryLoading(false); }
  };
  const older = async () => {
    const token = generation.current;
    const params = new URLSearchParams({ conversation: workspace.selectedConversation.id, before: workspace.nextCursor });
    try { const next = await apiJson(`/api/v1/assistant/workspace?${params}`); if (token !== generation.current) return;
      setWorkspace((current) => ({ ...current, nextCursor: next.nextCursor }));
      setTurns((current) => [...next.turns.filter((item) => !current.some((old) => old.id === item.id)), ...current]);
    } catch (failure) { if (token === generation.current) setError(failure.message); }
  };
  return { workspace, turns, setTurns, message, setMessage, loading, error: localizeAssistantMessage(t, error), setError, progress: localizeAssistantMessage(t, progress), submitting, historyLoading, historyError: localizeAssistantMessage(t, historyError),
    mentions, addMention, setMentions, allowedTools, setAllowedTools, pin, unpin, pinBusy, load, selectConversation, newConversation, submit, send, stop, history, older,
    refreshConversation, retry, replace, retrying, submissionFailure: submissionFailure ? { ...submissionFailure, message: localizeAssistantMessage(t, submissionFailure.message) } : null, retrySubmission, disconnected, reconnect };
}

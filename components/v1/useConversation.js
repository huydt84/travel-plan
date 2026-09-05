"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, observeRun } from "./transport.mjs";

export function useConversation({ initialWorkspace, viewer, tripSlug, onTripChange }) {
  const [workspace, setWorkspace] = useState(initialWorkspace || null);
  const [turns, setTurns] = useState(initialWorkspace?.turns || []);
  const [message, setMessageState] = useState("");
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
  const setMessage = (value) => { setMessageState(value); persist(`draft:${workspace?.selectedTripSlug}`, value); };
  const syncUrl = useCallback((trip, conversation, replace = false) => {
    const url = new URL(window.location.href);
    // A load finishing during the closing animation must not reopen the companion.
    if (url.pathname !== "/assistant" && url.searchParams.get("chat") !== "1") return;
    url.searchParams.set("trip", trip);
    if (conversation) url.searchParams.set("conversation", conversation); else url.searchParams.delete("conversation");
    if (url.pathname !== "/assistant") url.searchParams.set("chat", "1");
    if (url.href !== window.location.href) window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    persist(`conversation:${trip}`, conversation || "new");
  }, [persist]);

  const observe = useCallback((turn, token) => {
    streamController.current?.abort();
    setDisconnected(null);
    const controller = new AbortController(); streamController.current = controller;
    // Rebuild partial output from the persisted event log on each attachment.
    void observeRun(turn.id, (event) => {
      if (generation.current !== token) return;
      if (event.type === "progress") setProgress(event.label);
      if (event.type === "answer-delta") setTurns((items) => items.map((item) => item.id === turn.id ? { ...item, output: event.reset ? event.text : (item.output || "") + event.text } : item));
      if (event.type === "evidence") setTurns((items) => items.map((item) => item.id === turn.id ? { ...item, citations: event.citations } : item));
      if (event.turn) {
        setTurns((items) => items.map((item) => item.id === turn.id ? event.turn : item));
        setProgress("");
        window.dispatchEvent(new Event("assistant-completed"));
      }
    }, controller.signal).catch((failure) => { if (generation.current === token && !controller.signal.aborted) { setDisconnected({ turnId: turn.id, status: failure.status }); setProgress(""); } });
  }, []);

  const load = useCallback(async ({ trip, conversation = null, replace = false, navigation = true } = {}) => {
    const token = ++generation.current;
    loadController.current?.abort(); streamController.current?.abort();
    const controller = new AbortController(); loadController.current = controller;
    setLoading(true); setError(""); setProgress(""); setDisconnected(null); setSubmissionFailure(null);
    try {
      const params = new URLSearchParams({ allTrips: "1" });
      if (trip) params.set("trip", trip);
      if (conversation && conversation !== "new") params.set("conversation", conversation);
      let pending;
      try { pending = JSON.parse(read(`pending:${trip}`) || "null"); } catch { pending = null; }
      if (pending && conversation !== "new" && (!conversation || conversation === pending.conversationId)) params.set("request", pending.clientTurnId);
      const next = await apiJson(`/api/v1/assistant/workspace?${params}`, { signal: controller.signal });
      if (generation.current !== token) return;
      if (next.request?.found) {
        persist(`pending:${trip}`, "");
        if (!pending?.retryOfTurnId && read(`draft:${trip}`) === pending?.message) persist(`draft:${trip}`, "");
      } else if (pending) setSubmissionFailure({ body: pending, trip, message: "Chưa xác nhận được yêu cầu. Hãy thử lại." });
      if (conversation === "new") { next.selectedConversation = null; next.turns = []; next.nextCursor = null; }
      setWorkspace(next); setTurns(next.turns);
      setMessageState(read(`draft:${next.selectedTripSlug}`));
      if (navigation) syncUrl(next.selectedTripSlug, next.selectedConversation?.id, replace);
      const running = next.turns.find((turn) => turn.status === "running");
      if (running) { setTurns(next.turns.map((turn) => turn.id === running.id ? { ...turn, output: "" } : turn)); observe(running, token); }
    } catch (failure) { if (generation.current === token && !controller.signal.aborted) setError(failure.message); }
    finally { if (generation.current === token) setLoading(false); }
  }, [observe, persist, read, syncUrl]);

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const trip = tripSlug || params.get("trip") || initialWorkspace?.selectedTripSlug;
    let active = true;
    queueMicrotask(() => { if (active) void load({ trip, conversation: params.get("conversation") || read(`conversation:${trip}`) || null, replace: true }); });
    const pop = () => {
      const params = new URL(window.location.href).searchParams;
      void load({ trip: params.get("trip"), conversation: params.get("conversation") || "new", navigation: false });
    };
    window.addEventListener("popstate", pop);
    return () => { active = false; loadController.current?.abort(); streamController.current?.abort(); window.removeEventListener("popstate", pop); };
  }, [tripSlug, initialWorkspace?.selectedTripSlug, load, read]);

  const selectTrip = (trip) => {
    onTripChange?.(trip);
    void load({ trip, conversation: read(`conversation:${trip}`) || null });
  };
  const selectConversation = (conversation) => {
    if (conversation.tripSlug !== workspace.selectedTripSlug) onTripChange?.(conversation.tripSlug);
    void load({ trip: conversation.tripSlug, conversation: conversation.id });
  };
  const newConversation = () => void load({ trip: workspace.selectedTripSlug, conversation: "new" });
  const send = async (input = message.trim(), retryRequest = null) => {
    if (!input || sending.current || submitting || loading || turns.some((turn) => turn.status === "running")) return;
    const token = generation.current;
    const trip = workspace.selectedTripSlug;
    const body = retryRequest || { clientTurnId: crypto.randomUUID(), conversationId: workspace.selectedConversation?.id || null, message: input };
    try { sessionStorage.setItem(prefix + `pending:${trip}`, JSON.stringify(body)); }
    catch { setError("Hãy bật lưu trữ phiên để gửi yêu cầu có thể khôi phục."); return; }
    sending.current = true; setSubmitting(true); setError(""); setSubmissionFailure(null);
    setRetrying(body.retryOfTurnId || null);
    try {
      let accepted;
      try {
        accepted = await apiJson(`/api/v1/trips/${encodeURIComponent(trip)}/assistant/turns`, { method: "POST", body: JSON.stringify(body) });
        if (!accepted.runId || !accepted.conversationId) throw new Error("Mất xác nhận tiếp nhận");
      } catch (failure) {
        if (failure.status && failure.status < 500) { persist(`pending:${trip}`, ""); throw failure; }
        const recovered = await apiJson(`/api/v1/assistant/workspace?trip=${encodeURIComponent(trip)}&request=${body.clientTurnId}`);
        if (!recovered.request?.found) throw failure;
        accepted = { runId: recovered.request.turn.id, conversationId: recovered.selectedConversation.id, turn: recovered.request.turn };
      }
      persist(`pending:${trip}`, "");
      if (!body.retryOfTurnId && read(`draft:${trip}`) === body.message) persist(`draft:${trip}`, "");
      persist(`conversation:${trip}`, accepted.conversationId);
      if (generation.current !== token) return;
      const saved = accepted.turn || { id: accepted.runId, clientTurnId: body.clientTurnId, input, output: "", citations: [], status: accepted.status || "running" };
      const turn = saved.status === "running" ? { ...saved, output: "" } : saved;
      setMessageState(read(`draft:${trip}`));
      setWorkspace((next) => ({ ...next, selectedConversation: { id: accepted.conversationId, tripSlug: trip, title: input } }));
      syncUrl(trip, accepted.conversationId, true);
      setTurns((items) => {
        const index = items.findIndex((item) => item.id === body.retryOfTurnId || item.id === turn.id);
        if (index < 0) return [...items, turn];
        return items.map((item, i) => i === index ? turn : item);
      });
      if (turn.status === "running") { setProgress("Đang chờ trợ lý"); observe(turn, token); }
      else setProgress("");
      window.dispatchEvent(new Event("assistant-completed"));
    } catch (failure) {
      if (generation.current === token) setSubmissionFailure({ body, trip, status: failure.status, code: failure.code,
        message: failure.status && failure.status < 500 ? failure.message : "Không thể bắt đầu trả lời. Hãy thử lại." });
    } finally { sending.current = false; setSubmitting(false); setRetrying(null); }
  };
  const retry = (turn) => {
    let pending;
    try { pending = JSON.parse(read(`pending:${workspace.selectedTripSlug}`) || "null"); } catch { pending = null; }
    if (pending && pending.retryOfTurnId !== turn.id) { setError("Chưa xác nhận được yêu cầu trước. Hãy kết nối lại trước khi gửi yêu cầu khác."); return; }
    return send(turn.input, pending || { clientTurnId: crypto.randomUUID(),
      conversationId: workspace.selectedConversation.id, message: turn.input, retryOfTurnId: turn.id });
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
    try { pending = JSON.parse(read(`pending:${workspace.selectedTripSlug}`) || "null"); } catch { pending = null; }
    if (pending && pending.message !== message.trim()) {
      setSubmissionFailure({ body: pending, trip: workspace.selectedTripSlug, message: "Chưa xác nhận được yêu cầu trước. Thử lại yêu cầu đó trước khi gửi nội dung khác." });
      return;
    }
    return send(pending?.message || message.trim(), pending);
  };
  const stop = async () => {
    const turn = turns.find((item) => item.status === "running");
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
    const params = new URLSearchParams({ trip: workspace.selectedTripSlug, allTrips: "1" });
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
    const params = new URLSearchParams({ trip: workspace.selectedTripSlug, conversation: workspace.selectedConversation.id, before: workspace.nextCursor });
    try { const next = await apiJson(`/api/v1/assistant/workspace?${params}`); if (token !== generation.current) return;
      setWorkspace((current) => ({ ...current, nextCursor: next.nextCursor }));
      setTurns((current) => [...next.turns.filter((item) => !current.some((old) => old.id === item.id)), ...current]);
    } catch (failure) { if (token === generation.current) setError(failure.message); }
  };
  return { workspace, turns, setTurns, message, setMessage, loading, error, setError, progress, submitting, historyLoading, historyError,
    load, selectTrip, selectConversation, newConversation, submit, send, stop, history, older,
    retry, retrying, submissionFailure, retrySubmission, disconnected, reconnect };
}

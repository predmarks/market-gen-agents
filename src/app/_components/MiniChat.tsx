'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { ActivityCard } from './ActivityCard';
import type { ActivityEntry } from './ActivityCard';
import { usePageContext } from './PageContext';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  activityIds?: string[];
}

interface Conversation {
  id: string;
  contextType: string;
  contextId: string | null;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
}

interface ChatContext {
  type: 'topic' | 'market' | 'signal' | 'newsletter' | 'global';
  id: string | null;
  label: string;
}

function detectContext(pathname: string): ChatContext {
  const topicMatch = pathname.match(/\/dashboard\/topics\/([^/]+)$/);
  if (topicMatch) {
    return { type: 'topic', id: null, label: `Tema: ${decodeURIComponent(topicMatch[1])}` };
  }
  const marketMatch = pathname.match(/\/dashboard\/markets\/([^/]+)$/);
  if (marketMatch) {
    return { type: 'market', id: marketMatch[1], label: 'Mercado' };
  }
  const newsletterMatch = pathname.match(/\/dashboard\/newsletter\/([^/]+)$/);
  if (newsletterMatch) {
    return { type: 'newsletter', id: newsletterMatch[1], label: 'Newsletter' };
  }
  if (pathname === '/dashboard/topics') return { type: 'global', id: null, label: 'Temas' };
  if (pathname === '/dashboard/signals') return { type: 'global', id: null, label: 'Señales' };
  if (pathname === '/dashboard/mercados') return { type: 'global', id: null, label: 'Mercados' };
  if (pathname === '/dashboard/newsletter') return { type: 'global', id: null, label: 'Newsletter' };
  if (pathname === '/dashboard/rules') return { type: 'global', id: null, label: 'Reglas' };
  if (pathname === '/dashboard/feedback') return { type: 'global', id: null, label: 'Feedback' };
  return { type: 'global', id: null, label: 'General' };
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

function PersistedActivityCards({ activityIds }: { activityIds: string[] }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/activity?ids=${activityIds.join(',')}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && data?.entries) setEntries(data.entries);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activityIds]);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-1.5 mx-1 p-2 bg-gray-50 rounded border border-gray-100 mt-1">
      {entries.map((entry) => (
        <ActivityCard key={entry.id} entry={entry} compact />
      ))}
    </div>
  );
}

export function MiniChat() {
  const pathname = usePathname();
  const router = useRouter();
  const { pageData } = usePageContext();
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<ChatContext>(() => detectContext(pathname));
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatListOpen, setChatListOpen] = useState(false);
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [width, setWidth] = useState(384); // 24rem = w-96
  const [pollingEntries, setPollingEntries] = useState<ActivityEntry[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load width from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('minichat-width');
    if (saved) setWidth(Math.min(600, Math.max(280, Number(saved))));
  }, []);

  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newWidth = Math.min(600, Math.max(280, startWidth + (ev.clientX - startX)));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      dragging.current = false;
      localStorage.setItem('minichat-width', String(width));
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  // Detect context from pathname — resolve topic slugs to IDs
  useEffect(() => {
    const newCtx = detectContext(pathname);

    if (newCtx.type === 'topic' && !newCtx.id) {
      const slug = pathname.split('/').pop();
      if (slug) {
        fetch(`/api/topics/${slug}`)
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data?.topic) {
              setContext({ type: 'topic', id: data.topic.id, label: newCtx.label });
            } else {
              setContext(newCtx);
            }
          })
          .catch(() => setContext(newCtx));
      } else {
        setContext(newCtx);
      }
    } else {
      setContext(newCtx);
    }
  }, [pathname]);

  const [hasMoreConvs, setHasMoreConvs] = useState(false);
  const [totalConvs, setTotalConvs] = useState(0);
  const [convsOffset, setConvsOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const CONVS_PAGE_SIZE = 10;

  const fetchConversations = useCallback(async (offset = 0, append = false) => {
    try {
      const params = new URLSearchParams({ limit: String(CONVS_PAGE_SIZE), offset: String(offset) });
      if (context.type !== 'global' && context.id) {
        params.set('contextType', context.type);
        params.set('contextId', context.id);
      }
      const res = await fetch(`/api/chat?${params}`);
      if (res.ok) {
        const data = await res.json();
        const newConvs = data.conversations ?? [];
        setConversations((prev) => append ? [...prev, ...newConvs] : newConvs);
        setHasMoreConvs(data.hasMore ?? false);
        setTotalConvs(data.total ?? 0);
        setConvsOffset(offset + newConvs.length);
      }
    } catch { /* ignore */ }
  }, [context.type, context.id]);

  const loadMoreConversations = useCallback(async () => {
    if (loadingMore || !hasMoreConvs) return;
    setLoadingMore(true);
    await fetchConversations(convsOffset, true);
    setLoadingMore(false);
  }, [loadingMore, hasMoreConvs, convsOffset, fetchConversations]);

  const handleConvListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      loadMoreConversations();
    }
  }, [loadMoreConversations]);

  useEffect(() => {
    if (open) {
      setConvsOffset(0);
      fetchConversations(0, false);
    }
  }, [open, pathname, fetchConversations]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Reset chat when context changes
  useEffect(() => {
    setActiveConvId(null);
    setMessages([]);
    setError(null);
    setActivityEntries([]);
    setPollingEntries([]);
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  }, [pathname]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  // Poll for background job completion
  const COMPLETION_MAP: Record<string, string[]> = {
    generation_started: ['generation_completed'],
    review_started: ['review_completed'],
    ingestion_started: ['ingestion_completed', 'ingestion_failed'],
    resolution_check_started: ['resolution_flagged', 'resolution_unclear', 'resolution_emergency'],
    topic_research_started: ['topic_research_completed'],
  };

  function startPollingForCompletion(entries: ActivityEntry[]) {
    const backgroundActions = entries.filter((e) => COMPLETION_MAP[e.action]);
    if (backgroundActions.length === 0) return;

    const since = backgroundActions[0].createdAt;
    const targetActions = backgroundActions.flatMap((e) => COMPLETION_MAP[e.action]);
    let attempts = 0;
    const maxAttempts = 60; // 5 min at 5s intervals

    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        return;
      }

      try {
        for (const action of targetActions) {
          const res = await fetch(`/api/activity?action=${action}&since=${encodeURIComponent(since)}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (data.entries?.length > 0) {
            setPollingEntries((prev) => {
              const existingIds = new Set(prev.map((e: ActivityEntry) => e.id));
              const newEntries = data.entries.filter((e: ActivityEntry) => !existingIds.has(e.id));
              return [...prev, ...newEntries];
            });
            if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
            router.refresh();
            return;
          }
        }
      } catch { /* ignore */ }
    }, 5000);
  }

  function handleNewConversation() {
    setActiveConvId(null);
    setMessages([]);
    setError(null);
    setActivityEntries([]);
    setPollingEntries([]);
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  }

  function handleLoadConversation(conv: Conversation) {
    // Don't load conversations from a different context — prevents operating on wrong entity
    if (context.id && conv.contextId && conv.contextId !== context.id) return;
    setActiveConvId(conv.id);
    setMessages(conv.messages);
    setError(null);
    setActivityEntries([]);
    setPollingEntries([]);
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  }

  async function handleDeleteConversation(convId: string) {
    await fetch(`/api/chat?id=${convId}`, { method: 'DELETE' });
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    if (activeConvId === convId) {
      setActiveConvId(null);
      setMessages([]);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);
    setError(null);
    setActivityEntries([]);

    try {
      const effectiveId = context.id;
      console.log('[MiniChat] sending', { contextType: context.type, contextId: effectiveId, pathname });
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages,
          contextType: context.type,
          contextId: effectiveId,
          conversationId: activeConvId,
          ...(pageData ? { pageContext: pageData } : {}),
        }),
        signal: AbortSignal.timeout(300_000), // 5 min for multi-turn
      });

      if (!res.ok) {
        let errorMsg = `Error (${res.status})`;
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch { /* empty response body */ }
        throw new Error(errorMsg);
      }

      const { conversation, conversationId, redirect, activityIds } = await res.json();
      if (conversation) setMessages(conversation);
      if (conversationId && !activeConvId) setActiveConvId(conversationId);
      fetchConversations();

      // Fetch activity entries if any tools were executed
      setPollingEntries([]);
      if (activityIds?.length > 0) {
        try {
          const actRes = await fetch(`/api/activity?ids=${activityIds.join(',')}`);
          if (actRes.ok) {
            const actData = await actRes.json();
            const entries = actData.entries ?? [];
            setActivityEntries(entries);
            startPollingForCompletion(entries);
          }
        } catch { /* ignore */ }
      } else {
        setActivityEntries([]);
      }

      if (redirect && redirect !== pathname) {
        router.push(redirect);
      } else {
        router.refresh();
      }

      // Notify page components that chat made changes
      window.dispatchEvent(new CustomEvent('minichat:updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <>
        {/* Desktop: sidebar toggle */}
        <div className="hidden md:flex w-10 shrink-0 bg-white border-r border-gray-200 flex-col items-center pt-4 order-first">
          <button
            onClick={() => setOpen(true)}
            className="w-8 h-8 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded flex items-center justify-center text-sm cursor-pointer transition-colors"
            title="Abrir chat"
          >
            💬
          </button>
        </div>
        {/* Mobile: floating FAB */}
        <button
          onClick={() => setOpen(true)}
          className="md:hidden fixed bottom-4 right-4 z-50 w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center text-lg cursor-pointer transition-colors"
          title="Abrir chat"
        >
          💬
        </button>
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-white flex flex-col md:static md:inset-auto md:z-auto md:shrink-0 md:bg-white md:border-r md:border-gray-200 md:flex-row md:order-first"
      style={{ width }}
    >
      <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-end gap-2 shrink-0">
        <button onClick={handleNewConversation} className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer">+ Nueva</button>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer text-lg">&times;</button>
      </div>

      {/* Conversation list */}
      {(() => {
        // Client-side filter: only show conversations matching current context
        const filtered = context.id
          ? conversations.filter((c) => c.contextId === context.id)
          : conversations;
        const filteredCount = context.id ? filtered.length : totalConvs;
        if (filtered.length === 0) return null;
        return (
        <div className="border-b border-gray-200 bg-gray-50 shrink-0">
          <button
            onClick={() => setChatListOpen(!chatListOpen)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-gray-500 hover:text-gray-700 cursor-pointer"
          >
            <span>{filteredCount} conversación{filteredCount !== 1 ? 'es' : ''}</span>
            <span>{chatListOpen ? '\u25B2' : '\u25BC'}</span>
          </button>
          {chatListOpen && <div className="px-2 pb-2 max-h-36 overflow-y-auto bg-gray-50" onScroll={handleConvListScroll}>
          {filtered.map((conv) => (
            <div key={conv.id} className="flex items-center gap-1">
              <button
                onClick={() => handleLoadConversation(conv)}
                className={`flex-1 text-left px-2 py-1 rounded text-xs truncate cursor-pointer transition-colors ${
                  activeConvId === conv.id
                    ? 'bg-gray-100 text-gray-900 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {conv.title}
                <span className="text-gray-300 ml-1">{formatTime(conv.updatedAt)}</span>
              </button>
              <button
                onClick={() => handleDeleteConversation(conv.id)}
                className="text-gray-300 hover:text-red-500 text-xs px-1 cursor-pointer shrink-0"
                title="Eliminar"
              >
                &times;
              </button>
            </div>
          ))}
          {loadingMore && (
            <p className="text-center text-[10px] text-gray-400 py-1">Cargando...</p>
          )}
          </div>}
        </div>
        );
      })()}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && !loading && (
          <div className="text-xs text-gray-400 py-6 px-2 space-y-1.5">
            {context.type === 'topic' ? (<>
              <p className="text-gray-300">Probá algo como:</p>
              <p>Resumí las últimas señales</p>
              <p>Sugerí ángulos para mercados</p>
              <p>Investigá más sobre este tema</p>
              <p>Cambiá la categoría a Economía</p>
            </>) : context.type === 'market' ? (<>
              <p className="text-gray-300">Probá algo como:</p>
              <p>Revisá los criterios de resolución</p>
              <p>Mejorá la descripción</p>
              <p>Lanzá el pipeline de revisión</p>
              <p>Cambiá las contingencias</p>
            </>) : context.label === 'Reglas' ? (<>
              <p className="text-gray-300">Probá algo como:</p>
              <p>Mostrá las reglas estrictas</p>
              <p>Deshabilitá la regla H11</p>
              <p>Creá una regla nueva</p>
            </>) : (<>
              <p className="text-gray-300">Probá algo como:</p>
              <p>Buscá temas sobre economía</p>
              <p>Ingresá nuevas señales</p>
              <p>Generá mercados desde los mejores temas</p>
              <p>Fusioná temas duplicados</p>
            </>)}
          </div>
        )}

        {messages.map((msg, i) => {
          const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1;
          return (
            <div key={i}>
              <div
                className={`text-sm rounded px-3 py-2 ${
                  msg.role === 'user'
                    ? 'bg-blue-50 text-blue-900 ml-4'
                    : 'bg-gray-50 text-gray-700 mr-4 prose prose-sm max-w-none'
                }`}
              >
                {msg.role === 'assistant' ? <ReactMarkdown>{msg.content}</ReactMarkdown> : msg.content}
              </div>
              {msg.activityIds && msg.activityIds.length > 0 && !isLastAssistant && (
                <PersistedActivityCards activityIds={msg.activityIds} />
              )}
            </div>
          );
        })}

        {/* Activity cards from current tool executions (last message) */}
        {activityEntries.length > 0 && !loading && (
          <div className="space-y-1.5 mx-1 p-2 bg-gray-50 rounded border border-gray-100">
            {activityEntries.map((entry) => (
              <ActivityCard key={entry.id} entry={entry} compact />
            ))}
            {pollingEntries.map((entry) => (
              <ActivityCard key={entry.id} entry={entry} compact />
            ))}
            {pollingRef.current && pollingEntries.length === 0 && (
              <p className="text-[10px] text-gray-400 animate-pulse">Esperando resultado...</p>
            )}
          </div>
        )}

        {loading && (
          <div className="text-sm text-gray-400 mr-4 px-3 py-2">Pensando...</div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-100 shrink-0">
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={messages.length === 0
              ? context.type === 'topic' ? 'Preguntá sobre este tema...'
              : context.type === 'market' ? 'Preguntá sobre este mercado...'
              : 'Preguntá algo...'
              : 'Responder...'}
            disabled={loading}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-3 py-2 text-sm font-medium rounded-md bg-gray-200 hover:bg-gray-300 text-gray-800 disabled:opacity-50 transition-colors cursor-pointer"
          >
            Enviar
          </button>
        </form>
        {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
      </div>
      </div>
      {/* Resize handle — desktop only */}
      <div
        onMouseDown={handleResizeStart}
        className="hidden md:block w-1.5 bg-gray-200 hover:bg-blue-400 cursor-col-resize shrink-0 transition-colors"
      />
    </div>
  );
}

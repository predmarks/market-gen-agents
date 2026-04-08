'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePageContext } from '@/app/_components/PageContext';

interface Newsletter {
  id: string;
  date: string;
  status: string;
  subjectLine: string;
  markdown: string;
  html: string;
  featuredMarketIds: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

type ViewMode = 'preview' | 'markdown';

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  draft: { label: 'Borrador', className: 'bg-gray-100 text-gray-700' },
  sent: { label: 'Enviado', className: 'bg-green-100 text-green-700' },
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export default function NewsletterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setPageData } = usePageContext();
  const [newsletter, setNewsletter] = useState<Newsletter | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [editing, setEditing] = useState<'subject' | 'markdown' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchNewsletter = useCallback(async () => {
    try {
      const res = await fetch(`/api/newsletters/${id}`);
      if (res.ok) {
        const data = await res.json();
        setNewsletter(data.newsletter);
      } else {
        router.push('/dashboard/newsletter');
      }
    } catch {
      router.push('/dashboard/newsletter');
    }
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    fetchNewsletter();
  }, [fetchNewsletter]);

  // Refetch when MiniChat makes changes
  useEffect(() => {
    const onChatUpdate = () => fetchNewsletter();
    window.addEventListener('minichat:updated', onChatUpdate);
    return () => window.removeEventListener('minichat:updated', onChatUpdate);
  }, [fetchNewsletter]);

  // Expose newsletter content to MiniChat for editing
  useEffect(() => {
    if (!newsletter) return;

    const meta = newsletter.metadata ?? {};
    const featured = (meta.featuredMarkets as { title: string; whyNow: string }[]) ?? [];
    const resolved = (meta.resolvedEntries as { title: string; outcome: string }[]) ?? [];

    const content = [
      `Subject: ${newsletter.subjectLine}`,
      `Fecha: ${newsletter.date}`,
      `Status: ${newsletter.status}`,
      '',
      '--- Contenido (markdown) ---',
      newsletter.markdown,
      '',
      featured.length > 0 ? `--- Mercados destacados (${featured.length}) ---` : '',
      ...featured.map((m, i) => `${i + 1}. ${m.title}: ${m.whyNow}`),
      resolved.length > 0 ? `\n--- Resoluciones (${resolved.length}) ---` : '',
      ...resolved.map((r) => `• ${r.title} → ${r.outcome}`),
    ].filter(Boolean).join('\n');

    setPageData({
      label: `Newsletter: ${newsletter.subjectLine}`,
      content,
    });

    return () => setPageData(null);
  }, [newsletter, setPageData]);

  const handleSave = async (field: 'subjectLine' | 'markdown' | 'html', value: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/newsletters/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        setNewsletter((prev) => prev ? { ...prev, [field]: value } : prev);
        setEditing(null);
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirm('¿Eliminar este newsletter?')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/newsletters/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/dashboard/newsletter');
        return;
      }
    } catch { /* ignore */ }
    setDeleting(false);
  };

  if (loading) {
    return <div className="text-sm text-gray-500">Cargando...</div>;
  }

  if (!newsletter) {
    return <div className="text-sm text-gray-500">Newsletter no encontrado</div>;
  }

  const style = STATUS_STYLES[newsletter.status] ?? { label: newsletter.status, className: 'bg-gray-100 text-gray-700' };

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-4">
        <Link href="/dashboard/newsletter" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">
          ← Newsletters
        </Link>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editing === 'subject' ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 text-lg font-bold bg-white border border-gray-300 rounded px-2 py-1 focus:border-gray-500 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave('subjectLine', editValue);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  autoFocus
                />
                <button onClick={() => handleSave('subjectLine', editValue)} disabled={saving} className="text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                  Guardar
                </button>
                <button onClick={() => setEditing(null)} className="text-sm text-gray-400 hover:text-gray-600 cursor-pointer">
                  Cancelar
                </button>
              </div>
            ) : (
              <h1
                className="text-2xl font-bold cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1"
                onClick={() => { setEditing('subject'); setEditValue(newsletter.subjectLine); }}
                title="Click para editar"
              >
                {newsletter.subjectLine}
              </h1>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.className}`}>
                {style.label}
              </span>
              <span className="text-xs text-gray-500">{newsletter.date}</span>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500">Creado {formatDate(newsletter.createdAt)}</span>
              {newsletter.updatedAt !== newsletter.createdAt && (
                <>
                  <span className="text-xs text-gray-400">·</span>
                  <span className="text-xs text-gray-500">Editado {formatDate(newsletter.updatedAt)}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 cursor-pointer shrink-0"
          >
            {deleting ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>

      {/* View mode tabs */}
      <div className="flex items-center gap-2 mb-4">
        {(['preview', 'markdown'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer ${
              viewMode === mode
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {mode === 'preview' ? 'Preview' : 'Markdown'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {viewMode === 'preview' && newsletter.html && (
          <div className="p-0">
            <iframe
              srcDoc={newsletter.html}
              className="w-full border-0"
              style={{ minHeight: '600px' }}
              title="Newsletter preview"
              onLoad={(e) => {
                const iframe = e.target as HTMLIFrameElement;
                if (iframe.contentDocument) {
                  iframe.style.height = `${iframe.contentDocument.body.scrollHeight + 40}px`;
                }
              }}
            />
          </div>
        )}

        {viewMode === 'preview' && !newsletter.html && (
          <div className="p-4 text-sm text-gray-500">No hay preview HTML disponible para este newsletter.</div>
        )}

        {viewMode === 'markdown' && (
          <div className="relative">
            {editing === 'markdown' ? (
              <div>
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-full p-4 text-sm font-mono border-0 focus:outline-none resize-none"
                  style={{ minHeight: '500px' }}
                />
                <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-100 bg-gray-50">
                  <button onClick={() => handleSave('markdown', editValue)} disabled={saving} className="px-3 py-1 text-sm bg-gray-800 text-white rounded hover:bg-gray-700 cursor-pointer">
                    {saving ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button onClick={() => setEditing(null)} className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => { setEditing('markdown'); setEditValue(newsletter.markdown); }}
                title="Click para editar"
              >
                <pre className="text-sm font-mono whitespace-pre-wrap text-gray-800">{newsletter.markdown}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

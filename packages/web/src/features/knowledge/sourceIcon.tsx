import { FileText, Globe, Link2, MessageSquareQuote } from 'lucide-react'
import type { iKnowledgeSource } from '../workspace/types'

export function SourceIcon({ source }: { source: iKnowledgeSource }) {
  return (
    <span className="sourceIcon" aria-hidden="true">
      {source.kind === 'note' ? (
        <MessageSquareQuote size={15} />
      ) : source.kind === 'upload' || source.kind === 'publicDocument' ? (
        <FileText size={15} />
      ) : source.kind === 'website' ? (
        <Globe size={15} />
      ) : (
        <Link2 size={15} />
      )}
    </span>
  )
}

import { Globe, MessageCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import type { tCustomerChannel } from './api'

export const channelIcons: Record<tCustomerChannel, ReactNode> = {
  website: <Globe size={12} />,
  whatsapp_business: <MessageCircle size={12} />,
}

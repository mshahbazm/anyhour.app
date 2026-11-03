import { newWorkspaceRoutes, workspaceRoutes } from './routes/workspace.routes'
import { createWorkspaceAgentRoutes } from './routes/workspaceAgent.routes'
import { previewRoutes } from './routes/preview.routes'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getAuth } from './auth/auth'
import { env } from './env'
import { knowledgeSourceRoutes } from './routes/knowledgeSources.routes'
import { knowledgeRoutes } from './routes/knowledge.routes'
import { assistantRoutes } from './routes/assistant.routes'
import { botPictureRoutes } from './routes/botPicture.routes'
import { conversationRoutes } from './routes/conversation.routes'
import { leadRoutes } from './routes/lead.routes'
import { apiKeyRoutes } from './routes/apiKey.routes'
import { publicApiRoutes } from './routes/publicApi.routes'
import { widgetRoutes } from './routes/widget.routes'
import { whatsappRoutes } from './routes/whatsapp.routes'
import {
  connectionRoutes,
  connectRoutes,
  teamChatLinkRoutes,
} from './routes/connection.routes'
import { contactRoutes } from './routes/contact.routes'
import { memberRuleRoutes } from './routes/memberRule.routes'
import { ApiError } from './services/http/apiError'
import { allowedSite } from './services/widget/site'

export const app = new Hono()

const widgetCors = cors({
  origin: async (origin, c) => {
    const assistantId = c.req.path.split('/')[3]
    if (!assistantId) return null
    return (await allowedSite(assistantId, origin)) ? origin : null
  },
  allowHeaders: ['Authorization', 'Content-Type', 'X-Conversation-Token'],
})
const appCors = cors({ origin: env.FRONT_END_URL, credentials: true })
app.use('/api/*', (c, next) =>
  c.req.path.startsWith('/api/widget/')
    ? widgetCors(c, next)
    : appCors(c, next),
)

app.onError((error, c) => {
  if (error instanceof ApiError)
    return c.json(
      {
        error: { ...error.details, code: error.code, message: error.message },
      },
      error.status,
    )
  console.error('Unexpected API error', error)
  return c.json(
    { error: { code: 'internal_error', message: 'Internal server error' } },
    500,
  )
})

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.all('/api/auth/*', (c) => getAuth().handler(c.req.raw))
app.route('/api/organizations', assistantRoutes)
app.route('/api/workspaces', newWorkspaceRoutes)
app.route('/api/organizations', knowledgeRoutes)
app.route('/api/organizations', knowledgeSourceRoutes)
app.route('/api/organizations', botPictureRoutes)
app.route('/api/organizations', conversationRoutes)
app.route('/api/organizations', leadRoutes)
app.route('/api/organizations', contactRoutes)
app.route('/api/organizations', memberRuleRoutes)
app.route('/api/organizations', apiKeyRoutes)
app.route('/api/organizations', whatsappRoutes)
app.route('/api/organizations', connectionRoutes)
app.route('/api/connect', connectRoutes)
app.route('/api/team-chat', teamChatLinkRoutes)
app.route('/api/v1', publicApiRoutes)
app.route('/api/widget', widgetRoutes)

app.route('/api/organizations', workspaceRoutes)
app.route('/api/organizations', previewRoutes)
app.route(
  '/api/workspace-agent',
  createWorkspaceAgentRoutes((request) => app.fetch(request)),
)

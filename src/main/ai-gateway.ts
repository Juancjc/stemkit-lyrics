import { join } from 'path'
import { loadDotEnvFile, applyEnvFile } from './env-file'
import { resolveNineRouterConfig, sendChatCompletion, type ChatMessage } from './nine-router'

export interface AiGateway {
  sendChat(messages: ChatMessage[]): Promise<string>
}

let cached: AiGateway | null | undefined

function createGateway(): AiGateway | null {
  applyEnvFile(process.env, loadDotEnvFile(join(process.cwd(), '.env')))
  const result = resolveNineRouterConfig(process.env)
  if (result.status !== 'ok') return null
  const config = result.config
  return {
    sendChat: async (messages) => (await sendChatCompletion(config, messages)).content
  }
}

export function getAiGateway(): AiGateway | null {
  if (cached === undefined) cached = createGateway()
  return cached
}
